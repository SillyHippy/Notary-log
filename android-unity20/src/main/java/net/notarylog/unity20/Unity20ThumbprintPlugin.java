package net.notarylog.unity20;

import android.Manifest;
import android.bluetooth.BluetoothAdapter;
import android.bluetooth.BluetoothDevice;
import android.bluetooth.BluetoothManager;
import android.bluetooth.le.BluetoothLeScanner;
import android.bluetooth.le.ScanCallback;
import android.bluetooth.le.ScanResult;
import android.content.BroadcastReceiver;
import android.content.ComponentName;
import android.content.Context;
import android.content.Intent;
import android.content.IntentFilter;
import android.content.ServiceConnection;
import android.content.pm.PackageManager;
import android.graphics.Bitmap;
import android.os.Build;
import android.os.Handler;
import android.os.IBinder;
import android.os.Looper;
import android.util.Base64;

import com.getcapacitor.JSObject;
import com.getcapacitor.PermissionState;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.getcapacitor.annotation.Permission;
import com.getcapacitor.annotation.PermissionCallback;

import net.notarylog.unity20.ble.BluetoothLeService;
import net.notarylog.unity20.ble.U20BTGattAttributes;
import net.notarylog.unity20.fmssdk.FMSAPI;
import net.notarylog.unity20.fmssdk.FMSHeader;
import net.notarylog.unity20.fmssdk.FMSImage;

import java.io.ByteArrayOutputStream;
import java.util.Locale;

/**
 * Capacitor plugin wrapping SecuGen Unity 20 Bluetooth DK v2.3 BLE capture.
 * Protocol: GATT 0xFDA0, FMS CMD_FP_CAPTURE (0x43), 300x400 grayscale → PNG.
 */
@CapacitorPlugin(
        name = "Unity20Thumbprint",
        permissions = {
                @Permission(alias = "bluetooth", strings = {
                        Manifest.permission.BLUETOOTH,
                        Manifest.permission.BLUETOOTH_ADMIN,
                        Manifest.permission.BLUETOOTH_SCAN,
                        Manifest.permission.BLUETOOTH_CONNECT,
                        Manifest.permission.ACCESS_FINE_LOCATION
                })
        }
)
public class Unity20ThumbprintPlugin extends Plugin {
    private static final int MSG_READ = 1;
    private static final long SCAN_MS = 12_000;
    private static final long CAPTURE_MS = 25_000;

    private BluetoothLeService bleService;
    private PluginCall pending;
    private String foundAddress;
    private String foundName;
    private boolean bound;
    private boolean captureSent;
    private final Handler main = new Handler(Looper.getMainLooper());
    private Runnable timeout;

    private final ServiceConnection connection = new ServiceConnection() {
        @Override
        public void onServiceConnected(ComponentName name, IBinder service) {
            bleService = ((BluetoothLeService.LocalBinder) service).getService();
            bleService.initialize(responseHandler);
            bound = true;
            if (foundAddress != null) {
                bleService.connect(foundAddress);
            }
        }

        @Override
        public void onServiceDisconnected(ComponentName name) {
            bleService = null;
            bound = false;
        }
    };

    private final Handler responseHandler = new Handler(Looper.getMainLooper(), msg -> {
        if (msg.what != MSG_READ || pending == null) return true;
        byte[] buf = (byte[]) msg.obj;
        if (buf == null || buf.length < FMSAPI.PACKET_HEADER_SIZE) return true;
        FMSHeader header = new FMSHeader(buf);
        if (header.pkt_command != FMSAPI.CMD_FP_CAPTURE) return true;
        if (header.pkt_error != FMSAPI.ERR_NONE) {
            fail("Scanner error 0x" + Integer.toHexString(header.pkt_error & 0xFF));
            return true;
        }
        int imgLen = bleService.getCapturedSize();
        byte[] raw = bleService.getCapturedBuffer(imgLen);
        if (raw == null) {
            fail("Image transfer size mismatch.");
            return true;
        }
        FMSImage img = new FMSImage(raw, imgLen);
        Bitmap bmp = img.get();
        ByteArrayOutputStream out = new ByteArrayOutputStream();
        bmp.compress(Bitmap.CompressFormat.PNG, 100, out);
        String b64 = Base64.encodeToString(out.toByteArray(), Base64.NO_WRAP);
        JSObject ret = new JSObject();
        ret.put("pngDataUrl", "data:image/png;base64," + b64);
        ret.put("width", img.getmWidth());
        ret.put("height", img.getmHeight());
        if (foundName != null) ret.put("deviceName", foundName);
        PluginCall call = pending;
        pending = null;
        cancelTimeout();
        disconnectQuiet();
        call.resolve(ret);
        return true;
    });

    private final BroadcastReceiver gattReceiver = new BroadcastReceiver() {
        @Override
        public void onReceive(Context context, Intent intent) {
            String action = intent.getAction();
            if (BluetoothLeService.ACTION_GATT_CONNECTED.equals(action)) {
                // wait for services
            } else if (BluetoothLeService.ACTION_GATT_SERVICES_DISCOVERED.equals(action)) {
                if (!captureSent && bleService != null) {
                    captureSent = true;
                    bleService.writeCustomCharacteristic(FMSAPI.cmdFPCapture(FMSAPI.IMAGE_SIZE_FULL));
                }
            } else if (BluetoothLeService.ACTION_GATT_DISCONNECTED.equals(action)) {
                if (pending != null) fail("Scanner disconnected.");
            }
        }
    };

    @PluginMethod
    public void isAvailable(PluginCall call) {
        JSObject ret = new JSObject();
        ret.put("available", true);
        call.resolve(ret);
    }

    @PluginMethod
    public void capture(PluginCall call) {
        if (pending != null) {
            call.reject("A capture is already in progress.");
            return;
        }
        if (getPermissionState("bluetooth") != PermissionState.GRANTED) {
            requestPermissionForAlias("bluetooth", call, "bluetoothPerms");
            return;
        }
        startCapture(call);
    }

    @PermissionCallback
    private void bluetoothPerms(PluginCall call) {
        if (getPermissionState("bluetooth") == PermissionState.GRANTED) {
            startCapture(call);
        } else {
            call.reject("Bluetooth permission denied.");
        }
    }

    private void startCapture(PluginCall call) {
        pending = call;
        foundAddress = null;
        foundName = null;
        captureSent = false;
        Context ctx = getContext();
        if (!ctx.getPackageManager().hasSystemFeature(PackageManager.FEATURE_BLUETOOTH_LE)) {
            fail("This phone has no Bluetooth LE.");
            return;
        }
        BluetoothManager mgr = (BluetoothManager) ctx.getSystemService(Context.BLUETOOTH_SERVICE);
        BluetoothAdapter adapter = mgr != null ? mgr.getAdapter() : null;
        if (adapter == null || !adapter.isEnabled()) {
            fail("Turn on Bluetooth.");
            return;
        }
        IntentFilter filter = new IntentFilter();
        filter.addAction(BluetoothLeService.ACTION_GATT_CONNECTED);
        filter.addAction(BluetoothLeService.ACTION_GATT_DISCONNECTED);
        filter.addAction(BluetoothLeService.ACTION_GATT_SERVICES_DISCOVERED);
        if (Build.VERSION.SDK_INT >= 33) {
            ctx.registerReceiver(gattReceiver, filter, Context.RECEIVER_NOT_EXPORTED);
        } else {
            ctx.registerReceiver(gattReceiver, filter);
        }
        ctx.bindService(new Intent(ctx, BluetoothLeService.class), connection, Context.BIND_AUTO_CREATE);

        BluetoothLeScanner scanner = adapter.getBluetoothLeScanner();
        ScanCallback scanCb = new ScanCallback() {
            @Override
            public void onScanResult(int callbackType, ScanResult result) {
                BluetoothDevice d = result.getDevice();
                String addr = d.getAddress() == null ? "" : d.getAddress();
                String name = d.getName() == null ? "" : d.getName();
                boolean match = addr.toUpperCase(Locale.US).startsWith(U20BTGattAttributes.SECUGEN_MAC_ADDRESS)
                        || name.toUpperCase(Locale.US).contains("UNITY")
                        || name.toUpperCase(Locale.US).contains("U20");
                if (!match || foundAddress != null) return;
                foundAddress = addr;
                foundName = name.isEmpty() ? addr : name;
                try { scanner.stopScan(this); } catch (Exception ignored) {}
                if (bleService != null) bleService.connect(foundAddress);
            }
        };
        scanner.startScan(scanCb);
        timeout = () -> {
            try { scanner.stopScan(scanCb); } catch (Exception ignored) {}
            if (pending != null && foundAddress == null) {
                fail("No Unity 20 Bluetooth found. Power on the blue-label scanner and keep it next to the phone.");
            } else if (pending != null && !captureSent) {
                fail("Connected but capture did not start. Retry.");
            }
        };
        main.postDelayed(timeout, SCAN_MS + CAPTURE_MS);
    }

    private void fail(String message) {
        cancelTimeout();
        PluginCall call = pending;
        pending = null;
        disconnectQuiet();
        if (call != null) call.reject(message);
    }

    private void cancelTimeout() {
        if (timeout != null) main.removeCallbacks(timeout);
        timeout = null;
    }

    private void disconnectQuiet() {
        try {
            getContext().unregisterReceiver(gattReceiver);
        } catch (Exception ignored) {}
        if (bleService != null) {
            bleService.disconnect();
            bleService.close();
        }
        if (bound) {
            try { getContext().unbindService(connection); } catch (Exception ignored) {}
            bound = false;
        }
    }
}

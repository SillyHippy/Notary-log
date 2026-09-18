/*
 * Copyright (C) 2013 The Android Open Source Project
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *      http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

package net.notarylog.unity20.ble;

import static java.lang.Math.min;

import android.app.Service;
import android.bluetooth.BluetoothAdapter;
import android.bluetooth.BluetoothDevice;
import android.bluetooth.BluetoothGatt;
import android.bluetooth.BluetoothGattCallback;
import android.bluetooth.BluetoothGattCharacteristic;
import android.bluetooth.BluetoothGattDescriptor;
import android.bluetooth.BluetoothGattService;
import android.bluetooth.BluetoothManager;
import android.bluetooth.BluetoothProfile;
import android.content.Context;
import android.content.Intent;
import android.os.Binder;
import android.os.Handler;
import android.os.IBinder;
import android.util.Log;

import java.util.List;
import java.util.UUID;

import net.notarylog.unity20.fmssdk.*;

/**
 * Service for managing connection and data communication with a GATT server hosted on a
 * given Bluetooth LE device.
 */
public class BluetoothLeService extends Service {
    private final static String TAG = BluetoothLeService.class.getSimpleName();

    private BluetoothManager mBluetoothManager;
    private BluetoothAdapter mBluetoothAdapter;
    private String mBluetoothDeviceAddress;
    private BluetoothGatt mBluetoothGatt;
    private int mConnectionState = STATE_DISCONNECTED;

    private static final int STATE_DISCONNECTED = 0;
    private static final int STATE_CONNECTING = 1;
    private static final int STATE_CONNECTED = 2;

    private static final int REQUEST_MTU_SIZE = 301;
    private static final int GATT_MAX_MTU_SIZE = 517;

    private Handler mResponseHandler = null;
    private static int mRemainingSize = 0;
    private static int mBytesRead = 0;
    private static int mCapturedSize = 0;
    private static byte[] mTransferBuffer = new byte[FMSAPI.PACKET_HEADER_SIZE + FMSImage.IMG_SIZE_MAX+1];
    private static byte[] mCapturedBuffer = new byte[FMSImage.IMG_SIZE_MAX+1];
    private byte mCurrentCommand = 0;
    private static byte[] mWriteBuf = new byte[2 * 1024];
    private static int mRemainWriteSize = 0;
    private static int mTotalWriteSize = 0;

    private static int mMaxTransferBufferLength = REQUEST_MTU_SIZE - 5; // mainly used for writeCharacteristic

    public final static String ACTION_GATT_CONNECTED =
            "com.secugen.u20btandroidbledemo.ACTION_GATT_CONNECTED";
    public final static String ACTION_GATT_DISCONNECTED =
            "com.secugen.u20btandroidbledemo.ACTION_GATT_DISCONNECTED";
    public final static String ACTION_GATT_SERVICES_DISCOVERED =
            "com.secugen.u20btandroidbledemo.ACTION_GATT_SERVICES_DISCOVERED";
    public final static String ACTION_DATA_AVAILABLE =
            "com.secugen.u20btandroidbledemo.ACTION_DATA_AVAILABLE";
    public final static String EXTRA_DATA =
            "com.secugen.u20btandroidbledemo.EXTRA_DATA";

    public final static UUID UUID_CHARACTERISTIC_READ_NOTIFY =
            UUID.fromString(U20BTGattAttributes.CHARACTERISTIC_READ_NOTIFY);
    public final static UUID UUID_CHARACTERISTIC_WRITE =
            UUID.fromString(U20BTGattAttributes.CHARACTERISTIC_WRITE);

    // Implements callback methods for GATT events that the app cares about.  For example,
    // connection change and services discovered.
    private final BluetoothGattCallback mGattCallback = new BluetoothGattCallback() {
        @Override
        public void onConnectionStateChange(BluetoothGatt gatt, int status, int newState) {
            String intentAction;
            if (newState == BluetoothProfile.STATE_CONNECTED) {
                //NOTE: If you are going to read a long piece of data,
                // its best to make this value a factor of 600 + 1, like 51, 61, 101, 151, etc due to the risk of data loss if the last packet contains more than 600 bytes of cumulative data
                Log.i(TAG, "Request MTU");
                gatt.requestMtu(REQUEST_MTU_SIZE);

                intentAction = ACTION_GATT_CONNECTED;
                mConnectionState = STATE_CONNECTED;
                broadcastUpdate(intentAction);
                Log.i(TAG, "Connected to GATT server.");
                // Attempts to discover services after successful connection.
                //Log.i(TAG, "Attempting to start service discovery:" +
                //        mBluetoothGatt.discoverServices());

            } else if (newState == BluetoothProfile.STATE_DISCONNECTED) {
                intentAction = ACTION_GATT_DISCONNECTED;
                mConnectionState = STATE_DISCONNECTED;
                Log.i(TAG, "Disconnected from GATT server.");
                broadcastUpdate(intentAction);
            }
        }

        @Override
        public void onMtuChanged(BluetoothGatt gatt, int mtu, int status) {
            if (status != BluetoothGatt.GATT_SUCCESS) {
                Log.e(TAG, "Can't set mtu to: " + mtu);
            } else {
                Log.i(TAG, "Connected to GATT server. MTU: " + mtu);
                Log.i(TAG, "Attempting to start service discovery:" +
                        mBluetoothGatt.discoverServices());

                // As one of the changes in Android 14, the MTU is set to 517.
                // https://developer.android.com/about/versions/14/behavior-changes-all#mtu-set-to-517
                mMaxTransferBufferLength = min(mtu, GATT_MAX_MTU_SIZE) - 5;
                Log.i(TAG, "Reset max transfer buffer length: " + mMaxTransferBufferLength);
            }
        }

        @Override
        public void onServicesDiscovered(BluetoothGatt gatt, int status) {
            if (status == BluetoothGatt.GATT_SUCCESS) {
                broadcastUpdate(ACTION_GATT_SERVICES_DISCOVERED);

                /*check if the service is available on the device*/
                BluetoothGattService gattService = gatt.getService(UUID.fromString(U20BTGattAttributes.SERVICE_SECUGEN_SPP_OVER_BLE));
                if(gattService != null) {
                    Log.w(TAG, "Custom gatt Service found");

                    List<BluetoothGattCharacteristic> gattCharacteristics = gattService.getCharacteristics();
                    for (BluetoothGattCharacteristic gattCharacteristic : gattCharacteristics) {
                        final int charaProp = gattCharacteristic.getProperties();
                        if (UUID_CHARACTERISTIC_READ_NOTIFY.equals(gattCharacteristic.getUuid()) && (charaProp | BluetoothGattCharacteristic.PROPERTY_NOTIFY) > 0) {
                            setCharacteristicNotification(gattCharacteristic, true);
                            break;
                        }
                    }
                }
            } else {
                Log.w(TAG, "onServicesDiscovered received: " + status);
            }
        }

        @Override
        public void onCharacteristicRead(BluetoothGatt gatt,
                                         BluetoothGattCharacteristic characteristic,
                                         int status) {
            super.onCharacteristicRead(gatt, characteristic, status);
            Log.d(TAG, "onCharacteristicRead callback");

            if (status == BluetoothGatt.GATT_SUCCESS) {
                broadcastUpdate(ACTION_DATA_AVAILABLE, characteristic);
            } else {
                Log.d(TAG, String.format("GATT_FAIL: ACTION_DATA_AVAILABLE ((%d))", status));
            }
        }

        @Override
        public void onCharacteristicWrite(BluetoothGatt gatt,
                                          BluetoothGattCharacteristic characteristic,
                                          int status) {
            if(status != BluetoothGatt.GATT_SUCCESS){
                Log.d(TAG, "Failed write, retrying");
                gatt.writeCharacteristic(characteristic);
            }
            //Log.d(TAG, "onCharacteristicWrite callback: " + bytesToHexString(characteristic.getValue()));

            super.onCharacteristicWrite(gatt, characteristic, status);

            if (mRemainWriteSize > mMaxTransferBufferLength) {
                mRemainWriteSize = mRemainWriteSize - mMaxTransferBufferLength;

                int bufSize = mRemainWriteSize > mMaxTransferBufferLength ? mMaxTransferBufferLength : mRemainWriteSize;
                byte[] particleBuf = new byte[bufSize];
                System.arraycopy(mWriteBuf, mTotalWriteSize-mRemainWriteSize, particleBuf, 0, bufSize);

                characteristic.setValue(particleBuf);
                if (mBluetoothGatt.writeCharacteristic(characteristic) == false) {
                    Log.w(TAG, "Failed to write characteristic");
                } else {
                    Log.d(TAG, String.format("BytesWrite: %d, RemainingSize: %d", bufSize, mRemainWriteSize));
                }
            } else {
                final byte[] data = new byte[FMSAPI.PACKET_HEADER_SIZE];
                if (mRemainWriteSize > 0) {
                    System.arraycopy(mWriteBuf, 0, data, 0, FMSAPI.PACKET_HEADER_SIZE);
                } else {
                    byte[] tmp = characteristic.getValue();
                    System.arraycopy(tmp, 0, data, 0, FMSAPI.PACKET_HEADER_SIZE);
                }

                final int st = status;
                Log.d(TAG, "onCharacteristicWrite callback: " + bytesToHexString(data));

                new Thread(new Runnable() {
                    @Override
                    public void run() {
                        mRemainingSize = 0;
                        // Send the obtained bytes to the UI Activity
                        if (mResponseHandler != null) {
                            mResponseHandler.obtainMessage(3, data.length, st, data)
                                    .sendToTarget();
                        }
                    }
                }).start();

                mRemainWriteSize = 0;
            }
        }

        @Override
        public void onReliableWriteCompleted(BluetoothGatt gatt, int status) {
            super.onReliableWriteCompleted(gatt, status);

            Log.d(TAG, "onReliableWriteCompleted");
        }

        @Override
        public void onCharacteristicChanged(BluetoothGatt gatt,
                                            BluetoothGattCharacteristic characteristic) {
            Log.d(TAG, "onCharacteristicChanged");
            broadcastUpdate(ACTION_DATA_AVAILABLE, characteristic);
        }
    };

    private void broadcastUpdate(final String action) {
        Log.d(TAG, ""+action);

        final Intent intent = new Intent(action);
        sendBroadcast(intent);
    }

    private void broadcastUpdate(final String action,
                                 final BluetoothGattCharacteristic characteristic) {
        final Intent intent = new Intent(action);

        // This is special handling for the Heart Rate Measurement profile.  Data parsing is
        // carried out as per profile specifications:
        // http://developer.bluetooth.org/gatt/characteristics/Pages/CharacteristicViewer.aspx?u=org.bluetooth.characteristic.heart_rate_measurement.xml

        if (UUID_CHARACTERISTIC_READ_NOTIFY.equals(characteristic.getUuid())) {
            byte[] data = characteristic.getValue();
            if (data.length == FMSAPI.PACKET_HEADER_SIZE && data[0] == 0x4E) { // detected notify message
                Log.d(TAG, "Detected Notify message, try read data");
                readCustomCharacteristic();
                return;
            }

            if (data != null && data.length > 0) {

                if (data.length == FMSAPI.PACKET_HEADER_SIZE) {
                    FMSHeader header = new FMSHeader(data);
                    mCurrentCommand = header.pkt_command;
                    int nExtraDataSize = header.getExtraDataSize();
                    if (nExtraDataSize > 0 && header.pkt_checksum == data[FMSAPI.PACKET_HEADER_SIZE - 1]) {
                        mRemainingSize = FMSAPI.PACKET_HEADER_SIZE + nExtraDataSize;
                        mBytesRead = 0;

                        if (mCurrentCommand == FMSAPI.CMD_FP_CAPTURE && mResponseHandler != null) {
                            mResponseHandler.obtainMessage(2, 0, 0, null)
                                    .sendToTarget();
                        }

                        Log.d(TAG, String.format("RemainingSize: %d", mRemainingSize));
                        Log.d(TAG, String.format("data.size: %d, getValue.size: %d", data.length, characteristic.getValue().length));
                    }
                }

                if (mRemainingSize > 0) {
                    if (data.length > 0) {
                        System.arraycopy(data, 0, mTransferBuffer, mBytesRead, data.length);
                        mRemainingSize -= data.length;
                        mBytesRead += data.length;

                        Log.d(TAG, String.format("BytesRead: %d, RemainingSize: %d", data.length, mRemainingSize));
                    }

                    if (mCurrentCommand == FMSAPI.CMD_FP_CAPTURE && mResponseHandler != null) {
                        mResponseHandler.obtainMessage(2, (int) (mBytesRead * 100 / (mRemainingSize + mBytesRead)), 0, null)
                                .sendToTarget();
                    }

                    if (mRemainingSize > 0)
                        readCustomCharacteristic();
                    else {
                        byte[] headerbuf = new byte[FMSAPI.PACKET_HEADER_SIZE];
                        System.arraycopy(mTransferBuffer, 0, headerbuf, 0, FMSAPI.PACKET_HEADER_SIZE);
                        FMSHeader tmpHeader = new FMSHeader(headerbuf);

                        if (tmpHeader.pkt_command == FMSAPI.CMD_FP_CAPTURE) { // The capture command only forwards basic packets. Image data is passed to the main activity through getCapturedBuffer().
                            mCapturedSize = mBytesRead - FMSAPI.PACKET_HEADER_SIZE;
                            System.arraycopy(mTransferBuffer, FMSAPI.PACKET_HEADER_SIZE, mCapturedBuffer, 0, mCapturedSize);

                            // reset obtaining buffer size
                            mBytesRead = FMSAPI.PACKET_HEADER_SIZE;
                        } else {
                            mCapturedSize = 0;
                        }

                        // Send the obtained bytes to the UI Activity
                        if (mResponseHandler != null) {
                            mResponseHandler.obtainMessage(1, mBytesRead, 0, mTransferBuffer)
                                    .sendToTarget();
                        }
                    }
                } else {
                    final StringBuilder stringBuilder = new StringBuilder(data.length);
                    for (byte byteChar : data)
                        stringBuilder.append(String.format("%02X ", byteChar));
                    Log.d(TAG, String.format("Received read notify: %s", stringBuilder.toString()));

                    // Send the obtained bytes to the UI Activity
                    if (mResponseHandler != null) {
                        mResponseHandler.obtainMessage(1, data.length, 0, data)
                                .sendToTarget();
                    }
                }
            } else {
                if (data == null)
                    Log.d(TAG, String.format("characteristic.getValue is null"));
                else
                    Log.d(TAG, String.format("characteristic.getValue length %d", data.length));
            }

        } else {
            // For all other profiles, writes the data formatted in HEX.
            final byte[] data = characteristic.getValue();
            if (data != null && data.length > 0) {
                final StringBuilder stringBuilder = new StringBuilder(data.length);
                for(byte byteChar : data)
                    stringBuilder.append(String.format("%02X ", byteChar));
                Log.d(TAG, String.format("Received write: %s", stringBuilder.toString()));
                intent.putExtra(EXTRA_DATA, stringBuilder.toString());
            }
        }
        sendBroadcast(intent);
    }

    public class LocalBinder extends Binder {
        public BluetoothLeService getService() {
            return BluetoothLeService.this;
        }
    }

    @Override
    public IBinder onBind(Intent intent) {
        return mBinder;
    }

    @Override
    public boolean onUnbind(Intent intent) {
        // After using a given device, you should make sure that BluetoothGatt.close() is called
        // such that resources are cleaned up properly.  In this particular example, close() is
        // invoked when the UI is disconnected from the Service.
        close();
        return super.onUnbind(intent);
    }

    private final IBinder mBinder = new LocalBinder();

    /**
     * Initializes a reference to the local Bluetooth adapter.
     *
     * @return Return true if the initialization is successful.
     */
    public boolean initialize(Handler handler) {
        // For API level 18 and above, get a reference to BluetoothAdapter through
        // BluetoothManager.
        if (mBluetoothManager == null) {
            mBluetoothManager = (BluetoothManager) getSystemService(Context.BLUETOOTH_SERVICE);
            if (mBluetoothManager == null) {
                Log.e(TAG, "Unable to initialize BluetoothManager.");
                return false;
            }
        }

        mBluetoothAdapter = mBluetoothManager.getAdapter();
        if (mBluetoothAdapter == null) {
            Log.e(TAG, "Unable to obtain a BluetoothAdapter.");
            return false;
        }

        mResponseHandler = handler;

        return true;
    }

    /**
     * Connects to the GATT server hosted on the Bluetooth LE device.
     *
     * @param address The device address of the destination device.
     *
     * @return Return true if the connection is initiated successfully. The connection result
     *         is reported asynchronously through the
     *         {@code BluetoothGattCallback#onConnectionStateChange(android.bluetooth.BluetoothGatt, int, int)}
     *         callback.
     */
    public boolean connect(final String address) {
        if (mBluetoothAdapter == null || address == null) {
            Log.w(TAG, "BluetoothAdapter not initialized or unspecified address.");
            return false;
        }

        // Previously connected device.  Try to reconnect.
        if (mBluetoothDeviceAddress != null && address.equals(mBluetoothDeviceAddress)
                && mBluetoothGatt != null) {
            Log.d(TAG, "Trying to use an existing mBluetoothGatt for connection.");
            if (mBluetoothGatt.connect()) {
                mConnectionState = STATE_CONNECTING;
                return true;
            } else {
                return false;
            }
        }

        final BluetoothDevice device = mBluetoothAdapter.getRemoteDevice(address);
        if (device == null) {
            Log.w(TAG, "Device not found.  Unable to connect.");
            return false;
        }
        // We want to directly connect to the device, so we are setting the autoConnect
        // parameter to false.
        mBluetoothGatt = device.connectGatt(this, false, mGattCallback);
        Log.d(TAG, "Trying to create a new connection.");
        mBluetoothDeviceAddress = address;
        mConnectionState = STATE_CONNECTING;
        return true;
    }

    /**
     * Disconnects an existing connection or cancel a pending connection. The disconnection result
     * is reported asynchronously through the
     * {@code BluetoothGattCallback#onConnectionStateChange(android.bluetooth.BluetoothGatt, int, int)}
     * callback.
     */
    public void disconnect() {
        if (mBluetoothAdapter == null || mBluetoothGatt == null) {
            Log.w(TAG, "BluetoothAdapter not initialized");
            return;
        }
        mBluetoothGatt.disconnect();
    }

    /**
     * After using a given BLE device, the app must call this method to ensure resources are
     * released properly.
     */
    public void close() {
        if (mBluetoothGatt == null) {
            return;
        }
        mBluetoothGatt.close();
        mBluetoothGatt = null;
    }

    /**
     * Request a read on a given {@code BluetoothGattCharacteristic}. The read result is reported
     * asynchronously through the {@code BluetoothGattCallback#onCharacteristicRead(android.bluetooth.BluetoothGatt, android.bluetooth.BluetoothGattCharacteristic, int)}
     * callback.
     *
     * @param characteristic The characteristic to read from.
     */
    public void readCharacteristic(BluetoothGattCharacteristic characteristic) {
        if (mBluetoothAdapter == null || mBluetoothGatt == null) {
            Log.w(TAG, "BluetoothAdapter not initialized");
            return;
        }
        mBluetoothGatt.readCharacteristic(characteristic);
    }

    /**
     * Enables or disables notification on a give characteristic.
     *
     * @param characteristic Characteristic to act on.
     * @param enabled If true, enable notification.  False otherwise.
     */
    public void setCharacteristicNotification(BluetoothGattCharacteristic characteristic,
                                              boolean enabled) {
        if (mBluetoothAdapter == null || mBluetoothGatt == null) {
            Log.w(TAG, "BluetoothAdapter not initialized");
            return;
        }
        mBluetoothGatt.setCharacteristicNotification(characteristic, enabled);

        // This is specific to U20BT BLE Notify.
        if (UUID_CHARACTERISTIC_READ_NOTIFY.equals(characteristic.getUuid())) {
            BluetoothGattDescriptor descriptor = characteristic.getDescriptor(UUID.fromString(U20BTGattAttributes.CLIENT_CHARACTERISTIC_NOTIFY_CONFIG));

            if (descriptor != null) {
                descriptor.setValue(BluetoothGattDescriptor.ENABLE_NOTIFICATION_VALUE);
                mBluetoothGatt.writeDescriptor(descriptor);
            } else {
                Log.d(TAG, "BluetoothGattDescriptor is null");
            }

            Log.d(TAG, "setCharacteristicNotification done");
        }
    }

    /**
     * Retrieves a list of supported GATT services on the connected device. This should be
     * invoked only after {@code BluetoothGatt#discoverServices()} completes successfully.
     *
     * @return A {@code List} of supported services.
     */
    public List<BluetoothGattService> getSupportedGattServices() {
        if (mBluetoothGatt == null) return null;

        return mBluetoothGatt.getServices();
    }

    public void readCustomCharacteristic() {
        if (mBluetoothAdapter == null || mBluetoothGatt == null) {
            Log.w(TAG, "BluetoothAdapter not initialized");
            return;
        }
        /*check if the service is available on the device*/
        BluetoothGattService mCustomService = mBluetoothGatt.getService(UUID.fromString(U20BTGattAttributes.SERVICE_SECUGEN_SPP_OVER_BLE));
        if(mCustomService == null){
            Log.w(TAG, "Custom BLE Service not found");
            return;
        }
        /*get the read characteristic from the service*/
        BluetoothGattCharacteristic mReadCharacteristic = mCustomService.getCharacteristic(UUID.fromString(U20BTGattAttributes.CHARACTERISTIC_READ_NOTIFY));
        if(mBluetoothGatt.readCharacteristic(mReadCharacteristic) == false){
            Log.w(TAG, "Failed to read characteristic");
        }
    }

    public void writeCustomCharacteristic(byte[] value) {
        if (mBluetoothAdapter == null || mBluetoothGatt == null) {
            Log.w(TAG, "BluetoothAdapter not initialized");
            return;
        }
        /*check if the service is available on the device*/
        BluetoothGattService mCustomService = mBluetoothGatt.getService(UUID.fromString(U20BTGattAttributes.SERVICE_SECUGEN_SPP_OVER_BLE));
        if(mCustomService == null){
            Log.w(TAG, "Custom BLE Service not found");
            return;
        }

        /*get the write characteristic from the service*/
        BluetoothGattCharacteristic mWriteCharacteristic = mCustomService.getCharacteristic(UUID.fromString(U20BTGattAttributes.CHARACTERISTIC_WRITE));
        //mWriteCharacteristic.setValue(value,android.bluetooth.BluetoothGattCharacteristic.FORMAT_UINT8,0);

        if (value.length < mMaxTransferBufferLength) {
            mRemainWriteSize = 0;
            mTotalWriteSize = 0;

            mWriteCharacteristic.setValue(value);
            if (mBluetoothGatt.writeCharacteristic(mWriteCharacteristic) == false) {
                Log.w(TAG, "Failed to write characteristic");
            }
        } else {
            mRemainWriteSize = value.length;
            mTotalWriteSize = value.length;

            System.arraycopy(value, 0, mWriteBuf, 0, value.length);
            byte[] particleBuf = new byte[mMaxTransferBufferLength];
            System.arraycopy(value,0, particleBuf, 0, mMaxTransferBufferLength);
            mWriteCharacteristic.setValue(particleBuf);
            if (mBluetoothGatt.writeCharacteristic(mWriteCharacteristic) == false) {
                Log.w(TAG, "Failed to write characteristic");
            }
        }
    }

    //Display byte array as hex string
    private static String bytesToHexString(byte[] bytes){
        StringBuilder sb = new StringBuilder();
        int sizes = bytes.length;
        for(int i = 0; i < sizes; i++){
            sb.append(String.format("%02x", bytes[i]&0xff));
        }
        return sb.toString();
    }

    // get image buffer
    public byte[] getCapturedBuffer(int bufferSize){
        if (bufferSize != mCapturedSize) {
            Log.w(TAG, "The transfer size and request size are different.");
            return null;
        }

        byte[] imgbuf = new byte[mCapturedSize];
        System.arraycopy(mCapturedBuffer, 0, imgbuf, 0, mCapturedSize);
        return imgbuf;
    }

    public int getCapturedSize(){
        return mCapturedSize;
    }
}

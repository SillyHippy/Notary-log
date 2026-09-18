# Unity 20 BLE plugin (Android APK)

Copied from SecuGen `Unity_20_Bluetooth_DK_v2.3` BLE Android demo:

- GATT service `0000fda0-0000-1000-8000-00805f9b34fb`
- FMS `CMD_FP_CAPTURE` (0x43) full size
- 300×400 grayscale → PNG data URL for the journal `thumbprintImage` field

## Sideload (no Play Store yet)

1. Install Android Studio on a machine that can USB-debug your phone.
2. From this repo:

```bash
cd artifacts/notary-journal
pnpm add @capacitor/core @capacitor/android
npx cap init "Notary Log" net.notarylog.app --web-dir dist/public
npx cap add android
```

3. Copy `android-unity20/src/main/java/net/notarylog/` into the Capacitor Android app
   (`android/app/src/main/java/net/notarylog/`).
4. Register the plugin in `MainActivity.java`:

```java
import net.notarylog.unity20.Unity20ThumbprintPlugin;
registerPlugin(Unity20ThumbprintPlugin.class);
```

5. Merge BLE permissions from `src/main/AndroidManifest.xml` into the app manifest
   and declare `net.notarylog.unity20.ble.BluetoothLeService`.
6. `npx cap sync android && cd android && ./gradlew assembleDebug`
7. Sideload `app-debug.apk`. Settings → Enable thumbprint capture. Power the
   **blue-label** Unity 20, then Capture on a new entry.

Live scan cannot be proven without that scanner on the phone.

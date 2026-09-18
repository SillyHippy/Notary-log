/**
 * Unity 20 Bluetooth (BLE, blue label) capture bridge.
 *
 * Browser/PWA: always unavailable (no Web Bluetooth FMS protocol).
 * Android Capacitor APK: native plugin `Unity20Thumbprint` from the SecuGen DK.
 */

export interface Unity20CaptureResult {
  pngDataUrl: string;
  width: number;
  height: number;
  deviceName?: string;
}

type NativePlugin = {
  isAvailable: () => Promise<{ available: boolean }>;
  capture: () => Promise<Unity20CaptureResult>;
};

function getNativePlugin(): NativePlugin | null {
  const cap = (globalThis as { Capacitor?: { isNativePlatform?: () => boolean; Plugins?: Record<string, NativePlugin> } }).Capacitor;
  if (!cap?.isNativePlatform?.()) return null;
  return cap.Plugins?.Unity20Thumbprint ?? null;
}

export function isUnity20NativeAvailable(): boolean {
  return getNativePlugin() != null;
}

export async function captureUnity20Thumbprint(): Promise<Unity20CaptureResult> {
  const plugin = getNativePlugin();
  if (!plugin) {
    throw new Error('Unity 20 capture only works in the Android APK with a blue-label Unity 20 Bluetooth scanner.');
  }
  const result = await plugin.capture();
  if (!result?.pngDataUrl?.startsWith('data:image/')) {
    throw new Error('Scanner returned no image.');
  }
  return result;
}

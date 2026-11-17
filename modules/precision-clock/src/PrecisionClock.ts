import { requireNativeModule } from 'expo-modules-core';

/**
 * 精準時鐘與鳴槍（原生模組）。
 *
 * now() 的時基刻意和相機影格 timestamp 相同：
 *  - iOS：host time（mach_absolute_time），AVCaptureSession 影格時間也是它
 *  - Android：SystemClock.elapsedRealtimeNanos（CLOCK_BOOTTIME），
 *    相機 SENSOR_INFO_TIMESTAMP_SOURCE = REALTIME 時影格時間也是它
 * 所以時鐘同步、鳴槍時間、衝線時間可以直接相減。
 */
export interface AudioInfo {
  sampleRate: number;
  /** 系統回報的輸出延遲（秒） */
  outputLatency: number;
}

export interface GunResult {
  /** 槍聲第一個樣本實際從喇叭發出的時間（now() 時基，秒） */
  emittedAt: number;
  /** 這次量測用的輸出延遲（秒） */
  outputLatency: number;
  /** 量測方式：ios-scheduled / android-timestamp / android-estimated */
  method: string;
}

interface NativeModule {
  now(): number;
  prepareAudio(): Promise<AudioInfo>;
  playGunAt(at: number): Promise<GunResult>;
  /** Android：後鏡頭影格時間戳來源。'realtime' 才能直接比較；iOS 一律回 'host' */
  cameraTimestampSource(): string;
}

const Native = requireNativeModule<NativeModule>('PrecisionClock');

export const PrecisionClock = {
  now: (): number => Native.now(),
  prepareAudio: () => Native.prepareAudio(),
  playGunAt: (at: number) => Native.playGunAt(at),
  cameraTimestampSource: () => Native.cameraTimestampSource(),
};

import * as Location from 'expo-location';
import * as TaskManager from 'expo-task-manager';
import type { LocationPermission, LocationSource, RawFix } from './session';

/**
 * 手機的定位（expo-location）。
 * - watch：App 在前景時用，準備畫面等 GPS 穩定。
 * - track：跑步中用，螢幕關掉也會繼續。Android 用前景服務（通知列會有「長跑計時中」），
 *   不需要「一律允許」的定位權限；iOS 用背景定位模式，「使用 App 期間」的權限就夠了（狀態列會顯示定位中）。
 * 背景定位的任務一定要在 App 一啟動就定義（index.ts 會 import 這個檔案）。
 */

const TASK = 'sprint-timer-run-location';

let trackListener: ((fix: RawFix) => void) | null = null;

TaskManager.defineTask<{ locations?: Location.LocationObject[] }>(TASK, async ({ data, error }) => {
  if (error || !data?.locations) return;
  for (const l of data.locations) trackListener?.(toRaw(l));
});

function toRaw(l: Location.LocationObject): RawFix {
  const c = l.coords;
  return {
    timestamp: l.timestamp,
    latitude: c.latitude,
    longitude: c.longitude,
    accuracy: c.accuracy ?? null,
    speed: c.speed !== null && c.speed !== undefined && c.speed >= 0 ? c.speed : null,
  };
}

function permissionOf(r: Location.LocationPermissionResponse): LocationPermission {
  if (r.granted) return 'granted';
  return r.canAskAgain ? 'undetermined' : 'denied';
}

const OPTIONS: Location.LocationOptions = {
  accuracy: Location.Accuracy.BestForNavigation,
  timeInterval: 1000,
  distanceInterval: 0,
};

export const phoneLocation: LocationSource = {
  async permission() {
    return permissionOf(await Location.getForegroundPermissionsAsync());
  },

  async request() {
    const r = await Location.requestForegroundPermissionsAsync();
    // 永遠拒絕之後系統不會再跳詢問：帶使用者去設定頁
    if (!r.granted && !r.canAskAgain) {
      const { Linking } = await import('react-native');
      void Linking.openSettings();
    }
    return permissionOf(r);
  },

  async watch(onFix) {
    const sub = await Location.watchPositionAsync(OPTIONS, (l) => onFix(toRaw(l)));
    return () => sub.remove();
  },

  async track(onFix) {
    // 上次 App 被強制關掉時可能還開著
    if (await Location.hasStartedLocationUpdatesAsync(TASK).catch(() => false)) await Location.stopLocationUpdatesAsync(TASK).catch(() => undefined);
    trackListener = onFix;
    try {
      await Location.startLocationUpdatesAsync(TASK, {
        ...OPTIONS,
        activityType: Location.ActivityType.Fitness,
        pausesUpdatesAutomatically: false,
        showsBackgroundLocationIndicator: true,
        foregroundService: {
          notificationTitle: '長跑計時中',
          notificationBody: '正在用 GPS 記錄距離和路線',
          notificationColor: '#FF7A3D',
          killServiceOnDestroy: true,
        },
      });
    } catch (e) {
      if (trackListener === onFix) trackListener = null;
      throw e;
    }
    return () => {
      if (trackListener === onFix) trackListener = null;
      void Location.stopLocationUpdatesAsync(TASK).catch(() => undefined);
    };
  },
};

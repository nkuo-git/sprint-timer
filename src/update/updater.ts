import * as Application from 'expo-application';
import { Directory, File, Paths } from 'expo-file-system';
import { getContentUriAsync } from 'expo-file-system/legacy';
import * as IntentLauncher from 'expo-intent-launcher';
import { Platform } from 'react-native';
import { isNewer, pickRelease, type ReleaseInfo } from './version';

const REPO = 'nkuo-git/sprint-timer';
const FLAG_GRANT_READ_URI_PERMISSION = 1;

export function currentBuild(): number | null {
  const v = Number(Application.nativeBuildVersion);
  return Number.isFinite(v) && v > 0 ? v : null;
}

/** 顯示版本，例如 "0.4"；本機開發版回傳 null */
export function currentVersion(): string | null {
  const v = Application.nativeApplicationVersion;
  return v && v !== '0.0' ? v : null;
}

/** 查 GitHub 最新 Release，有比目前新的版本就回傳，否則 null。只支援 Android。 */
export async function checkForUpdate(): Promise<ReleaseInfo | null> {
  if (Platform.OS !== 'android') return null;
  const res = await fetch(`https://api.github.com/repos/${REPO}/releases/latest`, {
    headers: { Accept: 'application/vnd.github+json' },
  });
  if (!res.ok) throw new Error(`檢查更新失敗（HTTP ${res.status}）`);
  const rel = pickRelease(await res.json());
  return isNewer(rel, currentBuild()) ? rel : null;
}

/**
 * 下載 APK 並叫出系統安裝畫面。
 * Android 不允許 App 自己靜默安裝：第一次會要求「允許安裝不明來源的 App」，之後每次按一下「更新」即可。
 */
export async function downloadAndInstall(rel: ReleaseInfo, onProgress?: (fraction: number) => void): Promise<void> {
  const dir = new Directory(Paths.cache, 'updates');
  if (!dir.exists) dir.create();
  const dest = new File(dir, `sprint-timer-${rel.build}.apk`);
  if (dest.exists) dest.delete();
  const file = await File.downloadFileAsync(rel.apkUrl, dest, {
    onProgress: ({ bytesWritten, totalBytes }) => {
      const total = totalBytes > 0 ? totalBytes : rel.sizeBytes;
      if (total > 0) onProgress?.(Math.min(1, bytesWritten / total));
    },
  });
  const contentUri = await getContentUriAsync(file.uri);
  await IntentLauncher.startActivityAsync('android.intent.action.VIEW', {
    data: contentUri,
    type: 'application/vnd.android.package-archive',
    flags: FLAG_GRANT_READ_URI_PERMISSION,
  });
}

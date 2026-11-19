import { activateKeepAwakeAsync, deactivateKeepAwake } from 'expo-keep-awake';
import { useCallback, useEffect, useState, useSyncExternalStore } from 'react';
import { AppState } from 'react-native';
import { WatchLink } from '../../modules/watch-link';
import { fileStorage } from '../storage/fileStorage';
import { currentBuild, currentVersion, downloadApk, fetchLatest } from './updater';
import type { LatestReleases } from './version';
import { versionsView, type VersionsView } from './versionView';
import { isBusy, parseWatchInfo, runWatchUpdate, watchStateFrom, type WatchState, type WatchUpdatePhase, type WatchVersion } from './watch';

/**
 * 帳號頁「App 版本」的資料：最新版本（GitHub Release）、手錶裝的版本（配對連線）、更新手錶的進度。
 * 更新手錶要好幾分鐘，進度放在畫面外面（下面的 phase），離開帳號頁再回來還看得到。
 */
const KEEP_AWAKE = 'watch-update';
const lastSeenStore = fileStorage('watch-version.json');

let phase: WatchUpdatePhase = { kind: 'idle' };
const listeners = new Set<() => void>();
const setPhase = (p: WatchUpdatePhase) => {
  phase = p;
  listeners.forEach((l) => l());
};
const subscribe = (l: () => void) => {
  listeners.add(l);
  return () => {
    listeners.delete(l);
  };
};
const getPhase = () => phase;

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

export function useVersions(): { view: VersionsView; latest: LatestReleases | null; checking: boolean; refresh(): void; updateWatch(): void } {
  const current = useSyncExternalStore(subscribe, getPhase, getPhase);
  const [latest, setLatest] = useState<LatestReleases | null>(null);
  const [watch, setWatch] = useState<WatchState | null>(null);
  const [lastSeen, setLastSeen] = useState<WatchVersion | null>(null);
  const [checking, setChecking] = useState(false);

  const sawWatch = useCallback((v: WatchVersion) => {
    setLastSeen(v);
    void lastSeenStore.save(JSON.stringify(v)).catch(() => undefined);
  }, []);

  const refresh = useCallback(() => {
    // 更新手錶途中不另外去問手錶，免得和安裝後的確認搶著問
    if (isBusy(getPhase())) return;
    setChecking(true);
    const versions = fetchLatest()
      .then(setLatest)
      .catch(() => undefined); // 沒網路：留著上次查到的
    const probe = WatchLink.probe()
      .catch(() => ({ state: 'no-watch' as const }))
      .then(async (p) => {
        const remembered = parseWatchInfo(await lastSeenStore.load().catch(() => null));
        const state = watchStateFrom(p, remembered);
        if (state.kind === 'ok') sawWatch(state.installed);
        else setLastSeen(remembered);
        setWatch(state);
      });
    void Promise.all([versions, probe]).finally(() => setChecking(false));
  }, [sawWatch]);

  useEffect(() => {
    refresh();
    // 回到 App（例如剛把手錶拿過來、剛開藍牙）再查一次
    const sub = AppState.addEventListener('change', (s) => {
      if (s === 'active') refresh();
    });
    return () => sub.remove();
  }, [refresh]);

  const updateWatch = useCallback(() => {
    const rel = latest?.watch;
    if (!rel || isBusy(getPhase())) return;
    setPhase({ kind: 'downloading', fraction: 0 });
    void (async () => {
      // 傳送途中螢幕不要關：App 被系統收到背景，傳送可能中斷
      await activateKeepAwakeAsync(KEEP_AWAKE).catch(() => undefined);
      try {
        const final = await runWatchUpdate(
          {
            download: async (r, onProgress) => (await downloadApk(r, 'sprint-timer-wear', onProgress)).uri,
            send: (uri, build, version, onProgress) => WatchLink.sendUpdate(uri, build, version, onProgress),
            probe: () => WatchLink.probe(),
            onStatus: (cb) => WatchLink.onStatus(cb),
            sleep,
            now: () => Date.now(),
          },
          rel,
          setPhase,
        );
        if (final.kind === 'done') {
          sawWatch(final.installed);
          setWatch({ kind: 'ok', installed: final.installed });
        }
      } catch {
        setPhase({ kind: 'failed', reason: 'incomplete' });
      } finally {
        void deactivateKeepAwake(KEEP_AWAKE).catch(() => undefined);
      }
    })();
  }, [latest, sawWatch]);

  // 沒連上時用最新讀到的「上次看到的版本」
  const shown: WatchState | null = watch?.kind === 'away' ? { kind: 'away', lastSeen } : watch;
  const view = versionsView({ phone: { build: currentBuild(), version: currentVersion() }, latest, watch: shown, phase: current });
  return { view, latest, checking, refresh, updateWatch };
}

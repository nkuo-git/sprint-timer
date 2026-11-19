import type { WatchProbe } from '../../modules/watch-link';
import type { ReleaseInfo } from './version';

/**
 * 從手機更新手錶版 App 的流程（不含畫面、不碰原生模組，方便測試）。
 * 手機下載 Release 裡的手錶安裝檔 → 透過配對連線（藍牙）傳到手錶 → 手錶檢查並自己安裝 → 手機再問一次版本確認。
 * 手錶端：wear/app 的 PhoneLinkService；訊息格式定義在 wear/core 的 PhoneLink.kt。
 */
export interface WatchVersion {
  build: number;
  /** 顯示版本，例如 "0.8" */
  version: string;
}

/** 手錶目前的狀況（帳號頁「App 版本」的手錶那一列） */
export type WatchState =
  /** 這支手機沒有這個功能（iOS） */
  | { kind: 'unsupported' }
  /** 沒有連上手錶。lastSeen 是上次看到的版本 */
  | { kind: 'away'; lastSeen: WatchVersion | null }
  /** 連上了手錶，但手錶上沒有手錶版 App（或是還不能和手機互通的舊版） */
  | { kind: 'missing' }
  | { kind: 'ok'; installed: WatchVersion };

/** 手錶回報的版本：{"build":33,"version":"0.8"} */
export function parseWatchInfo(json: string | null | undefined): WatchVersion | null {
  try {
    const o = JSON.parse(json ?? '');
    if (!o || typeof o.build !== 'number' || !Number.isInteger(o.build) || o.build <= 0) return null;
    return { build: o.build, version: typeof o.version === 'string' && o.version ? o.version : `build-${o.build}` };
  } catch {
    return null;
  }
}

export function watchStateFrom(probe: WatchProbe, lastSeen: WatchVersion | null): WatchState {
  if (probe.state === 'unsupported') return { kind: 'unsupported' };
  if (probe.state === 'no-app') return { kind: 'missing' };
  const installed = probe.state === 'ok' ? parseWatchInfo(probe.json) : null;
  return installed ? { kind: 'ok', installed } : { kind: 'away', lastSeen };
}

export type WatchFailReason =
  /** 手機下載安裝檔失敗 */
  | 'download'
  /** 傳到一半斷線 */
  | 'incomplete'
  /** 手錶收到的不是這個 App 的安裝檔 */
  | 'bad-file'
  /** 手錶的系統不讓安裝 */
  | 'install-blocked'
  /** 等不到手錶裝好 */
  | 'timeout';

/** 手錶在更新途中回報的狀態：{"build":34,"state":"failed","reason":"incomplete"} */
export interface WatchStatus {
  build: number;
  state: 'installing' | 'needs-confirm' | 'failed';
  reason?: string;
}

export function parseWatchStatus(json: string | null | undefined): WatchStatus | null {
  try {
    const o = JSON.parse(json ?? '');
    if (!o || typeof o.build !== 'number') return null;
    if (o.state !== 'installing' && o.state !== 'needs-confirm' && o.state !== 'failed') return null;
    return { build: o.build, state: o.state, reason: typeof o.reason === 'string' ? o.reason : undefined };
  } catch {
    return null;
  }
}

export type WatchUpdatePhase =
  | { kind: 'idle' }
  | { kind: 'downloading'; fraction: number }
  | { kind: 'sending'; fraction: number }
  /** 檔案傳完了，手錶正在安裝。needsConfirm：手錶的系統要人在手錶上按確認 */
  | { kind: 'installing'; needsConfirm: boolean }
  | { kind: 'done'; installed: WatchVersion }
  | { kind: 'failed'; reason: WatchFailReason };

export function isBusy(p: WatchUpdatePhase): boolean {
  return p.kind === 'downloading' || p.kind === 'sending' || p.kind === 'installing';
}

/** 失敗時顯示的說明。oldVersion 是手錶上原本的顯示版本（知道的話）。 */
export function failText(reason: WatchFailReason, oldVersion: string | null): string {
  const why = {
    download: '手機下載新版失敗，請確認手機連得上網路。',
    incomplete: '傳送到一半和手錶斷線了。',
    'bad-file': '手錶收到的安裝檔不對。',
    'install-blocked': '手錶的系統沒有讓新版安裝。',
    timeout: '一直等不到手錶裝好。請打開手錶上的 App 看看有沒有更新成功。',
  }[reason];
  const still = oldVersion ? `手錶上還是原本的 v${oldVersion}，可以照常使用。` : '手錶上還是原本的版本，可以照常使用。';
  return `更新沒有完成：${why}${reason === 'timeout' ? '' : still}`;
}

function failReasonFromWatch(reason: string | undefined): WatchFailReason {
  return reason === 'incomplete' || reason === 'bad-file' || reason === 'install-blocked' ? reason : 'install-blocked';
}

export interface WatchUpdateDeps {
  /** 下載手錶安裝檔，回傳檔案位置 */
  download(rel: ReleaseInfo, onProgress: (fraction: number) => void): Promise<string>;
  /** 把檔案傳到手錶，傳完才結束 */
  send(fileUri: string, build: number, version: string, onProgress: (fraction: number) => void): Promise<void>;
  probe(): Promise<WatchProbe>;
  /** 訂閱手錶回報的狀態（JSON 字串），回傳取消訂閱 */
  onStatus(cb: (json: string) => void): () => void;
  sleep(ms: number): Promise<void>;
  now(): number;
}

/**
 * 跑完一次「更新手錶」。每個階段呼叫 onPhase，最後一個一定是 done 或 failed（也當作回傳值）。
 * 成功與否以「手錶回報的版本已經是新版」為準：安裝成功時手錶 App 會被系統關掉，不會自己說「好了」。
 */
export async function runWatchUpdate(
  deps: WatchUpdateDeps,
  rel: ReleaseInfo,
  onPhase: (p: WatchUpdatePhase) => void,
  opts: { pollMs?: number; timeoutMs?: number } = {},
): Promise<WatchUpdatePhase> {
  const pollMs = opts.pollMs ?? 3000;
  const timeoutMs = opts.timeoutMs ?? 180_000;
  const end = (p: WatchUpdatePhase) => {
    onPhase(p);
    return p;
  };
  /** 手錶已經是這一版（或更新）就回傳它的版本 */
  const installedTarget = async (): Promise<WatchVersion | null> => {
    try {
      const probe = await deps.probe();
      const v = probe.state === 'ok' ? parseWatchInfo(probe.json) : null;
      return v && v.build >= rel.build ? v : null;
    } catch {
      return null;
    }
  };

  onPhase({ kind: 'downloading', fraction: 0 });
  let fileUri: string;
  try {
    fileUri = await deps.download(rel, (fraction) => onPhase({ kind: 'downloading', fraction }));
  } catch {
    return end({ kind: 'failed', reason: 'download' });
  }

  let status: WatchStatus | null = null;
  const off = deps.onStatus((json) => {
    const s = parseWatchStatus(json);
    if (s && s.build === rel.build) status = s;
  });
  const failedStatus = (): WatchStatus | null => (status?.state === 'failed' ? status : null);
  try {
    onPhase({ kind: 'sending', fraction: 0 });
    try {
      await deps.send(fileUri, rel.build, rel.version, (fraction) => onPhase({ kind: 'sending', fraction }));
    } catch {
      return end({ kind: 'failed', reason: 'incomplete' });
    }

    const deadline = deps.now() + timeoutMs;
    let needsConfirm = false;
    onPhase({ kind: 'installing', needsConfirm });
    while (deps.now() < deadline) {
      await deps.sleep(pollMs);
      const installed = await installedTarget();
      if (installed) return end({ kind: 'done', installed });
      // 手錶說失敗：例如它其實已經是這一版（上面已經確認過不是），或檔案不完整、系統不給裝
      const failed = failedStatus();
      if (failed) return end({ kind: 'failed', reason: failReasonFromWatch(failed.reason) });
      const confirm = (status as WatchStatus | null)?.state === 'needs-confirm';
      if (confirm !== needsConfirm) {
        needsConfirm = confirm;
        onPhase({ kind: 'installing', needsConfirm });
      }
    }
    return end({ kind: 'failed', reason: 'timeout' });
  } finally {
    off();
  }
}

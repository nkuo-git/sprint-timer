import { requireOptionalNativeModule } from 'expo-modules-core';

/**
 * 手機 App ↔ 配對手錶上的手錶版 App（Wear OS，走藍牙配對連線，不需要同一個 Wi-Fi）。
 * 只有 Android 有；iOS 或舊版安裝檔沒有這個原生模組時，probe() 回 'unsupported'。
 * 手錶端：wear/app 的 PhoneLinkService。
 */
export interface WatchProbe {
  /**
   * unsupported：這支手機沒有這個功能（iOS）
   * no-watch：沒有連上任何手錶
   * no-app：連上了手錶，但手錶上沒有手錶版 App
   * no-reply：手錶版 App 沒回應
   * ok：json 是手錶回報的版本
   */
  state: 'unsupported' | 'no-watch' | 'no-app' | 'no-reply' | 'ok';
  watchName?: string;
  /** state = ok 時：{"build":33,"version":"0.8"} */
  json?: string;
  error?: string;
}

interface Subscription {
  remove(): void;
}

interface NativeModule {
  getWatchInfo(): Promise<WatchProbe>;
  sendUpdate(fileUri: string, build: number, version: string): Promise<void>;
  addListener(event: 'onSendProgress', cb: (e: { sent: number; total: number }) => void): Subscription;
  addListener(event: 'onWatchStatus', cb: (e: { json: string }) => void): Subscription;
}

const Native = requireOptionalNativeModule<NativeModule>('WatchLink');

export const WatchLink = {
  supported: !!Native,

  /** 找配對的手錶並問它裝的版本（最久約 10 秒） */
  probe: async (): Promise<WatchProbe> => (Native ? Native.getWatchInfo() : { state: 'unsupported' }),

  /** 把安裝檔傳到手錶。傳完才結束；之後手錶檢查、安裝的結果從 onStatus 和下一次 probe() 得知。 */
  async sendUpdate(fileUri: string, build: number, version: string, onProgress?: (fraction: number) => void): Promise<void> {
    if (!Native) throw new Error('這支手機不支援更新手錶');
    const sub = Native.addListener('onSendProgress', (e) => {
      if (e.total > 0) onProgress?.(Math.min(1, e.sent / e.total));
    });
    try {
      await Native.sendUpdate(fileUri, build, version);
    } finally {
      sub.remove();
    }
  },

  /** 手錶回報的更新狀態（JSON 字串，格式見 src/update/watch.ts 的 parseWatchStatus）。回傳取消訂閱的函式。 */
  onStatus(cb: (json: string) => void): () => void {
    if (!Native) return () => {};
    const sub = Native.addListener('onWatchStatus', (e) => cb(e.json));
    return () => sub.remove();
  },
};

import { describe, expect, it } from 'vitest';
import type { WatchProbe } from '../modules/watch-link';
import { pickLatest, type ReleaseInfo } from '../src/update/version';
import { failText, parseWatchInfo, parseWatchStatus, runWatchUpdate, watchStateFrom, type WatchUpdateDeps, type WatchUpdatePhase } from '../src/update/watch';

const release = {
  tag_name: 'build-34',
  name: 'v0.9',
  body: '自動建置',
  assets: [
    { name: 'sprint-timer.apk', size: 32_000_000, browser_download_url: 'https://e/sprint-timer.apk' },
    { name: 'sprint-timer-wear.apk', size: 17_000_000, browser_download_url: 'https://e/sprint-timer-wear.apk' },
  ],
};
const rel = pickLatest(release).watch as ReleaseInfo;
const ok = (build: number, version: string): WatchProbe => ({ state: 'ok', watchName: 'Pixel Watch', json: JSON.stringify({ build, version }) });

describe('最新版本：手機和手錶各自的安裝檔', () => {
  it('同一個 Release 取出兩個安裝檔', () => {
    const latest = pickLatest(release);
    expect(latest.phone).toMatchObject({ build: 34, version: '0.9', apkUrl: 'https://e/sprint-timer.apk' });
    expect(latest.watch).toMatchObject({ build: 34, version: '0.9', apkUrl: 'https://e/sprint-timer-wear.apk', sizeBytes: 17_000_000 });
  });
  it('舊的 Release 沒有手錶安裝檔', () => {
    const latest = pickLatest({ ...release, assets: release.assets.slice(0, 1) });
    expect(latest.phone?.build).toBe(34);
    expect(latest.watch).toBeNull();
  });
});

describe('手錶的狀況', () => {
  it('讀手錶回報的版本', () => {
    expect(parseWatchInfo('{"build":33,"version":"0.8"}')).toEqual({ build: 33, version: '0.8' });
    expect(parseWatchInfo('{"build":33}')).toEqual({ build: 33, version: 'build-33' });
    expect(parseWatchInfo('{"build":"33"}')).toBeNull();
    expect(parseWatchInfo('oops')).toBeNull();
    expect(parseWatchInfo(undefined)).toBeNull();
  });
  it('連上、沒連上、沒安裝、不支援', () => {
    const last = { build: 33, version: '0.8' };
    expect(watchStateFrom(ok(33, '0.8'), null)).toEqual({ kind: 'ok', installed: last });
    expect(watchStateFrom({ state: 'no-watch' }, last)).toEqual({ kind: 'away', lastSeen: last });
    expect(watchStateFrom({ state: 'no-reply' }, null)).toEqual({ kind: 'away', lastSeen: null });
    expect(watchStateFrom({ state: 'ok', json: 'garbage' }, last)).toEqual({ kind: 'away', lastSeen: last });
    expect(watchStateFrom({ state: 'no-app', watchName: 'Pixel Watch' }, last)).toEqual({ kind: 'missing' });
    expect(watchStateFrom({ state: 'unsupported' }, last)).toEqual({ kind: 'unsupported' });
  });
  it('讀手錶回報的更新狀態', () => {
    expect(parseWatchStatus('{"build":34,"state":"failed","reason":"incomplete"}')).toEqual({ build: 34, state: 'failed', reason: 'incomplete' });
    expect(parseWatchStatus('{"build":34,"state":"installing"}')).toEqual({ build: 34, state: 'installing', reason: undefined });
    expect(parseWatchStatus('{"build":34,"state":"dancing"}')).toBeNull();
    expect(parseWatchStatus('')).toBeNull();
  });
});

/** 假的手機與手錶：時間是假的，sleep 直接把時鐘往前撥 */
function fake(over: Partial<WatchUpdateDeps> & { probes?: WatchProbe[] } = {}) {
  let t = 0;
  const probes = [...(over.probes ?? [])];
  let statusCb: ((json: string) => void) | null = null;
  const log: string[] = [];
  const deps: WatchUpdateDeps = {
    download: async (_r, onProgress) => {
      onProgress(1);
      log.push('download');
      return 'file:///cache/updates/sprint-timer-wear-34.apk';
    },
    send: async (uri, build, version, onProgress) => {
      onProgress(0.5);
      onProgress(1);
      log.push(`send ${uri.split('/').pop()} ${build} ${version}`);
    },
    probe: async () => probes.shift() ?? { state: 'no-reply' },
    onStatus: (cb) => {
      statusCb = cb;
      return () => {
        statusCb = null;
        log.push('unsubscribed');
      };
    },
    sleep: async (ms) => {
      t += ms;
    },
    now: () => t,
    ...over,
  };
  return { deps, log, say: (o: object) => statusCb?.(JSON.stringify(o)), listening: () => statusCb !== null };
}

async function run(f: ReturnType<typeof fake>) {
  const phases: WatchUpdatePhase[] = [];
  const last = await runWatchUpdate(f.deps, rel, (p) => phases.push(p), { pollMs: 3000, timeoutMs: 30_000 });
  return { phases, last, kinds: phases.map((p) => p.kind).filter((k, i, a) => k !== a[i - 1]) };
}

describe('從手機更新手錶', () => {
  it('下載 → 傳送 → 等手錶裝好：以手錶回報新版本為準', async () => {
    // 安裝途中手錶 App 被系統關掉，前兩次問不到；第三次回報新版
    const f = fake({ probes: [{ state: 'no-reply' }, ok(33, '0.8'), ok(34, '0.9')] });
    const r = await run(f);
    expect(r.kinds).toEqual(['downloading', 'sending', 'installing', 'done']);
    expect(r.last).toEqual({ kind: 'done', installed: { build: 34, version: '0.9' } });
    expect(f.log).toEqual(['download', 'send sprint-timer-wear-34.apk 34 0.9', 'unsubscribed']);
    expect(f.listening()).toBe(false);
  });

  it('手機下載失敗：不會去傳', async () => {
    const f = fake({
      download: async () => {
        throw new Error('offline');
      },
    });
    const r = await run(f);
    expect(r.last).toEqual({ kind: 'failed', reason: 'download' });
    expect(f.log).toEqual([]);
  });

  it('傳到一半斷線', async () => {
    const f = fake({
      send: async () => {
        throw new Error('channel closed');
      },
    });
    expect((await run(f)).last).toEqual({ kind: 'failed', reason: 'incomplete' });
    expect(f.listening()).toBe(false);
  });

  it('手錶說檔案不完整或系統不給裝', async () => {
    for (const reason of ['incomplete', 'bad-file', 'install-blocked'] as const) {
      const f = fake({ probes: [ok(33, '0.8')] });
      const send = f.deps.send;
      f.deps.send = async (...a) => {
        await send(...a);
        f.say({ build: 34, state: 'failed', reason });
      };
      expect((await run(f)).last).toEqual({ kind: 'failed', reason });
    }
  });

  it('手錶說失敗，但其實已經是新版（例如已經裝過）：算成功', async () => {
    const f = fake({ probes: [ok(34, '0.9')] });
    const send = f.deps.send;
    f.deps.send = async (...a) => {
      await send(...a);
      f.say({ build: 34, state: 'failed', reason: 'not-newer' });
    };
    expect((await run(f)).last.kind).toBe('done');
  });

  it('別的版本的狀態訊息不理會', async () => {
    const f = fake({ probes: [ok(33, '0.8'), ok(34, '0.9')] });
    const send = f.deps.send;
    f.deps.send = async (...a) => {
      await send(...a);
      f.say({ build: 31, state: 'failed', reason: 'incomplete' });
    };
    expect((await run(f)).last.kind).toBe('done');
  });

  it('手錶要人按確認：畫面提示，按了之後完成', async () => {
    const f = fake({ probes: [ok(33, '0.8'), ok(33, '0.8'), ok(34, '0.9')] });
    const send = f.deps.send;
    f.deps.send = async (...a) => {
      await send(...a);
      f.say({ build: 34, state: 'needs-confirm' });
    };
    const r = await run(f);
    expect(r.phases).toContainEqual({ kind: 'installing', needsConfirm: true });
    expect(r.last.kind).toBe('done');
  });

  it('一直等不到手錶裝好', async () => {
    const r = await run(fake());
    expect(r.last).toEqual({ kind: 'failed', reason: 'timeout' });
  });

  it('失敗說明', () => {
    expect(failText('incomplete', '0.8')).toBe('更新沒有完成：傳送到一半和手錶斷線了。手錶上還是原本的 v0.8，可以照常使用。');
    expect(failText('download', null)).toContain('手錶上還是原本的版本');
    expect(failText('timeout', '0.8')).not.toContain('還是原本');
  });
});

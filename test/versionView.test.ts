import { describe, expect, it } from 'vitest';
import { pickLatest } from '../src/update/version';
import { versionsView } from '../src/update/versionView';
import type { WatchState, WatchUpdatePhase } from '../src/update/watch';

const latest = pickLatest({
  tag_name: 'build-34',
  name: 'v0.9',
  assets: [
    { name: 'sprint-timer.apk', size: 1, browser_download_url: 'https://e/p.apk' },
    { name: 'sprint-timer-wear.apk', size: 1, browser_download_url: 'https://e/w.apk' },
  ],
});
const idle: WatchUpdatePhase = { kind: 'idle' };
const onWatch = (build: number, version: string): WatchState => ({ kind: 'ok', installed: { build, version } });
const view = (o: { phoneBuild?: number | null; watch?: WatchState | null; phase?: WatchUpdatePhase; latest?: typeof latest | null }) =>
  versionsView({
    phone: o.phoneBuild === null ? { build: null, version: null } : { build: o.phoneBuild ?? 34, version: (o.phoneBuild ?? 34) === 34 ? '0.9' : '0.8' },
    latest: o.latest === undefined ? latest : o.latest,
    watch: o.watch === undefined ? onWatch(34, '0.9') : o.watch,
    phase: o.phase ?? idle,
  });

describe('帳號頁「App 版本」（設計稿 24）', () => {
  it('都是最新版', () => {
    const x = view({});
    expect(x.phone).toMatchObject({ value: 'v0.9', note: '已是最新版', tone: 'ok', canUpdate: false });
    expect(x.watch).toMatchObject({ value: 'v0.9', note: '已是最新版', tone: 'ok', canUpdate: false });
    expect(x.watchAction).toBeNull();
    expect(x.hint).toBe('有新版時，可以直接從這裡把手錶更新到最新版。');
  });
  it('手錶有新版', () => {
    const x = view({ watch: onWatch(33, '0.8') });
    expect(x.watch).toMatchObject({ value: 'v0.8', note: '最新版本 v0.9', tone: 'new', canUpdate: true });
    expect(x.watchAction).toBe('更新手錶');
    expect(x.hint).toContain('按「更新手錶」');
  });
  it('手機和手錶都有新版', () => {
    const x = view({ phoneBuild: 33, watch: onWatch(33, '0.8') });
    expect(x.phone).toMatchObject({ value: 'v0.8', note: '最新版本 v0.9', tone: 'new', canUpdate: true });
    expect(x.watchAction).toBe('更新手錶');
  });
  it('沒連上手錶：顯示上次看到的版本', () => {
    const x = view({ watch: { kind: 'away', lastSeen: { build: 33, version: '0.8' } } });
    expect(x.watch).toMatchObject({ value: '沒有連上', isVersion: false, note: '最新版本 v0.9', tone: 'dim', canUpdate: false });
    expect(x.hint).toBe('手錶要和這支手機用藍牙配對，並且在手機旁邊，才看得到手錶的版本。上次看到的是 v0.8。');
    expect(view({ watch: { kind: 'away', lastSeen: null } }).hint).not.toContain('上次');
  });
  it('手錶還沒安裝', () => {
    const x = view({ watch: { kind: 'missing' } });
    expect(x.watch).toMatchObject({ value: '還沒安裝', canUpdate: false });
    expect(x.hint).toContain('無線偵錯');
  });
  it('iOS：沒有手錶那一列', () => {
    const x = view({ watch: { kind: 'unsupported' }, latest: { phone: null, watch: null } });
    expect(x.watch).toBeNull();
    expect(x.phone.note).toBe('');
  });
  it('沒網路查不到最新版本：不會出現更新按鈕', () => {
    const x = view({ latest: null, phoneBuild: 33, watch: onWatch(33, '0.8') });
    expect(x.phone).toMatchObject({ note: '查不到最新版本', tone: 'dim', canUpdate: false });
    expect(x.watch).toMatchObject({ value: 'v0.8', note: '查不到最新版本', canUpdate: false });
  });
  it('開發版、還在查手錶', () => {
    const x = view({ phoneBuild: null, watch: null });
    expect(x.phone).toMatchObject({ value: '開發版', canUpdate: false });
    expect(x.watch).toMatchObject({ value: '檢查中…' });
    expect(x.hint).toBeNull();
  });
});

describe('更新手錶中（設計稿 25）', () => {
  const old = onWatch(33, '0.8');
  it('傳送中', () => {
    const x = view({ watch: old, phoneBuild: 33, phase: { kind: 'sending', fraction: 0.42 } });
    expect(x.watch).toMatchObject({ value: 'v0.8', note: '正在更新到 v0.9', canUpdate: false });
    expect(x.progress).toEqual({ label: '傳送到手錶…', fraction: 0.42, showPercent: true });
    expect(x.hint).toContain('用藍牙傳送');
    expect(x.busy).toBe(true);
    expect(x.watchAction).toBeNull();
    // 更新手錶途中不讓人同時去更新手機
    expect(x.phone.canUpdate).toBe(false);
  });
  it('下載、安裝中、要在手錶上確認', () => {
    expect(view({ watch: old, phase: { kind: 'downloading', fraction: 0.1 } }).progress?.label).toBe('下載新版…');
    const installing = view({ watch: old, phase: { kind: 'installing', needsConfirm: false } });
    expect(installing.progress).toEqual({ label: '手錶安裝中…', fraction: 1, showPercent: false });
    expect(installing.hint).toContain('傳送完成');
    expect(view({ watch: old, phase: { kind: 'installing', needsConfirm: true } }).progress?.label).toBe('請在手錶上按確認…');
  });
  it('完成', () => {
    const x = view({ phase: { kind: 'done', installed: { build: 34, version: '0.9' } } });
    expect(x.watch).toMatchObject({ value: 'v0.9', note: '已是最新版' });
    expect(x.banner).toEqual({ tone: 'info', text: '手錶已更新到 v0.9。' });
    expect(x.watchAction).toBeNull();
  });
  it('失敗：可以再試一次', () => {
    const x = view({ watch: old, phase: { kind: 'failed', reason: 'incomplete' } });
    expect(x.banner).toEqual({ tone: 'bad', text: '更新沒有完成：傳送到一半和手錶斷線了。手錶上還是原本的 v0.8，可以照常使用。' });
    expect(x.watchAction).toBe('再試一次');
    expect(x.watch?.note).toBe('最新版本 v0.9');
  });
  it('失敗後手錶也斷線了：沒有按鈕', () => {
    const x = view({ watch: { kind: 'away', lastSeen: { build: 33, version: '0.8' } }, phase: { kind: 'failed', reason: 'incomplete' } });
    expect(x.watchAction).toBeNull();
    expect(x.banner?.tone).toBe('bad');
  });
});

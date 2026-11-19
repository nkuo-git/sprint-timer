import { isNewer, type LatestReleases } from './version';
import { failText, isBusy, type WatchState, type WatchUpdatePhase } from './watch';

/**
 * 帳號頁「App 版本」區塊要顯示的文字（設計稿 24、25）。只算文字與狀態，畫面在 VersionSection.tsx。
 */
export interface VersionRow {
  /** 大字：目前版本（v0.8），或「沒有連上」「還沒安裝」 */
  value: string;
  /** 大字是不是版本號（不是的話字小一點、顏色淡一點） */
  isVersion: boolean;
  /** 旁邊的小字：已是最新版／最新版本 v0.9／正在更新到 v0.9 */
  note: string;
  /** ok = 藍（已是最新）、new = 黃（有新版）、dim = 灰 */
  tone: 'ok' | 'new' | 'dim';
  /** 要不要顯示「更新」按鈕 */
  canUpdate: boolean;
}

export interface VersionsView {
  phone: VersionRow;
  /** null = 這支手機沒有手錶功能（iOS），不顯示手錶那一列 */
  watch: VersionRow | null;
  /** 手錶那一列下面的進度條；null = 不顯示 */
  progress: { label: string; fraction: number; showPercent: boolean } | null;
  /** 區塊下面的灰色說明 */
  hint: string | null;
  /** 藍底（完成）或紅底（失敗）的訊息 */
  banner: { tone: 'info' | 'bad'; text: string } | null;
  /** 手錶那一列的按鈕文字；null = 沒有按鈕 */
  watchAction: '更新手錶' | '再試一次' | null;
  /** 更新手錶進行中：其他按鈕先收起來 */
  busy: boolean;
}

const v = (version: string) => (/^\d/.test(version) ? `v${version}` : version);

export function versionsView(input: {
  /** 這支手機裝的版本；開發版是 null */
  phone: { build: number | null; version: string | null };
  /** 最新一版 Release；null = 還沒查到（沒網路） */
  latest: LatestReleases | null;
  /** null = 還在查 */
  watch: WatchState | null;
  phase: WatchUpdatePhase;
}): VersionsView {
  const { latest, watch, phase } = input;
  const busy = isBusy(phase);

  const phoneNew = isNewer(latest?.phone ?? null, input.phone.build);
  const phone: VersionRow = {
    value: input.phone.version ? v(input.phone.version) : '開發版',
    isVersion: !!input.phone.version,
    note: !latest?.phone ? (latest ? '' : '查不到最新版本') : phoneNew ? `最新版本 ${v(latest.phone.version)}` : input.phone.build === null ? `最新版本 ${v(latest.phone.version)}` : '已是最新版',
    tone: !latest?.phone || input.phone.build === null ? 'dim' : phoneNew ? 'new' : 'ok',
    canUpdate: phoneNew && !busy,
  };

  if (watch?.kind === 'unsupported') return { phone, watch: null, progress: null, hint: null, banner: null, watchAction: null, busy: false };

  const target = latest?.watch ?? null;
  const latestNote = target ? `最新版本 ${v(target.version)}` : latest ? '' : '查不到最新版本';
  const installed = watch?.kind === 'ok' ? watch.installed : null;
  const watchNew = !!installed && isNewer(target, installed.build);

  let row: VersionRow;
  if (!watch) row = { value: '檢查中…', isVersion: false, note: '', tone: 'dim', canUpdate: false };
  else if (watch.kind === 'away') row = { value: '沒有連上', isVersion: false, note: latestNote, tone: 'dim', canUpdate: false };
  else if (watch.kind === 'missing') row = { value: '還沒安裝', isVersion: false, note: latestNote, tone: 'dim', canUpdate: false };
  else if (busy && target) row = { value: v(watch.installed.version), isVersion: true, note: `正在更新到 ${v(target.version)}`, tone: 'dim', canUpdate: false };
  else if (watchNew) row = { value: v(watch.installed.version), isVersion: true, note: latestNote, tone: 'new', canUpdate: true };
  else row = { value: v(watch.installed.version), isVersion: true, note: target ? '已是最新版' : latestNote, tone: target ? 'ok' : 'dim', canUpdate: false };

  let progress: VersionsView['progress'] = null;
  let hint: string | null;
  let banner: VersionsView['banner'] = null;
  if (phase.kind === 'downloading') {
    progress = { label: '下載新版…', fraction: phase.fraction, showPercent: true };
    hint = '手機先下載手錶的新版，接著用藍牙傳到手錶。請讓這個畫面保持開著。';
  } else if (phase.kind === 'sending') {
    progress = { label: '傳送到手錶…', fraction: phase.fraction, showPercent: true };
    hint = '用藍牙傳送，大約要幾分鐘。請讓手錶留在手機旁邊，這個畫面保持開著。';
  } else if (phase.kind === 'installing') {
    progress = { label: phase.needsConfirm ? '請在手錶上按確認…' : '手錶安裝中…', fraction: 1, showPercent: false };
    hint = phase.needsConfirm ? '手錶的系統要你確認安裝。請看手錶，按下確認。' : '傳送完成，手錶正在安裝。裝好後這裡會顯示新的版本。';
  } else if (!watch) {
    hint = null;
  } else if (watch.kind === 'away') {
    hint = `手錶要和這支手機用藍牙配對，並且在手機旁邊，才看得到手錶的版本。${watch.lastSeen ? `上次看到的是 ${v(watch.lastSeen.version)}。` : ''}`;
  } else if (watch.kind === 'missing') {
    hint = '手錶上找不到手錶版 App。第一次要用無線偵錯安裝，裝好後就能從這裡更新。';
  } else if (watchNew) {
    hint = '按「更新手錶」，手機會把新版傳到手錶並安裝，不用在手錶上操作。';
  } else {
    hint = '有新版時，可以直接從這裡把手錶更新到最新版。';
  }

  if (phase.kind === 'done') {
    banner = { tone: 'info', text: `手錶已更新到 ${v(phase.installed.version)}。` };
    hint = null;
  } else if (phase.kind === 'failed') {
    banner = { tone: 'bad', text: failText(phase.reason, installed?.version ?? null) };
    hint = null;
  }

  // 失敗後還能更新（手錶連著、確實有新版）才給「再試一次」
  const watchAction = busy ? null : phase.kind === 'failed' && row.canUpdate ? '再試一次' : row.canUpdate ? '更新手錶' : null;
  return { phone, watch: row, progress, hint, banner, watchAction, busy };
}

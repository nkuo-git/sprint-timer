import type { RaceMode, Runner, StoredRace } from './types';
import type { RaceInput } from './store';

/** 頭像上的字：暱稱的第一個字（英文轉大寫） */
export function initial(name: string | null | undefined): string {
  const first = [...(name ?? '').trim()][0];
  return first ? first.toUpperCase() : '?';
}

export function distanceLabel(m: number | null): string {
  return m === null ? '未設定距離' : `${Number.isInteger(m) ? m : m.toFixed(1)}m`;
}

export function modeLabel(mode: RaceMode): string {
  return mode === 'two-phone' ? '雙手機' : '單手機';
}

const pad = (n: number) => String(n).padStart(2, '0');

/** 用手機的時區顯示「16:42」 */
export function clockLabel(iso: string): string {
  const d = new Date(iso);
  return `${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/** 同一天的 key（手機時區） */
export function dayKey(iso: string): string {
  const d = new Date(iso);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/** 「今天 · 11 月 19 日」「11 月 12 日」「2025 年 3 月 2 日」 */
export function dayLabel(iso: string, now: Date = new Date()): string {
  const d = new Date(iso);
  const md = `${d.getMonth() + 1} 月 ${d.getDate()} 日`;
  if (dayKey(iso) === dayKey(now.toISOString())) return `今天 · ${md}`;
  return d.getFullYear() === now.getFullYear() ? md : `${d.getFullYear()} 年 ${md}`;
}

/** 依日期分組（輸入已經是新的在前） */
export function groupByDay<T extends { ranAt: string }>(items: T[]): { key: string; items: T[] }[] {
  const groups: { key: string; items: T[] }[] = [];
  for (const it of items) {
    const key = dayKey(it.ranAt);
    const last = groups[groups.length - 1];
    if (last && last.key === key) last.items.push(it);
    else groups.push({ key, items: [it] });
  }
  return groups;
}

/** 同一個人（自己或某個用戶）在一趟裡只能出現一次 */
export function sameRunner(a: Runner | null, b: Runner | null): boolean {
  if (!a || !b) return false;
  if (a.kind === 'self' && b.kind === 'self') return true;
  return a.kind === 'user' && b.kind === 'user' && a.id === b.id;
}

/** 事後在紀錄裡重新標記某一筆成績（回傳要存的比賽內容） */
export function retag(race: StoredRace, resultId: string, runner: Runner | null): RaceInput {
  const clean: Runner | null = runner?.kind === 'name' ? { kind: 'name', name: runner.name.trim().slice(0, 40) } : runner;
  return {
    id: race.id,
    ranAt: race.ranAt,
    distanceM: race.distanceM,
    mode: race.mode,
    signal: race.signal,
    results: race.results.map((r) => {
      if (r.id === resultId) return { ...r, runner: clean };
      return sameRunner(r.runner, clean) ? { ...r, runner: null } : r;
    }),
  };
}

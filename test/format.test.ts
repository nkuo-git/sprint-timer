import { describe, expect, it } from 'vitest';
import { dayLabel, distanceLabel, groupByDay, initial, retag } from '../src/records/format';
import type { StoredRace } from '../src/records/types';

describe('紀錄的顯示', () => {
  it('頭像取暱稱第一個字', () => {
    expect(initial('nick')).toBe('N');
    expect(initial(' 小安')).toBe('小');
    expect(initial('')).toBe('?');
    expect(initial(null)).toBe('?');
  });

  it('距離', () => {
    expect(distanceLabel(100)).toBe('100m');
    expect(distanceLabel(36.5)).toBe('36.5m');
    expect(distanceLabel(null)).toBe('未設定距離');
  });

  it('日期：今天、今年、往年', () => {
    const now = new Date(2026, 10, 19, 15, 0);
    expect(dayLabel(new Date(2026, 10, 19, 8, 0).toISOString(), now)).toBe('今天 · 11 月 19 日');
    expect(dayLabel(new Date(2026, 10, 12, 8, 0).toISOString(), now)).toBe('11 月 12 日');
    expect(dayLabel(new Date(2025, 2, 2, 8, 0).toISOString(), now)).toBe('2025 年 3 月 2 日');
  });

  it('依日期分組，保持原本順序', () => {
    const at = (d: number, h: number) => ({ ranAt: new Date(2026, 10, d, h).toISOString() });
    const groups = groupByDay([at(19, 16), at(19, 9), at(12, 17)]);
    expect(groups.map((g) => g.items.length)).toEqual([2, 1]);
  });

  it('事後補標記：同一個人在一趟裡只留一筆', () => {
    const race: StoredRace = {
      id: 'r',
      ranAt: '2026-11-19T08:00:00.000Z',
      distanceM: 100,
      mode: 'two-phone',
      owner: 'me',
      dirty: false,
      rev: 1,
      results: [
        { id: 'a', place: 1, time: 10.9, official: 10.9, auto: true, runner: { kind: 'self' } },
        { id: 'b', place: 2, time: 11.1, official: 11.1, auto: true, runner: { kind: 'name', name: '阿凱' } },
      ],
    };
    const next = retag(race, 'b', { kind: 'self' });
    expect(next.results.map((r) => r.runner)).toEqual([null, { kind: 'self' }]);
    expect(retag(race, 'b', null).results[1].runner).toBeNull();
    expect(retag(race, 'a', { kind: 'name', name: ' 路人 ' }).results[0].runner).toEqual({ kind: 'name', name: '路人' });
    expect(race.results[0].runner).toEqual({ kind: 'self' });
  });
});

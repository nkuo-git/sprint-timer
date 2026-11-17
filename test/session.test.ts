import { describe, expect, it } from 'vitest';
import { frameToView, viewToFrame } from '../src/camera/mapping';
import { FinishSession } from '../src/finish/session';

describe('終點 session', () => {
  it('累積跑者、手動補人與調整、算名次與成績', () => {
    const s = new FinishSession();
    s.handle({ type: 'line', found: true, locked: true, xTop: 0.5, yTop: 0.4, xBot: 0.5, yBot: 0.9, tiltDeg: 0, scanTop: 0 });
    expect(s.phase).toBe('aim');
    s.handle({ type: 'armed', t: 99 });
    s.handle({ type: 'strip', t: [100, 100.01], d: [1, 2, 3, 4], rows: 2 });
    const base = { type: 'runner' as const, rowLo: 0, rowHi: 1, yTop: 0, yBot: 1, speedPxPerSec: 1, frameInterval: 0.01, rowsUsed: 3 };
    s.handle({ ...base, id: 2, t: 111.2345, thumb: { w: 2, h: 2, data: [0, 50, 100, 255], lineXTop: 1, lineXBot: 1, t: 111.2 } });
    s.handle({ ...base, id: 1, t: 110.9, thumb: null });
    s.handle({ ...base, id: 3, t: 95, thumb: null }); // 鳴槍前有人走過
    const m = s.addManual(111.0, '小明');
    s.moveMark(2, 111.231);
    const r = s.results(100);
    expect(r.map((x) => x.id)).toEqual([1, m.id, 2]);
    expect(r[0]).toMatchObject({ place: 1, official: 10.9 });
    expect(r[2].time).toBeCloseTo(11.231, 6);
    expect(r[2].official).toBe(11.24);
    expect(r[2].auto).toBe(false);
    expect(s.marks.find((x) => x.id === 2)!.thumbUri).toMatch(/^data:image\/png;base64,/);
    expect(s.strip.length).toBe(2);
    s.removeMark(1);
    expect(s.results(100).length).toBe(2);
  });
});

describe('座標換算', () => {
  it('cover / contain 來回一致', () => {
    for (const mode of ['cover', 'contain'] as const) {
      const p = viewToFrame(120, 300, 390, 700, 720, 1280, mode)!;
      const v = frameToView(p.x, p.y, 390, 700, 720, 1280, mode);
      expect(v.x).toBeCloseTo(120, 6);
      expect(v.y).toBeCloseTo(300, 6);
    }
    // contain 留邊的地方點了無效
    expect(viewToFrame(2, 300, 600, 700, 720, 1280, 'contain')).toBeNull();
  });
});

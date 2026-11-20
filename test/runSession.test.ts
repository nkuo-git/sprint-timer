import { describe, expect, it } from 'vitest';
import { decodePolyline, trackLength } from '../src/core/gpsTrack';
import type { RunInput } from '../src/records/store';
import { averagePace, durationLabel, finishAnnouncement, kmAnnouncement, kmLabel, paceLabel, spokenDuration, targetLabel } from '../src/run/format';
import { RunSession, toRunInput, type LocationPermission, type LocationSource, type RawFix } from '../src/run/session';

const LAT0 = 25.05;
const LON0 = 121.55;
const M_PER_DEG_LAT = 111194.93;
const M_PER_DEG_LON = M_PER_DEG_LAT * Math.cos((LAT0 * Math.PI) / 180);

/** 假的手機：時鐘、定位、語音、存檔 */
function rig(opts: { permission?: LocationPermission; canTrack?: boolean; gpsClockAheadMs?: number } = {}) {
  let nowMs = 1_800_000_000_000;
  let permission = opts.permission ?? 'granted';
  /** 目前開著的定位（前景、背景各自獨立；交接的瞬間可能兩個都開著） */
  const subs = new Set<{ onFix: (fix: RawFix) => void }>();
  const subscribe = (onFix: (fix: RawFix) => void, name: string) => {
    log.push(name);
    const sub = { onFix };
    subs.add(sub);
    return () => {
      log.push(`un${name}`);
      subs.delete(sub);
    };
  };
  const log: string[] = [];
  const spoken: string[] = [];
  const saved: RunInput[] = [];
  let ids = 0;
  const location: LocationSource = {
    permission: async () => permission,
    request: async () => {
      log.push('request');
      permission = 'granted';
      return permission;
    },
    watch: async (onFix) => subscribe(onFix, 'watch'),
    track: async (onFix) => {
      if (opts.canTrack === false) throw new Error('背景定位不能用');
      return subscribe(onFix, 'track');
    },
  };
  const session = new RunSession({
    location,
    now: () => nowMs,
    save: async (r) => {
      saved.push(r);
    },
    speak: (t) => spoken.push(t),
    newId: () => `run-${++ids}`,
  });
  /** 沿著往東的直線，從 x 公尺處送一個定位點（定位系統的時鐘可以和手機差一點） */
  const fixAt = (x: number, speed: number | null = 4, lagMs = 20) => {
    const fix = { timestamp: nowMs - lagMs + (opts.gpsClockAheadMs ?? 0), latitude: LAT0, longitude: LON0 + x / M_PER_DEG_LON, accuracy: 4, speed };
    for (const s of [...subs]) s.onFix(fix);
  };
  /** 以每秒 speed 公尺跑 seconds 秒，每秒一個定位點 */
  let x = 0;
  const runFor = (seconds: number, speed = 4) => {
    for (let i = 0; i < seconds; i++) {
      nowMs += 1000;
      x += speed;
      fixAt(x, speed);
    }
  };
  return { session, log, spoken, saved, fixAt, runFor, tick: (ms: number) => (nowMs += ms), hasListener: () => subs.size > 0, pos: () => x };
}

const flush = () => new Promise((r) => setTimeout(r, 0));

function rngNormal(seed: number) {
  let a = seed >>> 0;
  const u = () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  return () => Math.sqrt(-2 * Math.log(1 - u())) * Math.cos(2 * Math.PI * u());
}

describe('長跑流程', () => {
  it('沒有定位權限時停在「需要權限」，允許後開始定位', async () => {
    const r = rig({ permission: 'undetermined' });
    expect(r.session.getSnapshot().gps).toBe('unknown');
    await r.session.open();
    expect(r.session.getSnapshot().gps).toBe('denied');
    expect(r.hasListener()).toBe(false);
    await r.session.start();
    expect(r.session.getSnapshot().phase).toBe('setup');
    await r.session.requestPermission();
    expect(r.session.getSnapshot().gps).toBe('searching');
    r.fixAt(0, 0);
    expect(r.session.getSnapshot()).toMatchObject({ gps: 'good', accuracyM: 4 });
    expect(r.session.getSnapshot().position![0]).toBeCloseTo(LAT0, 6);
  });

  it('定位點太久沒來就回到「搜尋中」', async () => {
    const r = rig();
    await r.session.open();
    r.fixAt(0, 0);
    r.tick(11_000);
    r.session.refresh();
    expect(r.session.getSnapshot()).toMatchObject({ gps: 'searching', accuracyM: null });
  });

  it('自由跑：開始、跑、暫停、繼續、結束，自動存檔', async () => {
    const r = rig();
    await r.session.open();
    r.fixAt(0, 0);
    await r.session.start();
    // 開始後改用螢幕關掉也會繼續的定位
    expect(r.log).toEqual(['watch', 'track', 'unwatch']);
    expect(r.session.getSnapshot()).toMatchObject({ phase: 'running', background: true });
    r.runFor(300);
    expect(r.session.elapsed()).toBe(300);
    expect(Math.abs(r.session.getSnapshot().distanceM - 1200)).toBeLessThan(10);
    expect(Math.abs(r.session.getSnapshot().currentPace! - 250)).toBeLessThan(10);
    expect(r.session.getSnapshot().lastSplit!.km).toBe(1);
    expect(Math.abs(r.session.getSnapshot().lastSplit!.seconds - 250)).toBeLessThan(3);

    r.session.pause();
    r.tick(60_000);
    expect(r.session.elapsed()).toBe(300);
    expect(r.session.getSnapshot().phase).toBe('paused');
    r.session.resume();
    r.runFor(100);
    expect(r.session.elapsed()).toBe(400);

    await r.session.finish();
    const snap = r.session.getSnapshot();
    expect(snap.phase).toBe('finished');
    expect(snap.result).toMatchObject({ id: 'run-1', saved: true, targetM: null, completed: false, durationS: 400 });
    expect(Math.abs(snap.result!.distanceM - 1600)).toBeLessThan(12);
    expect(r.saved).toHaveLength(1);
    expect(r.saved[0].ranAt).toBe(new Date(1_800_000_000_000).toISOString());
    // 路線：暫停前後各一段，直線簡化後每段只剩頭尾，長度和距離相符
    expect(r.saved[0].track).toHaveLength(2);
    const length = r.saved[0].track.map((t) => trackLength(decodePolyline(t))).reduce((a, b) => a + b, 0);
    expect(Math.abs(length - snap.result!.distanceM)).toBeLessThan(5);
    // 結束後停止定位
    expect(r.hasListener()).toBe(false);
    expect(r.log.at(-1)).toBe('untrack');
  });

  it('目標距離：跑到自動結束並存檔，每公里和到達時語音報時', async () => {
    const r = rig();
    await r.session.open();
    r.fixAt(0, 0);
    r.session.setTarget(2000);
    await r.session.start();
    r.session.setTarget(5000);
    r.runFor(600);
    await flush();
    const snap = r.session.getSnapshot();
    expect(snap.phase).toBe('finished');
    expect(snap.result).toMatchObject({ targetM: 2000, completed: true, distanceM: 2000, saved: true });
    // 每秒 4 公尺跑 2000 公尺 = 500 秒
    expect(Math.abs(snap.result!.durationS - 500)).toBeLessThan(3);
    expect(snap.result!.splitsS).toHaveLength(2);
    expect(r.spoken).toHaveLength(2);
    expect(r.spoken[0]).toMatch(/^1 公里，4 分 \d+ 秒，這一公里 4 分 \d+ 秒$/);
    expect(r.spoken[1]).toMatch(/^到達 2 公里，時間 8 分 \d+ 秒$/);
    expect(r.saved).toHaveLength(1);
    expect(r.hasListener()).toBe(false);
  });

  it('關掉語音就不報時', async () => {
    const r = rig();
    await r.session.open();
    r.fixAt(0, 0);
    r.session.setVoice(false);
    r.session.setTarget(1000);
    await r.session.start();
    r.runFor(300);
    await flush();
    expect(r.session.getSnapshot().phase).toBe('finished');
    expect(r.spoken).toEqual([]);
  });

  it('定位系統的時鐘和手機差幾秒，成績不受影響', async () => {
    for (const ahead of [-3000, 3000]) {
      const r = rig({ gpsClockAheadMs: ahead });
      await r.session.open();
      r.fixAt(0, 0);
      r.session.setTarget(1000);
      await r.session.start();
      r.runFor(300);
      await flush();
      expect(Math.abs(r.session.getSnapshot().result!.durationS - 250), `ahead ${ahead}`).toBeLessThan(3);
    }
  });

  it('系統不允許背景定位：照樣能跑，並告訴畫面要保持 App 開著', async () => {
    const r = rig({ canTrack: false });
    await r.session.open();
    r.fixAt(0, 0);
    await r.session.start();
    expect(r.session.getSnapshot()).toMatchObject({ phase: 'running', background: false });
    r.runFor(50);
    expect(r.session.getSnapshot().distanceM).toBeGreaterThan(150);
  });

  it('按了開始馬上結束：太短不存檔', async () => {
    const r = rig();
    await r.session.open();
    r.fixAt(0, 0);
    await r.session.start();
    r.runFor(2);
    await r.session.finish();
    expect(r.session.getSnapshot().result).toMatchObject({ saved: false });
    expect(r.saved).toEqual([]);
  });

  it('GPS 還沒定位好就開始：定位到之後才開始算距離，時間從按下開始算', async () => {
    const r = rig();
    await r.session.open();
    await r.session.start();
    r.tick(20_000);
    r.runFor(100);
    expect(r.session.elapsed()).toBe(120);
    expect(Math.abs(r.session.getSnapshot().distanceM - 396)).toBeLessThan(10);
  });

  it('跑到一半離開畫面：停止定位，不存檔', async () => {
    const r = rig();
    await r.session.open();
    r.fixAt(0, 0);
    await r.session.start();
    r.runFor(30);
    r.session.dispose();
    expect(r.hasListener()).toBe(false);
    expect(r.saved).toEqual([]);
  });
});

describe('存檔內容', () => {
  it('全馬（一秒一點、4 萬多點）存起來在雲端限制內，路線長度幾乎不變', () => {
    const n = rngNormal(3);
    const pts: [number, number][] = [];
    let ex = 0;
    let ey = 0;
    for (let i = 0; i < 15000; i++) {
      // 彎來彎去的路線加上 GPS 雜訊
      ex = 0.97 * ex + 0.7 * n();
      ey = 0.97 * ey + 0.7 * n();
      const x = 2.8 * i + 30 * Math.sin(i / 40);
      const y = 400 * Math.sin(i / 300);
      pts.push([LAT0 + (y + ey) / M_PER_DEG_LAT, LON0 + (x + ex) / M_PER_DEG_LON]);
    }
    const t0 = Date.now();
    const run = toRunInput('m', 0, 42195, { distanceM: 42195, durationS: 15000, splitsS: [], track: [pts], completed: true });
    expect(Date.now() - t0).toBeLessThan(2000);
    expect(run.track[0].length).toBeLessThanOrEqual(250000);
    const back = decodePolyline(run.track[0]);
    expect(back.length).toBeLessThan(pts.length);
    expect(Math.abs(trackLength(back) - trackLength(pts)) / trackLength(pts)).toBeLessThan(0.05);
  });

  it('簡化不掉的怪路線也會縮到限制內；沒有點的段落不存', () => {
    // 每點都大幅跳動的之字形 6 萬點：放寬簡化也不夠，只能少存一些點
    const zigzag = Array.from({ length: 60000 }, (_, i): [number, number] => [LAT0 + (i % 2) * 0.01, LON0 + i * 0.0005]);
    const t0 = Date.now();
    const run = toRunInput('x', 0, null, { distanceM: 1234.56, durationS: 600.04, splitsS: [300.26], track: [zigzag, [], [[LAT0, LON0]]], completed: false });
    expect(Date.now() - t0).toBeLessThan(4000);
    expect(run.track).toHaveLength(1);
    expect(run.track[0].length).toBeLessThanOrEqual(250000);
    const back = decodePolyline(run.track[0]);
    expect(back[0]).toEqual([LAT0, LON0]);
    expect(back.at(-1)![1]).toBeCloseTo(zigzag.at(-1)![1], 5);
    expect(run).toMatchObject({ distanceM: 1234.6, durationS: 600, splitsS: [300.3], completed: false, targetM: null });
  });
});

describe('顯示格式', () => {
  it('時間、配速、距離', () => {
    expect(durationLabel(0)).toBe('0:00');
    expect(durationLabel(1531.4)).toBe('25:31');
    expect(durationLabel(1531.99)).toBe('25:31');
    expect(durationLabel(3912)).toBe('1:05:12');
    expect(paceLabel(306)).toBe('5′06″');
    expect(paceLabel(299.6)).toBe('5′00″');
    expect(paceLabel(null)).toBe('--');
    expect(paceLabel(4000)).toBe('--');
    expect(averagePace(5000, 1531)).toBeCloseTo(306.2, 1);
    expect(averagePace(3, 10)).toBeNull();
    expect(kmLabel(3428)).toBe('3.42');
    expect(kmLabel(5000)).toBe('5.00');
    expect(kmLabel(0)).toBe('0.00');
    expect(targetLabel(5000)).toBe('5K');
    expect(targetLabel(1500)).toBe('1.5K');
    expect(targetLabel(800)).toBe('800m');
    expect(targetLabel(null)).toBe('自由跑');
  });

  it('語音內容', () => {
    expect(spokenDuration(1531.4)).toBe('25 分 31 秒');
    expect(spokenDuration(3912)).toBe('1 小時 5 分 12 秒');
    expect(spokenDuration(45)).toBe('45 秒');
    expect(kmAnnouncement(3, 920, 298)).toBe('3 公里，15 分 20 秒，這一公里 4 分 58 秒');
    expect(finishAnnouncement(5000, 1531)).toBe('到達 5 公里，時間 25 分 31 秒');
    expect(finishAnnouncement(800, 170)).toBe('到達 800 公尺，時間 2 分 50 秒');
  });
});

import { describe, expect, it } from 'vitest';
import { decodePolyline, encodePolyline, haversine, RunTracker, simplifyTrack, trackLength, type GpsFix, type LatLon } from '../src/core/gpsTrack';

const LAT0 = 25.05;
const LON0 = 121.55;
const M_PER_DEG_LAT = 111194.93;
const M_PER_DEG_LON = M_PER_DEG_LAT * Math.cos((LAT0 * Math.PI) / 180);

/** 公尺座標（東、北）→ 經緯度 */
function toLatLon(x: number, y: number): LatLon {
  return [LAT0 + y / M_PER_DEG_LAT, LON0 + x / M_PER_DEG_LON];
}

/** 可重現的亂數（mulberry32）與常態分布 */
function rng(seed: number) {
  let a = seed >>> 0;
  const uniform = () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  return () => Math.sqrt(-2 * Math.log(1 - uniform())) * Math.cos(2 * Math.PI * uniform());
}

/** 400m 標準跑道第一道（兩段 84.39m 直道＋半徑 36.8m 的彎道），s = 沿跑道的距離 */
const STRAIGHT = 84.39;
const RADIUS = 36.8;
const LAP = 2 * STRAIGHT + 2 * Math.PI * RADIUS;
function trackPoint(s: number): [number, number] {
  let d = ((s % LAP) + LAP) % LAP;
  if (d < STRAIGHT) return [d, 0];
  d -= STRAIGHT;
  const arc = Math.PI * RADIUS;
  if (d < arc) {
    const a = d / RADIUS;
    return [STRAIGHT + RADIUS * Math.sin(a), RADIUS - RADIUS * Math.cos(a)];
  }
  d -= arc;
  if (d < STRAIGHT) return [STRAIGHT - d, 2 * RADIUS];
  d -= STRAIGHT;
  const a = d / RADIUS;
  return [-RADIUS * Math.sin(a), RADIUS + RADIUS * Math.cos(a)];
}

/**
 * 模擬 GPS：真實位置加上「慢慢飄的誤差」（真實 GPS 的誤差主要是這種）和一點每點獨立的雜訊。
 * path(t) 回傳時間 t 的真實位置（公尺）與速度。
 */
function simulate(
  path: (t: number) => { x: number; y: number; speed: number },
  seconds: number,
  opts: { seed?: number; drift?: number; white?: number; acc?: number; withSpeed?: boolean; t0?: number } = {},
): GpsFix[] {
  const { seed = 1, drift = 3, white = 1, acc = 5, withSpeed = true, t0 = 1000 } = opts;
  const n = rng(seed);
  const rho = Math.exp(-1 / 30);
  const innov = drift * Math.sqrt(1 - rho * rho);
  let ex = n() * drift;
  let ey = n() * drift;
  const out: GpsFix[] = [];
  for (let i = 0; i <= seconds; i++) {
    ex = rho * ex + innov * n();
    ey = rho * ey + innov * n();
    const p = path(i);
    const [lat, lon] = toLatLon(p.x + ex + white * n(), p.y + ey + white * n());
    out.push({ t: t0 + i, lat, lon, acc, speed: withSpeed ? Math.max(0, p.speed + 0.1 * n()) : null });
  }
  return out;
}

const onTrack = (speed: number) => (t: number) => {
  const [x, y] = trackPoint(speed * t);
  return { x, y, speed };
};

function run(fixes: GpsFix[], tracker = new RunTracker()): RunTracker {
  tracker.addFix(fixes[0]);
  tracker.start(fixes[0].t);
  for (const f of fixes.slice(1)) tracker.addFix(f);
  return tracker;
}

describe('GPS 距離', () => {
  it('兩點距離：緯度 1 度約 111.19 公里', () => {
    expect(haversine(25, 121, 26, 121)).toBeCloseTo(111194.9, 0);
    expect(haversine(25, 121, 25, 121)).toBe(0);
  });

  it('400m 跑道跑 5 公里（一般誤差）：距離誤差在 1.5% 內', () => {
    for (const seed of [1, 2, 3, 4, 5]) {
      const speed = 4;
      const seconds = 5000 / speed;
      const t = run(simulate(onTrack(speed), seconds, { seed }));
      t.finish(1000 + seconds);
      const err = (t.distanceM - 5000) / 5000;
      expect(Math.abs(err), `seed ${seed}: ${t.distanceM.toFixed(1)}m`).toBeLessThan(0.015);
      expect(t.splitsS.length).toBeGreaterThanOrEqual(4);
      // 每公里約 250 秒
      for (const s of t.splitsS) expect(Math.abs(s - 250)).toBeLessThan(8);
    }
  });

  it('訊號較差（誤差大一倍）仍在 3% 內', () => {
    for (const seed of [11, 12, 13]) {
      const t = run(simulate(onTrack(3.3), 900, { seed, drift: 6, white: 2, acc: 10 }));
      t.finish(1900);
      const truth = 3.3 * 900;
      expect(Math.abs(t.distanceM - truth) / truth, `seed ${seed}: ${t.distanceM.toFixed(1)} vs ${truth}`).toBeLessThan(0.03);
    }
  });

  it('站著不動 5 分鐘：有回報速度時幾乎不累積距離', () => {
    const still = () => ({ x: 0, y: 0, speed: 0 });
    const t = run(simulate(still, 300, { seed: 7 }));
    expect(t.distanceM).toBeLessThan(5);
  });

  it('站著不動 5 分鐘：手機沒回報速度時，累積的假距離也有限', () => {
    const still = () => ({ x: 0, y: 0, speed: 0 });
    const t = run(simulate(still, 300, { seed: 7, withSpeed: false }));
    expect(t.distanceM).toBeLessThan(60);
  });

  it('單一個跳很遠的點、誤差很大的點都不採用', () => {
    const fixes = simulate(onTrack(4), 300, { seed: 3 });
    const clean = run(fixes);
    const dirty = fixes.map((f) => ({ ...f }));
    const [jLat, jLon] = toLatLon(500, 500);
    dirty[100] = { ...dirty[100], lat: jLat, lon: jLon };
    const [bLat, bLon] = toLatLon(-300, 200);
    dirty[200] = { ...dirty[200], lat: bLat, lon: bLon, acc: 80 };
    const t = run(dirty);
    expect(Math.abs(t.distanceM - clean.distanceM)).toBeLessThan(15);
  });

  it('訊號中斷一段時間再回來：補上直線距離，不會卡住', () => {
    const straight = (t: number) => ({ x: 4 * t, y: 0, speed: 4 });
    const fixes = simulate(straight, 300, { seed: 5 }).filter((f) => f.t < 1100 || f.t > 1160);
    const t = run(fixes);
    expect(Math.abs(t.distanceM - 1200)).toBeLessThan(25);
  });

  it('時間倒退或重複的點會被忽略', () => {
    const fixes = simulate(onTrack(4), 120, { seed: 9 });
    const doubled = fixes.flatMap((f, i) => (i > 0 ? [f, fixes[i - 1], f] : [f]));
    expect(run(doubled).distanceM).toBeCloseTo(run(fixes).distanceM, 6);
  });
});

describe('目標距離與分段', () => {
  it('跑到目標自動結束，時間內插到剛好到達的那一刻', () => {
    for (const seed of [21, 22, 23]) {
      const fixes = simulate(onTrack(4), 400, { seed });
      const t = run(fixes, new RunTracker({ targetM: 1000 }));
      expect(t.state).toBe('finished');
      expect(t.distanceM).toBe(1000);
      const s = t.summary(99999);
      expect(s.completed).toBe(true);
      // 真實 250 秒；GPS 距離誤差 1.5% 約 ±4 秒
      expect(Math.abs(s.durationS - 250), `seed ${seed}: ${s.durationS}`).toBeLessThan(5);
      expect(s.splitsS).toHaveLength(1);
      expect(s.splitsS[0]).toBeCloseTo(s.durationS, 6);
      // 結束之後的點不再影響結果
      t.addFix({ ...fixes[fixes.length - 1], t: 5000 });
      expect(t.summary(99999).durationS).toBe(s.durationS);
    }
  });

  it('沒跑到目標就手動結束：不算完成', () => {
    const t = run(simulate(onTrack(4), 100, { seed: 4 }), new RunTracker({ targetM: 1000 }));
    t.finish(1100);
    const s = t.summary(1100);
    expect(s.completed).toBe(false);
    expect(s.durationS).toBe(100);
    // 只跑 400m 時，起點和終點各幾公尺的定位誤差就佔了幾個百分點
    expect(Math.abs(s.distanceM - 400)).toBeLessThan(20);
  });

  it('分段時間加起來等於跨過最後一個整公里的時間', () => {
    const straight = (t: number) => ({ x: (t < 300 ? 3 : 5) * t - (t < 300 ? 0 : 600), y: 0, speed: t < 300 ? 3 : 5 });
    const t = run(simulate(straight, 700, { seed: 6, drift: 0.5, white: 0.2 }));
    t.finish(1700);
    // 前 300 秒每秒 3m（900m），之後每秒 5m：第 1 公里在 320 秒，第 2 公里在 520 秒
    expect(t.splitsS.length).toBe(2);
    expect(Math.abs(t.splitsS[0] - 320)).toBeLessThan(4);
    expect(Math.abs(t.splitsS[1] - 200)).toBeLessThan(4);
  });
});

describe('暫停', () => {
  it('暫停期間不計時間也不計距離，路線分成兩段', () => {
    const path = (t: number) => {
      // 0–100 秒往東跑 400m；100–200 秒暫停並走到北邊 150m；200–300 秒再往東跑 400m
      if (t <= 100) return { x: 4 * t, y: 0, speed: 4 };
      if (t <= 200) return { x: 400, y: 1.5 * (t - 100), speed: 1.5 };
      return { x: 400 + 4 * (t - 200), y: 150, speed: 4 };
    };
    const fixes = simulate(path, 300, { seed: 8 });
    const t = new RunTracker();
    t.addFix(fixes[0]);
    t.start(1000);
    for (const f of fixes.slice(1)) {
      if (f.t === 1101) t.pause(1100);
      if (f.t === 1201) t.resume(1200);
      t.addFix(f);
    }
    expect(t.elapsed(1300)).toBe(200);
    t.finish(1300);
    const s = t.summary(1300);
    expect(s.durationS).toBe(200);
    expect(Math.abs(s.distanceM - 800)).toBeLessThan(20);
    expect(s.track).toHaveLength(2);
    // 兩段之間隔了大約 150m，沒有被連起來
    const endA = s.track[0][s.track[0].length - 1];
    const startB = s.track[1][0];
    expect(haversine(endA[0], endA[1], startB[0], startB[1])).toBeGreaterThan(120);
  });

  it('暫停中的時間停在按下暫停那一刻', () => {
    const t = new RunTracker();
    t.start(10);
    t.pause(25);
    expect(t.elapsed(999)).toBe(15);
    t.resume(100);
    expect(t.elapsed(105)).toBe(20);
  });
});

describe('目前配速', () => {
  it('穩定跑時接近實際配速，停下來變成 null', () => {
    const path = (t: number) => (t <= 120 ? { x: 4 * t, y: 0, speed: 4 } : { x: 480, y: 0, speed: 0 });
    const fixes = simulate(path, 180, { seed: 2 });
    const t = new RunTracker();
    t.addFix(fixes[0]);
    t.start(1000);
    for (const f of fixes.slice(1, 110)) t.addFix(f);
    const pace = t.currentPace(fixes[109].t)!;
    // 每秒 4m = 每公里 250 秒
    expect(Math.abs(pace - 250)).toBeLessThan(40);
    for (const f of fixes.slice(110)) t.addFix(f);
    expect(t.distanceM).toBeLessThan(500);
    expect(t.currentPace(fixes[fixes.length - 1].t)).toBeNull();
  });
});

describe('路線簡化與壓縮', () => {
  it('encode / decode 來回一致（精度 1e-5 度）', () => {
    const pts: LatLon[] = [
      [38.5, -120.2],
      [40.7, -120.95],
      [43.252, -126.453],
    ];
    // Google 文件上的範例
    expect(encodePolyline(pts)).toBe('_p~iF~ps|U_ulLnnqC_mqNvxq`@');
    expect(decodePolyline('_p~iF~ps|U_ulLnnqC_mqNvxq`@')).toEqual(pts);
    const taipei: LatLon[] = [
      [25.04776, 121.53185],
      [25.04781, 121.53191],
      [-33.86882, 151.20929],
      [0, 0],
    ];
    expect(decodePolyline(encodePolyline(taipei))).toEqual(taipei);
    expect(encodePolyline([])).toBe('');
    expect(decodePolyline('')).toEqual([]);
  });

  it('壞掉的字串不會丟錯，只回傳壞掉之前的點', () => {
    expect(decodePolyline('_p~iF~ps|U_ulL')).toEqual([[38.5, -120.2]]);
    expect(decodePolyline('\u0001\u0002')).toEqual([]);
  });

  it('簡化後點數大幅減少，路線長度幾乎不變', () => {
    const fixes = simulate(onTrack(4), 1250, { seed: 1 });
    const t = run(fixes);
    t.finish(2250);
    const full = t.track()[0];
    const simple = simplifyTrack(full, 3);
    expect(simple.length).toBeLessThan(full.length / 3);
    expect(simple[0]).toEqual(full[0]);
    expect(simple[simple.length - 1]).toEqual(full[full.length - 1]);
    expect(Math.abs(trackLength(simple) - trackLength(full)) / trackLength(full)).toBeLessThan(0.03);
    // 直線上的點只留頭尾
    const line: LatLon[] = Array.from({ length: 50 }, (_, i) => toLatLon(i * 5, 0));
    expect(simplifyTrack(line, 1)).toHaveLength(2);
  });
});

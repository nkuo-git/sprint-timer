import { describe, expect, it } from 'vitest';
import type { LatLon } from '../src/core/gpsTrack';
import { fitViewport, kmMarks, project, tilesFor, tileUrl, toScreen, trackPath, TILE } from '../src/run/mapView';

const M_LAT = 111194.93;
const lonM = (lat: number) => M_LAT * Math.cos((lat * Math.PI) / 180);

describe('路線地圖', () => {
  it('投影：經緯度 0,0 在世界正中間；縮放加一級座標變兩倍', () => {
    expect(project(0, 0, 0)).toEqual([128, 128]);
    const [x, y] = project(25.05, 121.55, 10);
    const [x2, y2] = project(25.05, 121.55, 11);
    expect(x2).toBeCloseTo(2 * x, 6);
    expect(y2).toBeCloseTo(2 * y, 6);
    // 台北 101 附近在第 16 級的圖塊
    expect([Math.floor(project(25.0339, 121.5645, 16)[0] / TILE), Math.floor(project(25.0339, 121.5645, 16)[1] / TILE)]).toEqual([54898, 28058]);
  });

  it('路線完整放進畫面並置中，縮放等級盡量大', () => {
    // 東西 2 公里、南北 1 公里的路線
    const pts: LatLon[] = [
      [25.05, 121.55],
      [25.05 + 1000 / M_LAT, 121.55 + 2000 / lonM(25.05)],
    ];
    const v = fitViewport(pts, 350, 250, 24)!;
    for (const [lat, lon] of pts) {
      const [x, y] = toScreen(v, lat, lon);
      expect(x).toBeGreaterThanOrEqual(23.9);
      expect(x).toBeLessThanOrEqual(350 - 23.9);
      expect(y).toBeGreaterThanOrEqual(23.9);
      expect(y).toBeLessThanOrEqual(250 - 23.9);
    }
    const bigger = { ...fitViewport(pts, 350, 250, 24)!, zoom: v.zoom + 1 };
    const [ax] = project(pts[0][0], pts[0][1], bigger.zoom);
    const [bx] = project(pts[1][0], pts[1][1], bigger.zoom);
    expect(bx - ax).toBeGreaterThan(350 - 48);
  });

  it('只有一個點時用固定的縮放等級，點在畫面中間', () => {
    const v = fitViewport([[25.05, 121.55]], 350, 220)!;
    expect(v.zoom).toBe(16);
    const [x, y] = toScreen(v, 25.05, 121.55);
    expect(x).toBeCloseTo(175, 6);
    expect(y).toBeCloseTo(110, 6);
    expect(fitViewport([], 350, 220)).toBeNull();
  });

  it('圖塊剛好蓋滿畫面', () => {
    const v = fitViewport([[25.05, 121.55]], 350, 220)!;
    const tiles = tilesFor(v);
    const covered = (x: number, y: number) => tiles.some((t) => x >= t.left && x < t.left + TILE && y >= t.top && y < t.top + TILE);
    for (const [x, y] of [[0, 0], [349.9, 0], [0, 219.9], [349.9, 219.9], [175, 110]]) expect(covered(x, y)).toBe(true);
    expect(tiles.length).toBeLessThanOrEqual(6);
    expect(tileUrl(tiles[0])).toMatch(/^https:\/\/[abcd]\.basemaps\.cartocdn\.com\/dark_all\/16\/\d+\/\d+@2x\.png$/);
  });

  it('暫停前後的路線分開畫', () => {
    const v = fitViewport([[25.05, 121.55], [25.06, 121.56]], 300, 300)!;
    const d = trackPath(v, [[[25.05, 121.55], [25.055, 121.555]], [[25.058, 121.558], [25.06, 121.56]]]);
    expect(d.match(/M/g)).toHaveLength(2);
    expect(d.match(/L/g)).toHaveLength(2);
  });

  it('每公里的標記位置', () => {
    // 往東直線 3.5 公里
    const lat = 25.05;
    const seg: LatLon[] = Array.from({ length: 36 }, (_, i) => [lat, 121.55 + (i * 100) / lonM(lat)]);
    const marks = kmMarks([seg], 3500);
    expect(marks).toHaveLength(3);
    marks.forEach(([, lon], i) => expect((lon - 121.55) * lonM(lat)).toBeCloseTo((i + 1) * 1000, 0));
    expect(kmMarks([seg], 900)).toEqual([]);
  });
});

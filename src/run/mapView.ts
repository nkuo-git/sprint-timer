import type { LatLon } from '../core/gpsTrack';
import { haversine } from '../core/gpsTrack';

/**
 * 把路線畫到一塊固定大小的地圖上（純計算）：Web Mercator 投影、選縮放等級、算要哪些地圖圖塊、路線的 SVG path。
 * 地圖底圖是一般的 256px 圖塊（CARTO 深色底圖，資料來自 OpenStreetMap），沒網路時只畫路線。
 */

export const TILE = 256;
const MAX_ZOOM = 17;
const MIN_ZOOM = 2;
/** 只有一個點（還沒開始跑）時用的縮放等級 */
const POINT_ZOOM = 16;

/** 經緯度 → 世界座標（縮放等級 z 時的像素） */
export function project(lat: number, lon: number, z: number): [number, number] {
  const scale = TILE * 2 ** z;
  const s = Math.sin((Math.max(-85.05, Math.min(85.05, lat)) * Math.PI) / 180);
  const x = ((lon + 180) / 360) * scale;
  const y = (0.5 - Math.log((1 + s) / (1 - s)) / (4 * Math.PI)) * scale;
  return [x, y];
}

export interface Viewport {
  zoom: number;
  /** 畫面左上角的世界座標 */
  left: number;
  top: number;
  width: number;
  height: number;
}

/** 讓所有點都放得進畫面（四周留 pad 像素）的最大縮放等級，並置中 */
export function fitViewport(points: LatLon[], width: number, height: number, pad = 24): Viewport | null {
  if (!points.length || width <= 0 || height <= 0) return null;
  let minLat = Infinity;
  let maxLat = -Infinity;
  let minLon = Infinity;
  let maxLon = -Infinity;
  for (const [lat, lon] of points) {
    minLat = Math.min(minLat, lat);
    maxLat = Math.max(maxLat, lat);
    minLon = Math.min(minLon, lon);
    maxLon = Math.max(maxLon, lon);
  }
  const single = haversine(minLat, minLon, maxLat, maxLon) < 1;
  const innerW = Math.max(1, width - 2 * pad);
  const innerH = Math.max(1, height - 2 * pad);
  let zoom = single ? POINT_ZOOM : MIN_ZOOM;
  if (!single) {
    for (let z = MAX_ZOOM; z >= MIN_ZOOM; z--) {
      const [x0, y1] = project(minLat, minLon, z);
      const [x1, y0] = project(maxLat, maxLon, z);
      if (x1 - x0 <= innerW && y1 - y0 <= innerH) {
        zoom = z;
        break;
      }
    }
  }
  const [x0, y1] = project(minLat, minLon, zoom);
  const [x1, y0] = project(maxLat, maxLon, zoom);
  return { zoom, left: (x0 + x1) / 2 - width / 2, top: (y0 + y1) / 2 - height / 2, width, height };
}

/** 經緯度 → 畫面上的位置 */
export function toScreen(v: Viewport, lat: number, lon: number): [number, number] {
  const [x, y] = project(lat, lon, v.zoom);
  return [x - v.left, y - v.top];
}

export interface TileRef {
  x: number;
  y: number;
  z: number;
  /** 圖塊左上角在畫面上的位置 */
  left: number;
  top: number;
}

/** 蓋滿畫面需要的圖塊 */
export function tilesFor(v: Viewport): TileRef[] {
  const n = 2 ** v.zoom;
  const out: TileRef[] = [];
  const x0 = Math.floor(v.left / TILE);
  const x1 = Math.floor((v.left + v.width - 1e-9) / TILE);
  const y0 = Math.max(0, Math.floor(v.top / TILE));
  const y1 = Math.min(n - 1, Math.floor((v.top + v.height - 1e-9) / TILE));
  for (let ty = y0; ty <= y1; ty++) {
    for (let tx = x0; tx <= x1; tx++) {
      out.push({ x: ((tx % n) + n) % n, y: ty, z: v.zoom, left: tx * TILE - v.left, top: ty * TILE - v.top });
    }
  }
  return out;
}

/** CARTO 深色底圖（免費、不用金鑰；要標示 © OpenStreetMap © CARTO） */
export function tileUrl(t: TileRef): string {
  const sub = 'abcd'[(t.x + t.y) % 4];
  return `https://${sub}.basemaps.cartocdn.com/dark_all/${t.z}/${t.x}/${t.y}@2x.png`;
}

export const MAP_ATTRIBUTION = '© OpenStreetMap © CARTO';

/** 路線的 SVG path（每一段各自 M 開頭，暫停前後不連起來） */
export function trackPath(v: Viewport, track: LatLon[][]): string {
  const parts: string[] = [];
  for (const seg of track) {
    let last = '';
    seg.forEach(([lat, lon], i) => {
      const [x, y] = toScreen(v, lat, lon);
      const p = `${x.toFixed(1)} ${y.toFixed(1)}`;
      if (p === last) return;
      parts.push(`${i === 0 ? 'M' : 'L'}${p}`);
      last = p;
    });
  }
  return parts.join(' ');
}

/** 每一整公里在路線上的位置（照路線長度比例換算成 GPS 距離） */
export function kmMarks(track: LatLon[][], distanceM: number): LatLon[] {
  const pts = track.flat();
  if (pts.length < 2 || distanceM < 1000) return [];
  let total = 0;
  for (const seg of track) for (let i = 1; i < seg.length; i++) total += haversine(seg[i - 1][0], seg[i - 1][1], seg[i][0], seg[i][1]);
  if (total <= 0) return [];
  const scale = distanceM / total;
  const out: LatLon[] = [];
  let walked = 0;
  let nextKm = 1000;
  for (const seg of track) {
    for (let i = 1; i < seg.length; i++) {
      const [aLat, aLon] = seg[i - 1];
      const [bLat, bLon] = seg[i];
      const d = haversine(aLat, aLon, bLat, bLon) * scale;
      while (d > 0 && walked + d >= nextKm && nextKm <= distanceM + 1e-6) {
        const f = (nextKm - walked) / d;
        out.push([aLat + f * (bLat - aLat), aLon + f * (bLon - aLon)]);
        nextKm += 1000;
      }
      walked += d;
    }
  }
  return out;
}

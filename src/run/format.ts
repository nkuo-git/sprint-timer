/** 長跑畫面與語音用的文字格式（純函式） */

/** 跑步時間：25:31、1:05:12（無條件捨去到秒，和碼表一樣） */
export function durationLabel(seconds: number): string {
  const total = Math.max(0, Math.floor(seconds + 1e-6));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const ss = String(s).padStart(2, '0');
  return h > 0 ? `${h}:${String(m).padStart(2, '0')}:${ss}` : `${m}:${ss}`;
}

/** 配速（秒／公里）：5′06″；沒有資料或慢到沒有意義（超過每公里 60 分鐘）時顯示 -- */
export function paceLabel(secPerKm: number | null | undefined): string {
  if (secPerKm === null || secPerKm === undefined || !Number.isFinite(secPerKm) || secPerKm <= 0 || secPerKm >= 3600) return '--';
  const total = Math.round(secPerKm);
  return `${Math.floor(total / 60)}′${String(total % 60).padStart(2, '0')}″`;
}

/** 平均配速（秒／公里）；距離太短時是 null */
export function averagePace(distanceM: number, durationS: number): number | null {
  if (distanceM < 10 || durationS <= 0) return null;
  return (durationS / distanceM) * 1000;
}

/** 距離（公里，兩位小數，無條件捨去：還沒跑到的不顯示成跑到了）：3.42 */
export function kmLabel(meters: number): string {
  return (Math.floor(Math.max(0, meters) / 10 + 1e-6) / 100).toFixed(2);
}

/** 目標距離的名稱：5000 → 5K、1500 → 1.5K、800 → 800m；自由跑是 null */
export function targetLabel(targetM: number | null): string {
  if (targetM === null) return '自由跑';
  if (targetM >= 1000) return `${Number((targetM / 1000).toFixed(2))}K`;
  return `${Math.round(targetM)}m`;
}

/** 念出來的時間：25 分 31 秒、1 小時 5 分 12 秒 */
export function spokenDuration(seconds: number): string {
  const total = Math.max(0, Math.round(seconds));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const parts: string[] = [];
  if (h > 0) parts.push(`${h} 小時`);
  if (m > 0 || h > 0) parts.push(`${m} 分`);
  parts.push(`${s} 秒`);
  return parts.join(' ');
}

/** 每公里報時：「3 公里，15 分 20 秒，這一公里 4 分 58 秒」 */
export function kmAnnouncement(km: number, totalS: number, splitS: number): string {
  return `${km} 公里，${spokenDuration(totalS)}，這一公里 ${spokenDuration(splitS)}`;
}

/** 到達目標：「到達 5 公里，時間 25 分 31 秒」 */
export function finishAnnouncement(targetM: number, totalS: number): string {
  const dist = targetM >= 1000 ? `${Number((targetM / 1000).toFixed(2))} 公里` : `${Math.round(targetM)} 公尺`;
  return `到達 ${dist}，時間 ${spokenDuration(totalS)}`;
}

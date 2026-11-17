/** 音速（m/s），T = 氣溫（°C）。20°C ≈ 343.2 m/s */
export function speedOfSound(tempC = 20): number {
  return 331.3 * Math.sqrt(1 + tempC / 273.15);
}

/** 聲音從喇叭傳到跑者的時間（秒） */
export function soundDelay(distanceM: number, tempC = 20): number {
  if (distanceM < 0) throw new Error('距離不可為負');
  return distanceM / speedOfSound(tempC);
}

/** 電子計時正式成績：千分位無條件進位到百分位（World Athletics 規則） */
export function officialTime(seconds: number): number {
  // 先四捨五入到微秒，避免浮點誤差把 10.230000000001 進位成 10.24
  const us = Math.round(seconds * 1e6);
  return Math.ceil(us / 1e4) / 100;
}

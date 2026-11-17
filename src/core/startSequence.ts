/**
 * 起跑口令排程：「各就位 → 預備 → 鳴槍」。
 * 預備到鳴槍的間隔隨機化，避免跑者抓節奏（真實比賽發令員也不會固定）。
 */

export interface StartSequenceConfig {
  /** 按下開始到「各就位」（秒），給使用者走回起跑線的時間 */
  leadIn: number;
  /** 「各就位」到「預備」（秒） */
  marksToSet: number;
  /** 「預備」到鳴槍的隨機區間（秒） */
  setToGunMin: number;
  setToGunMax: number;
}

export const defaultStartSequence: StartSequenceConfig = {
  leadIn: 5,
  marksToSet: 10,
  setToGunMin: 1.6,
  setToGunMax: 2.6,
};

export interface StartSchedule {
  /** 各事件相對於「按下開始」的時間（秒） */
  marks: number;
  set: number;
  gun: number;
}

export function planStart(cfg: StartSequenceConfig = defaultStartSequence, rand: () => number = Math.random): StartSchedule {
  if (cfg.setToGunMax < cfg.setToGunMin) throw new Error('setToGunMax 必須 ≥ setToGunMin');
  const marks = cfg.leadIn;
  const set = marks + cfg.marksToSet;
  const gun = set + cfg.setToGunMin + rand() * (cfg.setToGunMax - cfg.setToGunMin);
  return { marks, set, gun };
}

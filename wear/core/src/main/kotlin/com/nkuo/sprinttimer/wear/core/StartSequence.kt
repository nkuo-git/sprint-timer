package com.nkuo.sprinttimer.wear.core

/**
 * 起跑口令排程：「各就位 → 預備 → 鳴槍」。和手機 App 的 src/core/startSequence.ts 相同。
 * 預備到鳴槍的間隔隨機化，避免跑者抓節奏。
 */
data class StartSequenceConfig(
  /** 按下開始到「各就位」（秒），給發令的人站定、跑者就位的時間 */
  val leadIn: Double = 5.0,
  /** 「各就位」到「預備」（秒） */
  val marksToSet: Double = 10.0,
  /** 「預備」到鳴槍的隨機區間（秒） */
  val setToGunMin: Double = 1.6,
  val setToGunMax: Double = 2.6,
)

/** 各事件相對於「按下開始」的時間（秒） */
data class StartSchedule(val marks: Double, val set: Double, val gun: Double)

fun planStart(cfg: StartSequenceConfig = StartSequenceConfig(), rand: () -> Double = Math::random): StartSchedule {
  require(cfg.setToGunMax >= cfg.setToGunMin) { "setToGunMax 必須 ≥ setToGunMin" }
  val marks = cfg.leadIn
  val set = marks + cfg.marksToSet
  val gun = set + cfg.setToGunMin + rand() * (cfg.setToGunMax - cfg.setToGunMin)
  return StartSchedule(marks, set, gun)
}

package com.nkuo.sprinttimer.wear.core

import java.util.Locale
import kotlin.math.ceil
import kotlin.math.roundToLong

/** 電子計時正式成績：千分位無條件進位到百分位（World Athletics 規則）。和手機 App 的 officialTime 相同。 */
fun officialTime(seconds: Double): Double {
  // 先四捨五入到微秒，避免浮點誤差把 10.230000000001 進位成 10.24
  val us = (seconds * 1e6).roundToLong()
  return ceil(us / 1e4) / 100
}

/** 正式成績字串，例如 11.42 */
fun formatOfficial(seconds: Double): String = String.format(Locale.US, "%.2f", officialTime(seconds))

/** 原始成績字串（到毫秒），例如 11.417 */
fun formatRaw(seconds: Double): String = String.format(Locale.US, "%.3f", seconds)

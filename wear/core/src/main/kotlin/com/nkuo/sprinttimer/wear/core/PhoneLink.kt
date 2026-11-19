package com.nkuo.sprinttimer.wear.core

import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.contentOrNull
import kotlinx.serialization.json.intOrNull
import kotlinx.serialization.json.put

/**
 * 手機 App ↔ 手錶 App 的「配對連線」（Wear OS Data Layer，走藍牙，不需要同一個 Wi-Fi）。
 * 用途：手機的帳號頁顯示手錶裝的版本、把新版安裝檔傳到手錶安裝。
 * 手機端在 modules/watch-link 和 src/update/watch.ts，兩邊的路徑與格式必須相同。
 *
 * 和起跑／終點之間計時用的區網 UDP（Protocol.kt）是兩回事：這條連線不碰計時。
 */
object PhoneLink {
  /** 手錶 App 對外宣告的能力名稱（res/values/wear.xml）。手機用它找到「有裝手錶 App 的那支錶」。 */
  const val CAPABILITY = "sprint_timer_watch"

  /** 手機 → 手錶（訊息）：問目前裝的版本 */
  const val PATH_INFO = "/sprint-timer/info"

  /** 手錶 → 手機（訊息）：[WatchInfo] 的 JSON */
  const val PATH_INFO_REPLY = "/sprint-timer/info-reply"

  /** 手機 → 手錶（檔案通道）：後面接 /<build>/<檔案大小>/<顯示版本>，見 [updatePath] */
  const val PATH_UPDATE = "/sprint-timer/update"

  /** 手錶 → 手機（訊息）：[UpdateStatus] 的 JSON */
  const val PATH_STATUS = "/sprint-timer/update-status"
}

/** 手錶上裝的版本 */
data class WatchInfo(val build: Int, val version: String)

fun encodeInfo(i: WatchInfo): String = buildJsonObject {
  put("build", i.build); put("version", i.version)
}.toString()

fun decodeInfo(s: String): WatchInfo? {
  val o = parseObject(s) ?: return null
  val build = (o["build"] as? JsonPrimitive)?.takeIf { !it.isString }?.intOrNull ?: return null
  return WatchInfo(build, o.str("version") ?: "")
}

/** 手機要傳過來的安裝檔 */
data class IncomingUpdate(val build: Int, val sizeBytes: Long, val version: String)

fun updatePath(u: IncomingUpdate): String = "${PhoneLink.PATH_UPDATE}/${u.build}/${u.sizeBytes}/${u.version}"

/** 不是更新通道、或格式不對回傳 null */
fun parseUpdatePath(path: String?): IncomingUpdate? {
  val m = Regex("^${Regex.escape(PhoneLink.PATH_UPDATE)}/(\\d{1,9})/(\\d{1,12})/([0-9A-Za-z.\\-]{1,20})$").matchEntire(path ?: "") ?: return null
  val build = m.groupValues[1].toIntOrNull()?.takeIf { it > 0 } ?: return null
  val size = m.groupValues[2].toLongOrNull()?.takeIf { it > 0 } ?: return null
  return IncomingUpdate(build, size, m.groupValues[3])
}

/** 手錶回報給手機的更新進度 */
enum class UpdateState(val wire: String) {
  /** 檔案收完、檢查過，已交給系統安裝。裝成功的話手錶 App 會被系統關掉，手機再問一次版本就知道。 */
  INSTALLING("installing"),

  /** 系統要人在手錶上按確認 */
  NEEDS_CONFIRM("needs-confirm"),

  FAILED("failed"),
}

/** 失敗原因（給手機顯示對應的說明） */
object FailReason {
  /** 傳到一半斷線，檔案不完整 */
  const val INCOMPLETE = "incomplete"

  /** 傳來的不比手錶上的新 */
  const val NOT_NEWER = "not-newer"

  /** 檔案不是這個 App 的安裝檔 */
  const val BAD_FILE = "bad-file"

  /** 系統不讓安裝 */
  const val INSTALL_BLOCKED = "install-blocked"
}

data class UpdateStatus(val build: Int, val state: UpdateState, val reason: String? = null)

fun encodeStatus(s: UpdateStatus): String = buildJsonObject {
  put("build", s.build); put("state", s.state.wire)
  s.reason?.let { put("reason", it) }
}.toString()

fun decodeStatus(s: String): UpdateStatus? {
  val o = parseObject(s) ?: return null
  val build = (o["build"] as? JsonPrimitive)?.takeIf { !it.isString }?.intOrNull ?: return null
  val state = UpdateState.entries.firstOrNull { it.wire == o.str("state") } ?: return null
  return UpdateStatus(build, state, o.str("reason"))
}

/**
 * 檔案收完後、安裝前的檢查。可以裝回傳 null，否則回傳 [FailReason]。
 * [receivedBytes] 是實際收到的檔案大小；[apkBuild] 是從檔案本身讀出來的 versionCode（讀不出來、或不是這個 App 的檔案傳 null）。
 */
fun checkIncoming(update: IncomingUpdate, receivedBytes: Long, apkBuild: Int?, currentBuild: Int): String? =
  when {
    receivedBytes != update.sizeBytes -> FailReason.INCOMPLETE
    apkBuild == null || apkBuild != update.build -> FailReason.BAD_FILE
    apkBuild <= currentBuild -> FailReason.NOT_NEWER
    else -> null
  }

private fun parseObject(s: String): JsonObject? =
  try {
    Json.parseToJsonElement(s) as? JsonObject
  } catch (e: Exception) {
    null
  }

private fun JsonObject.str(k: String): String? = (this[k] as? JsonPrimitive)?.takeIf { it.isString }?.contentOrNull

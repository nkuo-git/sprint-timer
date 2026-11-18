package com.nkuo.sprinttimer.wear.core

import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.contentOrNull
import kotlinx.serialization.json.longOrNull
import java.util.Locale

/**
 * App 內更新用的版本資訊。規則和手機 App 的 src/update/version.ts 相同：
 * Release 標籤 build-N（N = versionCode，只會變大，用來比較新舊）、標題 vX.Y（給人看的版本）。
 * 手錶的安裝檔是同一個 Release 裡的 sprint-timer-wear.apk。
 */
data class ReleaseInfo(
  val build: Int,
  /** 顯示版本，例如 "0.7"；Release 標題不是 vX.Y 時用標籤 */
  val version: String,
  val tag: String,
  val apkUrl: String,
  val sizeBytes: Long,
)

const val WEAR_APK_NAME = "sprint-timer-wear.apk"

fun parseBuildTag(tag: String?): Int? = Regex("^build-(\\d+)$").matchEntire(tag ?: "")?.groupValues?.get(1)?.toIntOrNull()

/** 從 GitHub releases/latest API 的回應取出更新資訊；格式不符、或這個 Release 沒有手錶安裝檔就回傳 null */
fun pickRelease(json: String, assetName: String = WEAR_APK_NAME): ReleaseInfo? {
  val o = try {
    Json.parseToJsonElement(json) as? JsonObject
  } catch (e: Exception) {
    null
  } ?: return null
  fun JsonObject.str(k: String): String? = (this[k] as? JsonPrimitive)?.takeIf { it.isString }?.contentOrNull
  val tag = o.str("tag_name") ?: return null
  val build = parseBuildTag(tag) ?: return null
  val asset = (o["assets"] as? JsonArray)?.filterIsInstance<JsonObject>()?.firstOrNull { it.str("name") == assetName } ?: return null
  val url = asset.str("browser_download_url")?.takeIf { it.startsWith("https://") } ?: return null
  val version = Regex("^v(\\d+\\.\\d+)$").matchEntire(o.str("name") ?: "")?.groupValues?.get(1) ?: tag
  val size = (asset["size"] as? JsonPrimitive)?.longOrNull ?: 0L
  return ReleaseInfo(build, version, tag, url, size)
}

fun isNewer(release: ReleaseInfo?, currentBuild: Int): Boolean = release != null && currentBuild > 0 && release.build > currentBuild

/** 檔案大小，例如 8.1 MB */
fun formatSize(bytes: Long): String = String.format(Locale.US, "%.1f MB", bytes / 1_000_000.0)

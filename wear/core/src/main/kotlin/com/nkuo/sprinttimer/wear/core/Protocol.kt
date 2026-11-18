package com.nkuo.sprinttimer.wear.core

import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.booleanOrNull
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.contentOrNull
import kotlinx.serialization.json.doubleOrNull
import kotlinx.serialization.json.jsonPrimitive
import kotlinx.serialization.json.put

/**
 * 起點機和終點手機之間的訊息（UDP JSON）。
 * 必須和手機 App 的 src/core/protocol.ts 完全相同：手錶在這裡扮演「起跑手機 A」（時鐘 server）。
 * 時間一律是送出方自己時鐘的秒數。
 */
sealed interface Msg {
  data class Hello(val role: String, val name: String) : Msg

  /** id、t0 原樣保留 JSON 值，回 pong 時一個位元都不改（終點用回傳的 t0 計算時鐘差） */
  data class Ping(val id: JsonElement, val t0: JsonElement) : Msg

  data class Pong(val id: JsonElement, val t0: JsonElement, val t1: Double, val t2: Double) : Msg

  /** 終點 → 起點：終點已就緒 */
  data class Arm(val raceId: String) : Msg

  /** phase：marks / set / aborted */
  data class Status(val raceId: String, val phase: String) : Msg

  data class Gun(val raceId: String, val tGun: Double) : Msg

  data class Reaction(val raceId: String, val tOnset: Double?) : Msg

  data class Result(val raceId: String, val raw: Double, val reaction: Double? = null, val falseStart: Boolean? = null) : Msg

  data class Ack(val of: String, val raceId: String) : Msg
}

const val PORT = 47800

fun encode(m: Msg): String =
  when (m) {
    is Msg.Hello -> buildJsonObject {
      put("type", "hello"); put("role", m.role); put("name", m.name); put("v", 1)
    }
    is Msg.Ping -> buildJsonObject {
      put("type", "ping"); put("id", m.id); put("t0", m.t0)
    }
    is Msg.Pong -> buildJsonObject {
      put("type", "pong"); put("id", m.id); put("t0", m.t0); put("t1", m.t1); put("t2", m.t2)
    }
    is Msg.Arm -> buildJsonObject {
      put("type", "arm"); put("raceId", m.raceId)
    }
    is Msg.Status -> buildJsonObject {
      put("type", "status"); put("raceId", m.raceId); put("phase", m.phase)
    }
    is Msg.Gun -> buildJsonObject {
      put("type", "gun"); put("raceId", m.raceId); put("tGun", m.tGun)
    }
    is Msg.Reaction -> buildJsonObject {
      put("type", "reaction"); put("raceId", m.raceId); put("tOnset", m.tOnset?.let { JsonPrimitive(it) } ?: JsonNull)
    }
    is Msg.Result -> buildJsonObject {
      put("type", "result"); put("raceId", m.raceId); put("raw", m.raw)
      m.reaction?.let { put("reaction", it) }
      m.falseStart?.let { put("falseStart", it) }
    }
    is Msg.Ack -> buildJsonObject {
      put("type", "ack"); put("of", m.of); put("raceId", m.raceId)
    }
  }.toString()

/** 看不懂或缺欄位的訊息回傳 null（直接丟掉，不讓壞封包弄壞接收迴圈） */
fun decode(s: String): Msg? {
  val o = try {
    Json.parseToJsonElement(s) as? JsonObject
  } catch (e: Exception) {
    null
  } ?: return null
  fun str(k: String): String? = (o[k] as? JsonPrimitive)?.takeIf { it.isString }?.contentOrNull
  fun num(k: String): Double? = (o[k] as? JsonPrimitive)?.takeIf { !it.isString }?.doubleOrNull
  return when (str("type")) {
    "hello" -> Msg.Hello(str("role") ?: return null, str("name") ?: "")
    "ping" -> Msg.Ping(o["id"] ?: return null, o["t0"] ?: return null)
    "pong" -> Msg.Pong(o["id"] ?: return null, o["t0"] ?: return null, num("t1") ?: return null, num("t2") ?: return null)
    "arm" -> Msg.Arm(str("raceId") ?: return null)
    "status" -> Msg.Status(str("raceId") ?: return null, str("phase") ?: return null)
    "gun" -> Msg.Gun(str("raceId") ?: return null, num("tGun") ?: return null)
    "reaction" -> Msg.Reaction(str("raceId") ?: return null, num("tOnset"))
    "result" -> Msg.Result(
      str("raceId") ?: return null,
      num("raw") ?: return null,
      num("reaction"),
      (o["falseStart"] as? JsonPrimitive)?.takeIf { !it.isString }?.booleanOrNull,
    )
    "ack" -> Msg.Ack(str("of") ?: return null, str("raceId") ?: return null)
    else -> null
  }
}

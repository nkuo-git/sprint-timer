package com.nkuo.sprinttimer.wear.core

import kotlinx.serialization.json.Json
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertNull
import kotlin.test.assertTrue

/** 訊息格式要和手機 App（src/core/protocol.ts 用 JSON.stringify 產生的字串）相容 */
class ProtocolTest {
  @Test
  fun decodesWhatThePhoneSends() {
    assertEquals(Msg.Hello("finish", "finish"), decode("""{"type":"hello","role":"finish","name":"finish","v":1}"""))
    assertEquals(Msg.Arm("ab12cd"), decode("""{"type":"arm","raceId":"ab12cd"}"""))
    assertEquals(
      Msg.Result("ab12cd", 11.417, 0.148, false),
      decode("""{"type":"result","raceId":"ab12cd","raw":11.417,"reaction":0.148,"falseStart":false}"""),
    )
    // 手機沒有反應時間時 JSON.stringify 會省略 undefined 的欄位
    assertEquals(Msg.Result("ab12cd", 11.417), decode("""{"type":"result","raceId":"ab12cd","raw":11.417}"""))
    assertEquals(Msg.Reaction("x", null), decode("""{"type":"reaction","raceId":"x","tOnset":null}"""))
  }

  @Test
  fun pongEchoesPingValuesExactly() {
    // 終點用 pong 裡回傳的 t0 算時鐘差，所以不能有任何進位誤差
    val ping = decode("""{"type":"ping","id":734512,"t0":81234.56789012345}""") as Msg.Ping
    val pong = encode(Msg.Pong(ping.id, ping.t0, 5.25, 5.5))
    assertTrue(pong.contains(""""id":734512"""), pong)
    assertTrue(pong.contains(""""t0":81234.56789012345"""), pong)
    val o = Json.parseToJsonElement(pong).jsonObject
    assertEquals("pong", o["type"]!!.jsonPrimitive.content)
    assertEquals(5.25, o["t1"]!!.jsonPrimitive.content.toDouble())
  }

  @Test
  fun encodesWhatThePhoneExpects() {
    val gun = Json.parseToJsonElement(encode(Msg.Gun("ab12cd", 12345678.123456789))).jsonObject
    assertEquals("gun", gun["type"]!!.jsonPrimitive.content)
    assertEquals("ab12cd", gun["raceId"]!!.jsonPrimitive.content)
    // 數字（不是字串），而且讀回來是同一個 double
    assertTrue(!gun["tGun"]!!.jsonPrimitive.isString)
    assertEquals(12345678.123456789, gun["tGun"]!!.jsonPrimitive.content.toDouble())
    assertEquals("""{"type":"status","raceId":"r1","phase":"marks"}""", encode(Msg.Status("r1", "marks")))
    assertEquals("""{"type":"hello","role":"start","name":"watch","v":1}""", encode(Msg.Hello("start", "watch")))
  }

  @Test
  fun dropsGarbage() {
    assertNull(decode("not json"))
    assertNull(decode("[1,2,3]"))
    assertNull(decode("""{"type":"gun","raceId":"x"}"""))
    assertNull(decode("""{"type":"gun","raceId":"x","tGun":"12"}"""))
    assertNull(decode("""{"type":"nope"}"""))
    assertNull(decode(""))
  }

  @Test
  fun planStartMatchesPhone() {
    val p = planStart(StartSequenceConfig(leadIn = 5.0, marksToSet = 10.0, setToGunMin = 1.6, setToGunMax = 2.6)) { 0.5 }
    assertEquals(5.0, p.marks)
    assertEquals(15.0, p.set)
    assertEquals(17.1, p.gun, 1e-9)
  }

  @Test
  fun officialTimeRoundsUpLikeThePhone() {
    assertEquals("11.42", formatOfficial(11.417))
    assertEquals("11.42", formatOfficial(11.4101))
    assertEquals("10.23", formatOfficial(10.230000000001))
    assertEquals("10.23", formatOfficial(10.23))
    assertEquals("10.24", formatOfficial(10.2301))
    assertEquals("11.417", formatRaw(11.4172))
  }
}

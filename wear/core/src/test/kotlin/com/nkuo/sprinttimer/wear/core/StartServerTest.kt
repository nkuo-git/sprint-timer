package com.nkuo.sprinttimer.wear.core

import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.double
import kotlinx.serialization.json.jsonPrimitive
import kotlin.test.AfterTest
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertTrue

class StartServerTest {
  /** 起點機的時鐘故意和終點差 1000 秒，看終點算不算得出來 */
  private val offset = 1000.0
  private fun finishClock() = System.nanoTime() / 1e9
  private val server = StartServer(clock = { finishClock() + offset }, port = 0)

  @AfterTest
  fun tearDown() = server.stop()

  @Test
  fun helloConnectsAndReplies() {
    server.start()
    var peer: String? = null
    server.listener = object : StartServer.Listener {
      override fun onPeer(address: String) {
        peer = address
      }
    }
    assertFalse(server.isConnected())
    assertFalse(server.send(Msg.Status("x", "marks")), "沒有終點時不送")
    FakeFinish(server.localPort).use { f ->
      f.hello()
      val reply = f.await(what = "hello reply") { f.all<Msg.Hello>().firstOrNull() }
      assertEquals("start", reply.role)
      assertTrue(server.isConnected())
      assertEquals("127.0.0.1", peer)
      // 連上之後才送得出去，而且送到終點
      server.sendReliable(Msg.Status("r1", "marks"), times = 3, gapMs = 10)
      f.await(what = "3 status") { f.all<Msg.Status>().takeIf { it.size == 3 } }
    }
  }

  @Test
  fun ignoresHelloFromAnotherStartDevice() {
    server.start()
    FakeFinish(server.localPort).use { f ->
      f.send(Msg.Hello("start", "other"))
      Thread.sleep(150)
      assertFalse(server.hasPeer)
      assertTrue(f.received.isEmpty())
    }
  }

  /** 和手機 App 的 syncRound + estimateOffset 同樣的算法：取 rtt 最小 20% 的 offset 中位數 */
  @Test
  fun clockSyncRecoversOffset() {
    server.start()
    FakeFinish(server.localPort).use { f ->
      f.hello()
      f.await(what = "hello") { f.all<Msg.Hello>().firstOrNull() }
      val n = 40
      repeat(n) { i ->
        f.send(Msg.Ping(JsonPrimitive(5000 + i), JsonPrimitive(finishClock())))
        Thread.sleep(5)
      }
      f.await(what = "$n pongs") { f.all<Msg.Pong>().takeIf { it.size == n } }
      data class Row(val offset: Double, val rtt: Double)
      val rows = f.received.filter { it.first is Msg.Pong }.map { (m, tNanos) ->
        m as Msg.Pong
        val t0 = m.t0.jsonPrimitive.double
        val t3 = tNanos / 1e9
        Row(((m.t1 - t0) + (m.t2 - t3)) / 2, (t3 - t0) - (m.t2 - m.t1))
      }.sortedBy { it.rtt }
      assertTrue(rows.all { it.rtt >= 0 }, "rtt 不可為負：t1/t2 必須是收到與送出的實際時刻")
      val best = rows.take(8).map { it.offset }.sorted()
      val est = (best[3] + best[4]) / 2
      assertEquals(offset, est, 0.001, "時鐘差應在 1ms 內")
      // id 原樣回傳
      assertEquals((5000 until 5000 + n).toSet(), f.all<Msg.Pong>().map { it.id.jsonPrimitive.content.toInt() }.toSet())
    }
  }

  @Test
  fun adoptsFinishThatIsAlreadyPinging() {
    // 手錶 App 重開，但終點手機還連著、繼續同步：不用重新輸入 IP
    server.start()
    FakeFinish(server.localPort).use { f ->
      f.send(Msg.Ping(JsonPrimitive(1), JsonPrimitive(1.0)))
      f.await(what = "pong") { f.all<Msg.Pong>().firstOrNull() }
      assertTrue(server.isConnected())
    }
  }

  @Test
  fun survivesGarbageAndRestart() {
    server.start()
    FakeFinish(server.localPort).use { f ->
      f.sendRaw("garbage")
      f.sendRaw("""{"type":"ping"}""")
      f.hello()
      f.await(what = "hello after garbage") { f.all<Msg.Hello>().firstOrNull() }
    }
    // Wi-Fi 斷掉再連上：重新 start，同一個物件可以再用
    server.start()
    FakeFinish(server.localPort).use { f ->
      f.hello()
      f.await(what = "hello after restart") { f.all<Msg.Hello>().firstOrNull() }
    }
  }
}

package com.nkuo.sprinttimer.wear.core

import java.util.concurrent.CopyOnWriteArrayList
import kotlin.test.AfterTest
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertNull
import kotlin.test.assertTrue

class RaceControllerTest {
  private fun now() = System.nanoTime() / 1e9
  private val server = StartServer(clock = ::now, port = 0)
  private val states = CopyOnWriteArrayList<StartState>()
  private val said = CopyOnWriteArrayList<Command>()
  private val shots = CopyOnWriteArrayList<Double>()

  /** 假的槍：睡到指定時間，回報「晚了 2ms 才發聲」 */
  private val gun = Gun { at, cancelled ->
    while (now() < at) {
      if (cancelled()) return@Gun null
      Thread.sleep(1)
    }
    shots.add(at)
    GunShot(at + 0.002, "test")
  }

  private val fast = StartSequenceConfig(leadIn = 0.08, marksToSet = 0.12, setToGunMin = 0.1, setToGunMax = 0.2)

  private fun controller(resultTimeoutSec: Double = 120.0, soloHoldSec: Double = 0.1) =
    RaceController(
      clock = ::now,
      server = server,
      announcer = { said.add(it) },
      gun = gun,
      rand = { 0.5 },
      resultTimeoutSec = resultTimeoutSec,
      soloHoldSec = soloHoldSec,
      gunResendEverySec = 0.05,
      onState = { states.add(it) },
    ).also { it.config = fast }

  private fun phases() = states.map { it.phase }.fold(listOf<Phase>()) { acc, p -> if (acc.lastOrNull() == p) acc else acc + p }

  private fun <T> await(timeoutMs: Long = 3000, what: String, f: () -> T?): T {
    val end = System.currentTimeMillis() + timeoutMs
    while (System.currentTimeMillis() < end) {
      f()?.let { return it }
      Thread.sleep(5)
    }
    throw AssertionError("timed out waiting for $what; phases=${phases()}")
  }

  @AfterTest
  fun tearDown() = server.stop()

  @Test
  fun fullTimedRace() {
    server.start()
    val c = controller()
    FakeFinish(server.localPort).use { f ->
      f.hello()
      await(what = "connected") { c.current.takeIf { it.connected } }
      val tStart = now()
      c.start()
      c.start() // 連按兩下只算一趟

      // 終點收到的順序：marks → set → gun
      val gunMsg = f.await(what = "gun") { f.all<Msg.Gun>().firstOrNull() }
      val kinds = f.received.map { it.first }.filter { it is Msg.Status || it is Msg.Gun }
        .map { if (it is Msg.Status) it.phase else "gun" }
        .fold(listOf<String>()) { acc, k -> if (acc.lastOrNull() == k) acc else acc + k }
      assertEquals(listOf("marks", "set", "gun"), kinds)
      assertEquals(listOf(Command.MARKS, Command.SET), said.toList())
      assertEquals(1, shots.size)

      // 鳴槍時間 = 槍回報的實際發聲時間（不是排程時間），排程時間 = 0.08 + 0.12 + 0.15
      assertEquals(shots[0] + 0.002, gunMsg.tGun, 1e-9)
      assertEquals(tStart + 0.35, shots[0], 0.03)
      val raceId = gunMsg.raceId
      assertTrue(f.all<Msg.Status>().all { it.raceId == raceId })
      assertEquals(Phase.GUN, c.current.phase)
      assertTrue(c.current.timed)

      // 別趟的成績不理
      f.send(Msg.Result("zzzzzz", 9.99))
      Thread.sleep(80)
      assertEquals(Phase.GUN, c.current.phase)

      f.send(Msg.Result(raceId, 11.417))
      val done = await(what = "result") { c.current.takeIf { it.phase == Phase.RESULT } }
      assertEquals(11.417, done.resultRaw)
      assertEquals(1, done.raceNo)
      // 開頭的 IDLE 是「終點連上了」那次狀態更新
      assertEquals(listOf(Phase.IDLE, Phase.COUNTDOWN, Phase.MARKS, Phase.SET, Phase.GUN, Phase.RESULT), phases())

      // 收到成績後不再重送鳴槍時間（先等一開始排好的那 6 次送完）
      Thread.sleep(300)
      val n = f.all<Msg.Gun>().size
      Thread.sleep(200)
      assertEquals(n, f.all<Msg.Gun>().size)

      c.next()
      assertEquals(Phase.IDLE, c.current.phase)
      assertEquals(2, c.current.raceNo)
      assertNull(c.current.resultRaw)
    }
    c.close()
  }

  @Test
  fun keepsResendingGunUntilFinishIsBack() {
    server.start()
    val c = controller()
    FakeFinish(server.localPort).use { f ->
      f.hello()
      await(what = "connected") { c.current.takeIf { it.connected } }
      f.paused = true // 終點斷線：鳴槍那一刻的封包全部掉了
      c.start()
      await(what = "gun") { c.current.takeIf { it.phase == Phase.GUN } }
      Thread.sleep(400) // 超過一開始那 6 次重送（6 × 40ms）
      assertTrue(f.all<Msg.Gun>().isEmpty() && f.all<Msg.Status>().isEmpty())
      f.paused = false // 連回來
      val g = f.await(what = "gun after reconnect") { f.all<Msg.Gun>().firstOrNull() }
      assertEquals(shots[0] + 0.002, g.tGun, 1e-9)
      f.send(Msg.Result(g.raceId, 12.0))
      await(what = "result") { c.current.takeIf { it.phase == Phase.RESULT } }
    }
    c.close()
  }

  @Test
  fun lateResultAfterGivingUpIsStillShown() {
    server.start()
    val c = controller(resultTimeoutSec = 0.15)
    FakeFinish(server.localPort).use { f ->
      f.hello()
      await(what = "connected") { c.current.takeIf { it.connected } }
      c.start()
      val g = f.await(what = "gun") { f.all<Msg.Gun>().firstOrNull() }
      await(what = "no result") { c.current.takeIf { it.phase == Phase.NO_RESULT } }
      c.next() // 不等了
      assertEquals(Phase.IDLE, c.current.phase)
      assertEquals(2, c.current.raceNo)
      f.send(Msg.Result(g.raceId, 13.5))
      val s = await(what = "late result") { c.current.takeIf { it.phase == Phase.RESULT } }
      assertEquals(13.5, s.resultRaw)
      assertEquals(1, s.raceNo)
      c.next()
      assertEquals(2, c.current.raceNo)

      // 已經開始下一趟之後，上一趟的成績就不再顯示
      c.start()
      await(what = "countdown") { c.current.takeIf { it.phase == Phase.COUNTDOWN } }
      f.send(Msg.Result(g.raceId, 13.5))
      Thread.sleep(50)
      assertTrue(c.current.phase != Phase.RESULT)
      c.cancel()
    }
    c.close()
  }

  @Test
  fun cancelBeforeGunStopsEverything() {
    server.start()
    val c = controller()
    c.config = fast.copy(marksToSet = 0.4)
    FakeFinish(server.localPort).use { f ->
      f.hello()
      await(what = "connected") { c.current.takeIf { it.connected } }
      c.start()
      await(what = "marks") { c.current.takeIf { it.phase == Phase.MARKS } }
      c.cancel()
      assertEquals(Phase.IDLE, c.current.phase)
      assertEquals(1, c.current.raceNo, "取消的不算一趟")
      f.await(what = "aborted") { f.all<Msg.Status>().firstOrNull { it.phase == "aborted" } }
      Thread.sleep(700)
      assertTrue(shots.isEmpty(), "取消後不可以鳴槍")
      assertEquals(listOf(Command.MARKS), said.toList())
      assertTrue(f.all<Msg.Gun>().isEmpty())
      assertEquals(Phase.IDLE, c.current.phase)

      // 取消後可以馬上重來
      c.config = fast
      c.start()
      f.await(what = "gun") { f.all<Msg.Gun>().firstOrNull() }
      assertEquals(1, c.current.raceNo)
    }
    c.close()
  }

  @Test
  fun cancelDuringSetStopsTheGun() {
    server.start()
    val c = controller()
    c.config = fast.copy(setToGunMin = 0.5, setToGunMax = 0.5)
    c.start()
    await(what = "set") { c.current.takeIf { it.phase == Phase.SET } }
    Thread.sleep(50)
    c.cancel()
    Thread.sleep(700)
    assertTrue(shots.isEmpty())
    assertEquals(Phase.IDLE, c.current.phase)
    c.close()
  }

  @Test
  fun soloRaceWithoutFinishPhone() {
    server.start()
    val c = controller(soloHoldSec = 0.15)
    assertFalse(c.current.connected)
    c.start()
    val g = await(what = "gun") { c.current.takeIf { it.phase == Phase.GUN } }
    assertFalse(g.timed)
    assertEquals("test", g.gunMethod)
    // 只發令：鳴槍後自己回到待命，算一趟
    val idle = await(what = "idle") { c.current.takeIf { it.phase == Phase.IDLE } }
    assertEquals(2, idle.raceNo)
    assertEquals(listOf(Phase.COUNTDOWN, Phase.MARKS, Phase.SET, Phase.GUN, Phase.IDLE), phases())
    c.close()
  }

  @Test
  fun countdownAndMarksExposeProgressButSetDoesNot() {
    server.start()
    val c = controller()
    c.start()
    await(what = "gun") { c.current.takeIf { it.phase == Phase.GUN } }
    val cd = states.first { it.phase == Phase.COUNTDOWN }
    val marks = states.first { it.phase == Phase.MARKS }
    val set = states.first { it.phase == Phase.SET }
    assertEquals(0.08, cd.phaseEndsAt!! - cd.phaseStartedAt, 1e-9)
    assertEquals(0.12, marks.phaseEndsAt!! - marks.phaseStartedAt, 1e-9)
    assertNull(set.phaseEndsAt, "預備階段不可以洩漏鳴槍時間")
    c.close()
  }
}

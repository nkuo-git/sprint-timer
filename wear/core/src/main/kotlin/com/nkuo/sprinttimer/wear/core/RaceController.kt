package com.nkuo.sprinttimer.wear.core

import java.util.concurrent.Executors
import java.util.concurrent.TimeUnit

enum class Phase {
  /** 待命，可以按開始 */
  IDLE,

  /** 按下開始後、喊「各就位」前的倒數 */
  COUNTDOWN,
  MARKS,
  SET,

  /** 已鳴槍。有終點計時的話在等成績 */
  GUN,
  RESULT,

  /** 等很久終點都沒回傳成績 */
  NO_RESULT,
}

enum class Command { MARKS, SET }

/** 喊口令。時間不需精準，只有槍聲需要。 */
fun interface Announcer {
  fun say(cmd: Command)
}

data class GunShot(
  /** 槍聲實際從喇叭發出的時刻（起點機時鐘，秒） */
  val emittedAt: Double,
  /** 這個時刻是怎麼得到的（量測或估計），顯示用 */
  val method: String,
)

fun interface Gun {
  /**
   * 在時刻 [at] 鳴槍，回傳實際發聲時刻。會佔住呼叫的執行緒直到槍聲發出。
   * 等待期間 [cancelled] 變成 true 就不鳴槍並回傳 null。
   */
  fun playAt(at: Double, cancelled: () -> Boolean): GunShot?
}

data class StartState(
  val phase: Phase = Phase.IDLE,
  /** IDLE 時是「接下來這一趟」的編號；其他階段是進行中／剛跑完那一趟 */
  val raceNo: Int = 1,
  /** 終點手機連線中 */
  val connected: Boolean = false,
  /** 這一趟有終點計時（按開始時終點有連線）。false = 只發令 */
  val timed: Boolean = false,
  /** 這個階段開始與預定結束的時刻（畫進度用）。「預備」不給結束時刻：鳴槍時間不能讓人看出來 */
  val phaseStartedAt: Double = 0.0,
  val phaseEndsAt: Double? = null,
  /** 終點回傳的原始成績（秒） */
  val resultRaw: Double? = null,
  val gunMethod: String? = null,
)

/**
 * 起點機的一趟流程：倒數 → 各就位 → 預備 → 鳴槍 → 等成績。對應手機 App 的 TwoPhoneStart。
 * 和手機不同的地方：鳴槍時間會一直重送到收到成績為止（手錶 Wi-Fi 在 100 公尺外容易斷，連回來要能補上）。
 */
class RaceController(
  private val clock: () -> Double,
  private val server: StartServer,
  private val announcer: Announcer,
  private val gun: Gun,
  private val rand: () -> Double = Math::random,
  /** 鳴槍後多久沒成績就顯示「沒收到成績」（之後成績到了還是會顯示） */
  private val resultTimeoutSec: Double = 120.0,
  /** 只發令時，鳴槍後停留多久回到待命 */
  private val soloHoldSec: Double = 3.0,
  /** 鳴槍時間重送的間隔與最長持續時間 */
  private val gunResendEverySec: Double = 1.0,
  private val gunResendForSec: Double = 600.0,
  private val onState: (StartState) -> Unit,
) : StartServer.Listener {
  @Volatile var config: StartSequenceConfig = StartSequenceConfig()

  private val lock = Any()
  private var state = StartState()
  @Volatile private var race: Race? = null
  private val ticker = Executors.newSingleThreadScheduledExecutor { r -> Thread(r, "start-ticker").apply { isDaemon = true } }

  private class Race(val id: String, val no: Int, val timed: Boolean) {
    @Volatile var cancelled = false
    @Volatile var gunAt: Double? = null
    @Volatile var result: Double? = null

    /** 使用者已離開這一趟的畫面（不等了） */
    @Volatile var dismissed = false
    var thread: Thread? = null
  }

  init {
    server.listener = this
    // 連線狀態沒有事件可聽（UDP），所以定時看多久沒收到終點的訊息
    ticker.scheduleWithFixedDelay({ update { it.copy(connected = server.isConnected()) } }, 1, 1, TimeUnit.SECONDS)
  }

  val current: StartState get() = synchronized(lock) { state }

  private fun update(f: (StartState) -> StartState) {
    val next = synchronized(lock) {
      val n = f(state)
      if (n == state) return
      state = n
      n
    }
    onState(next)
  }

  /** 這一趟往下一個階段走。已取消或已換下一趟就不動（在鎖裡檢查，才不會蓋掉取消後的待命狀態）。 */
  private fun advance(r: Race, f: (StartState) -> StartState) = update { if (r.cancelled || race !== r) it else f(it) }

  /** 開始一趟。已在進行中就不理。 */
  fun start() {
    val r: Race
    val plan = planStart(config, rand)
    val t0 = clock()
    synchronized(lock) {
      if (state.phase in ACTIVE) return
      val prev = race
      if (prev != null) {
        prev.dismissed = true
        prev.thread?.interrupt()
      }
      val no = if (state.phase == Phase.IDLE) state.raceNo else state.raceNo + 1
      r = Race(newRaceId(), no, server.isConnected())
      race = r
    }
    update {
      StartState(
        phase = Phase.COUNTDOWN,
        raceNo = r.no,
        connected = server.isConnected(),
        timed = r.timed,
        phaseStartedAt = t0,
        phaseEndsAt = t0 + plan.marks,
      )
    }
    r.thread = Thread({ run(r, t0, plan) }, "start-race").apply {
      isDaemon = true
      start()
    }
  }

  private fun run(r: Race, t0: Double, plan: StartSchedule) {
    try {
      // 通知終點：開始學背景、進入待命
      if (r.timed) server.sendReliable(Msg.Status(r.id, "marks"))
      sleepUntil(t0 + plan.marks)
      if (r.cancelled) return
      advance(r) { it.copy(phase = Phase.MARKS, phaseStartedAt = t0 + plan.marks, phaseEndsAt = t0 + plan.set) }
      announcer.say(Command.MARKS)

      sleepUntil(t0 + plan.set)
      if (r.cancelled) return
      advance(r) { it.copy(phase = Phase.SET, phaseStartedAt = t0 + plan.set, phaseEndsAt = null) }
      announcer.say(Command.SET)
      if (r.timed) server.sendReliable(Msg.Status(r.id, "set"))

      val shot = gun.playAt(t0 + plan.gun) { r.cancelled } ?: return
      if (r.cancelled) return
      r.gunAt = shot.emittedAt
      advance(r) { it.copy(phase = Phase.GUN, phaseStartedAt = shot.emittedAt, phaseEndsAt = null, gunMethod = shot.method) }

      if (!r.timed) {
        sleepUntil(clock() + soloHoldSec)
        if (!r.dismissed) finishSolo(r)
        return
      }

      // 一直重送鳴槍時間，直到收到成績。終點用 raceId 去重，多送無害。
      val msg = Msg.Gun(r.id, shot.emittedAt)
      server.sendReliable(msg, 6)
      var timedOut = false
      while (r.result == null && race === r && clock() - shot.emittedAt < gunResendForSec) {
        sleepUntil(clock() + gunResendEverySec)
        if (r.result != null || race !== r) break
        server.send(msg)
        if (!timedOut && !r.dismissed && clock() - shot.emittedAt >= resultTimeoutSec) {
          timedOut = true
          update { if (it.phase == Phase.GUN && it.raceNo == r.no) it.copy(phase = Phase.NO_RESULT) else it }
        }
      }
    } catch (e: InterruptedException) {
      // 取消、收到成績或開始下一趟
    }
  }

  private fun finishSolo(r: Race) {
    update { if (it.phase == Phase.GUN && it.raceNo == r.no) idleAfter(it) else it }
  }

  private fun idleAfter(s: StartState) =
    StartState(phase = Phase.IDLE, raceNo = s.raceNo + 1, connected = server.isConnected())

  /** 鳴槍前取消這一趟 */
  fun cancel() {
    val r = synchronized(lock) {
      if (state.phase !in CANCELLABLE) return
      race?.also { it.cancelled = true }
    } ?: return
    r.thread?.interrupt()
    if (r.timed) server.sendReliable(Msg.Status(r.id, "aborted"))
    // 取消的這一趟不算，編號不變
    update { StartState(phase = Phase.IDLE, raceNo = r.no, connected = server.isConnected()) }
  }

  /** 離開鳴槍後的畫面（不等了／再一次），回到待命，準備下一趟。之後成績才到的話仍會顯示。 */
  fun next() {
    synchronized(lock) {
      if (state.phase !in AFTER_GUN) return
      race?.dismissed = true
    }
    update { if (it.phase in AFTER_GUN) idleAfter(it) else it }
  }

  override fun onPeer(address: String) {
    update { it.copy(connected = true) }
  }

  override fun onResult(m: Msg.Result) {
    val r = race ?: return
    if (m.raceId != r.id || r.gunAt == null || r.result != null) return
    r.result = m.raw
    r.thread?.interrupt()
    update {
      when {
        // 還在這一趟（等成績或已顯示沒收到）
        it.raceNo == r.no && it.phase in AFTER_GUN ->
          it.copy(phase = Phase.RESULT, resultRaw = m.raw)
        // 已經按了「不等了」回到待命、但還沒開始下一趟：成績晚到，補顯示
        it.phase == Phase.IDLE && it.raceNo == r.no + 1 ->
          it.copy(phase = Phase.RESULT, raceNo = r.no, timed = true, resultRaw = m.raw)
        else -> it
      }
    }
  }

  fun close() {
    ticker.shutdownNow()
    synchronized(lock) {
      race?.let {
        it.cancelled = true
        it.dismissed = true
        it.thread?.interrupt()
      }
      race = null
    }
    if (server.listener === this) server.listener = null
  }

  private fun sleepUntil(t: Double) {
    while (true) {
      val ms = ((t - clock()) * 1000).toLong()
      if (ms <= 0) return
      Thread.sleep(ms)
    }
  }

  private fun newRaceId(): String {
    val chars = "abcdefghijklmnopqrstuvwxyz0123456789"
    return (1..6).map { chars[(rand() * chars.length).toInt().coerceIn(0, chars.length - 1)] }.joinToString("")
  }

  private companion object {
    val ACTIVE = setOf(Phase.COUNTDOWN, Phase.MARKS, Phase.SET, Phase.GUN)
    val CANCELLABLE = setOf(Phase.COUNTDOWN, Phase.MARKS, Phase.SET)
    val AFTER_GUN = setOf(Phase.GUN, Phase.RESULT, Phase.NO_RESULT)
  }
}

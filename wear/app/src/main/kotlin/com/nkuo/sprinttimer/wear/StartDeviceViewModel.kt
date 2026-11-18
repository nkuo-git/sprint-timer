package com.nkuo.sprinttimer.wear

import android.app.Application
import android.content.Context
import android.media.AudioManager
import android.os.Handler
import android.os.Looper
import android.os.PowerManager
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import androidx.lifecycle.AndroidViewModel
import com.nkuo.sprinttimer.wear.core.Phase
import com.nkuo.sprinttimer.wear.core.RaceController
import com.nkuo.sprinttimer.wear.core.StartSequenceConfig
import com.nkuo.sprinttimer.wear.core.StartServer
import com.nkuo.sprinttimer.wear.core.StartState
import expo.modules.precisionclock.shared.GunPlayer

/**
 * 手錶起點機的全部狀態：Wi-Fi、和終點手機的連線、一趟的流程、設定。畫面只讀這裡的狀態、呼叫這裡的動作。
 */
class StartDeviceViewModel(app: Application) : AndroidViewModel(app) {
  private val main = Handler(Looper.getMainLooper())
  private val prefs = app.getSharedPreferences("start", Context.MODE_PRIVATE)
  private val audio = app.getSystemService(Context.AUDIO_SERVICE) as AudioManager
  private val wakeLock = (app.getSystemService(Context.POWER_SERVICE) as PowerManager)
    .newWakeLock(PowerManager.PARTIAL_WAKE_LOCK, "sprinttimer:race")
    .apply { setReferenceCounted(false) }

  private val gun = WatchGun(app)
  private val speech = Speech(app)
  private val server = StartServer(clock = { GunPlayer.nowSec() })
  private val controller = RaceController(
    clock = { GunPlayer.nowSec() },
    server = server,
    announcer = speech,
    gun = gun,
    onState = { s -> main.post { onRaceState(s) } },
  )
  private val wifi = WifiLink(app) { network, ip ->
    if (network != null && ip != null) {
      try {
        server.start { socket -> network.bindSocket(socket) }
      } catch (e: Exception) {
        server.stop()
      }
    } else {
      server.stop()
      server.forgetPeer()
    }
    main.post { this.ip = if (network != null) ip else null }
  }

  /** 一趟的狀態（階段、第幾趟、終點有沒有連線、成績） */
  var race by mutableStateOf(StartState())
    private set

  /** 手錶在 Wi-Fi 上的 IP；null = 沒連上 Wi-Fi */
  var ip by mutableStateOf<String?>(null)
    private set

  /** 手錶本身有沒有喇叭。沒有就不能當起點機。 */
  val hasSpeaker: Boolean = gun.hasSpeaker

  /** 使用者選了「只發令，不計時」 */
  var solo by mutableStateOf(false)

  var lang by mutableStateOf(if (prefs.getString("lang", "zh") == "en") CommandLang.EN else CommandLang.ZH)
    private set

  /** 按開始後倒數幾秒才喊「各就位」 */
  var leadInSec by mutableStateOf(prefs.getInt("leadIn", 5).coerceIn(LEAD_IN_MIN, LEAD_IN_MAX))
    private set

  private var savedVolume: Int? = null

  init {
    speech.lang = lang
    wifi.start()
  }

  /** 和鳴槍時間同一個時鐘（秒），畫面用它算倒數與進度 */
  fun now(): Double = GunPlayer.nowSec()

  fun chooseLang(l: CommandLang) {
    lang = l
    speech.lang = l
    prefs.edit().putString("lang", if (l == CommandLang.EN) "en" else "zh").apply()
  }

  fun changeLeadIn(delta: Int) {
    leadInSec = (leadInSec + delta).coerceIn(LEAD_IN_MIN, LEAD_IN_MAX)
    prefs.edit().putInt("leadIn", leadInSec).apply()
  }

  fun start() {
    if (!hasSpeaker) return
    gun.prepare()
    controller.config = StartSequenceConfig(leadIn = leadInSec.toDouble())
    raiseVolume()
    // 口令進行中和等成績時不讓手錶睡著（否則排程和同步都會停）；最長 15 分鐘
    wakeLock.acquire(15 * 60 * 1000L)
    controller.start()
  }

  fun cancel() {
    controller.cancel()
    speech.stop()
  }

  /** 不等了／再一次：回到待命 */
  fun next() = controller.next()

  private fun onRaceState(s: StartState) {
    race = s
    if (s.phase == Phase.IDLE || s.phase == Phase.RESULT || s.phase == Phase.NO_RESULT) {
      if (wakeLock.isHeld) wakeLock.release()
    }
  }

  /** 手錶喇叭很小聲，發令時一律開到最大；離開 App 時還原 */
  private fun raiseVolume() {
    try {
      if (savedVolume == null) savedVolume = audio.getStreamVolume(AudioManager.STREAM_MUSIC)
      audio.setStreamVolume(AudioManager.STREAM_MUSIC, audio.getStreamMaxVolume(AudioManager.STREAM_MUSIC), 0)
    } catch (e: SecurityException) {
      // 勿擾模式下不能改音量：照原本的音量播
    }
  }

  /** App 離開前景時呼叫。一趟還在進行就先不還原。 */
  fun restoreVolumeIfIdle() {
    val p = race.phase
    if (p == Phase.COUNTDOWN || p == Phase.MARKS || p == Phase.SET) return
    val v = savedVolume ?: return
    savedVolume = null
    try {
      audio.setStreamVolume(AudioManager.STREAM_MUSIC, v, 0)
    } catch (e: SecurityException) {
    }
  }

  override fun onCleared() {
    controller.close()
    wifi.stop()
    server.stop()
    speech.close()
    if (wakeLock.isHeld) wakeLock.release()
    savedVolume?.let {
      try {
        audio.setStreamVolume(AudioManager.STREAM_MUSIC, it, 0)
      } catch (e: SecurityException) {
      }
    }
  }

  companion object {
    const val LEAD_IN_MIN = 3
    const val LEAD_IN_MAX = 30
  }
}

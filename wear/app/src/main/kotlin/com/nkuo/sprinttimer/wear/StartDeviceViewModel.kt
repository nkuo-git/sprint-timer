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
import com.nkuo.sprinttimer.wear.core.ReleaseInfo
import com.nkuo.sprinttimer.wear.core.StartSequenceConfig
import com.nkuo.sprinttimer.wear.core.StartServer
import com.nkuo.sprinttimer.wear.core.StartState
import expo.modules.precisionclock.shared.GunPlayer
import kotlin.concurrent.thread

/** App 內更新的進度 */
sealed interface UpdateUi {
  data object None : UpdateUi

  /** 有新版，等使用者決定 */
  data class Offer(val release: ReleaseInfo) : UpdateUi

  data class Downloading(val release: ReleaseInfo, val fraction: Float) : UpdateUi

  data class Installing(val release: ReleaseInfo) : UpdateUi

  /** [installBlocked]：檔案下載好了但手錶不讓 App 自己安裝；false = 下載失敗 */
  data class Failed(val release: ReleaseInfo, val installBlocked: Boolean) : UpdateUi
}

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
    main.post {
      this.ip = if (network != null) ip else null
      // 剛連上 Wi-Fi：之前沒查成更新的話再查一次
      if (network != null) checkForUpdate()
    }
  }
  private val updater = Updater(app)

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

  /** App 內更新的狀態。只在待命時顯示，不會打斷進行中的一趟。 */
  var update by mutableStateOf<UpdateUi>(UpdateUi.None)
    private set

  /** 手機透過配對連線傳來的更新（畫面 26）：接收中、安裝中。和上面手錶自己下載的更新是兩條路。 */
  var phoneUpdate by mutableStateOf(PhoneUpdate.state)
    private set

  /** 目前安裝的顯示版本，例如 "0.6" */
  val currentVersion: String get() = updater.currentVersion

  private var savedVolume: Int? = null
  private var updateChecked = false
  private var updateChecking = false

  init {
    speech.lang = lang
    wifi.start()
    UpdateReceiver.onInstallFailed = { main.post { onInstallFailed() } }
    PhoneUpdate.onChange = { s -> main.post { phoneUpdate = s } }
    checkForUpdate()
  }

  /** 查有沒有新版。每次開 App 查到一次結果為止；沒網路就安靜地略過。 */
  private fun checkForUpdate() {
    if (updateChecked || updateChecking) return
    updateChecking = true
    thread(name = "update-check", isDaemon = true) {
      val result = try {
        Result.success(updater.check())
      } catch (e: Exception) {
        Result.failure(e)
      }
      main.post {
        updateChecking = false
        if (result.isSuccess) {
          updateChecked = true
          val rel = result.getOrNull()
          if (rel != null && update == UpdateUi.None) update = UpdateUi.Offer(rel)
        }
      }
    }
  }

  /** 按「更新」或「再試一次」：下載並安裝 */
  fun startUpdate() {
    val rel = when (val u = update) {
      is UpdateUi.Offer -> u.release
      is UpdateUi.Failed -> u.release
      else -> return
    }
    update = UpdateUi.Downloading(rel, 0f)
    thread(name = "update-download", isDaemon = true) {
      var lastShown = -1
      val file = try {
        updater.download(rel) { f ->
          // 每 1% 更新一次畫面就夠了
          val pct = (f * 100).toInt()
          if (pct != lastShown) {
            lastShown = pct
            main.post { if (update is UpdateUi.Downloading) update = UpdateUi.Downloading(rel, f) }
          }
        }
      } catch (e: Exception) {
        main.post { update = UpdateUi.Failed(rel, installBlocked = false) }
        return@thread
      }
      main.post { update = UpdateUi.Installing(rel) }
      try {
        updater.install(file)
      } catch (e: Exception) {
        main.post { update = UpdateUi.Failed(rel, installBlocked = true) }
        return@thread
      }
      // 裝成功的話 App 會被系統關掉，走不到這裡之後。過很久都沒動靜就當作裝不了。
      main.postDelayed({ if (update is UpdateUi.Installing) onInstallFailed() }, 120_000)
    }
  }

  private fun onInstallFailed() {
    val u = update
    if (u is UpdateUi.Installing) update = UpdateUi.Failed(u.release, installBlocked = true)
  }

  /** 按「稍後」：這次開 App 不再問 */
  fun dismissUpdate() {
    if (update is UpdateUi.Offer || update is UpdateUi.Failed) update = UpdateUi.None
  }

  /** 手機傳來的安裝檔已經收到多少（0–1）。檔案是系統直接寫進來的，所以看檔案大小。 */
  fun phoneReceiveFraction(): Float {
    val s = phoneUpdate as? PhoneUpdate.State.Receiving ?: return 1f
    val got = PhoneUpdate.file(getApplication(), s.update, fresh = false).length()
    return (got.toFloat() / s.update.sizeBytes).coerceIn(0f, 1f)
  }

  /** 接收或安裝太久沒動靜：收起畫面，回到待命（手機那邊會顯示失敗）。 */
  fun dismissPhoneUpdate() = PhoneUpdate.set(PhoneUpdate.State.None)

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
    UpdateReceiver.onInstallFailed = null
    PhoneUpdate.onChange = null
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

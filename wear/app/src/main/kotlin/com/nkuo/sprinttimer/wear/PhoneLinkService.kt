package com.nkuo.sprinttimer.wear

import android.content.Context
import android.net.Uri
import com.google.android.gms.wearable.ChannelClient
import com.google.android.gms.wearable.MessageEvent
import com.google.android.gms.wearable.Wearable
import com.google.android.gms.wearable.WearableListenerService
import com.nkuo.sprinttimer.wear.core.FailReason
import com.nkuo.sprinttimer.wear.core.IncomingUpdate
import com.nkuo.sprinttimer.wear.core.PhoneLink
import com.nkuo.sprinttimer.wear.core.UpdateState
import com.nkuo.sprinttimer.wear.core.UpdateStatus
import com.nkuo.sprinttimer.wear.core.WatchInfo
import com.nkuo.sprinttimer.wear.core.checkIncoming
import com.nkuo.sprinttimer.wear.core.encodeInfo
import com.nkuo.sprinttimer.wear.core.encodeStatus
import com.nkuo.sprinttimer.wear.core.parseUpdatePath
import java.io.File
import java.util.concurrent.TimeUnit

/**
 * 接手機 App 透過配對連線（藍牙）傳來的要求：回報手錶上裝的版本、接收新版安裝檔並安裝。
 * 系統在手機有事找手錶時才把這個服務叫起來，手錶 App 不用開著。
 *
 * 檔案是系統（Google Play 服務）直接寫進 [PhoneUpdate.file] 的，傳輸途中這個 App 不必活著；
 * 傳完系統再叫 [onInputClosed]，這時才檢查、安裝。
 */
class PhoneLinkService : WearableListenerService() {
  override fun onMessageReceived(event: MessageEvent) {
    if (event.path != PhoneLink.PATH_INFO) return
    val updater = Updater(this)
    PhoneUpdate.send(this, event.sourceNodeId, PhoneLink.PATH_INFO_REPLY, encodeInfo(WatchInfo(updater.currentBuild, updater.currentVersion)))
  }

  override fun onChannelOpened(channel: ChannelClient.Channel) {
    val incoming = parseUpdatePath(channel.path) ?: return
    val dest = PhoneUpdate.file(this, incoming, fresh = true)
    PhoneUpdate.set(PhoneUpdate.State.Receiving(incoming))
    Wearable.getChannelClient(this).receiveFile(channel, Uri.fromFile(dest), false).addOnFailureListener {
      fail(channel.nodeId, incoming, FailReason.INCOMPLETE)
    }
  }

  override fun onInputClosed(channel: ChannelClient.Channel, closeReason: Int, appSpecificErrorCode: Int) {
    val incoming = parseUpdatePath(channel.path) ?: return
    val node = channel.nodeId
    Wearable.getChannelClient(this).close(channel)
    val file = PhoneUpdate.file(this, incoming, fresh = false)
    val updater = Updater(this)
    val received = if (file.exists()) file.length() else 0L
    // 大小不對就不用再去讀檔案內容了
    val apkBuild = if (received == incoming.sizeBytes) updater.archiveBuild(file) else null
    val reason = checkIncoming(incoming, received, apkBuild, updater.currentBuild)
    if (reason != null) {
      file.delete()
      fail(node, incoming, reason)
      return
    }
    // 安裝結果是系統另外通知 UpdateReceiver 的：先記下是誰傳來的，失敗時才知道要回報給誰
    PhoneUpdate.rememberSender(this, node, incoming.build)
    PhoneUpdate.set(PhoneUpdate.State.Installing(incoming))
    PhoneUpdate.send(this, node, PhoneLink.PATH_STATUS, encodeStatus(UpdateStatus(incoming.build, UpdateState.INSTALLING)))
    try {
      updater.install(file)
    } catch (e: Exception) {
      PhoneUpdate.forgetSender(this)
      fail(node, incoming, FailReason.INSTALL_BLOCKED)
    }
  }

  private fun fail(node: String, incoming: IncomingUpdate, reason: String) {
    PhoneUpdate.set(PhoneUpdate.State.None)
    PhoneUpdate.send(this, node, PhoneLink.PATH_STATUS, encodeStatus(UpdateStatus(incoming.build, UpdateState.FAILED, reason)))
  }
}

/** 「手機傳來的更新」目前的狀態。服務和畫面在同一個行程裡，畫面從這裡看要不要顯示「接收中／安裝中」。 */
object PhoneUpdate {
  sealed interface State {
    data object None : State

    data class Receiving(val update: IncomingUpdate) : State

    data class Installing(val update: IncomingUpdate) : State
  }

  @Volatile
  var state: State = State.None
    private set

  /** 狀態改變時呼叫（可能在任何執行緒）。由畫面那邊設定。 */
  @Volatile
  var onChange: ((State) -> Unit)? = null

  fun set(s: State) {
    state = s
    onChange?.invoke(s)
  }

  /** 手機傳來的安裝檔放這裡。[fresh]：開始接收前先把舊的下載檔都清掉，不佔手錶空間。 */
  fun file(context: Context, update: IncomingUpdate, fresh: Boolean): File {
    val dir = File(context.cacheDir, "updates").apply { mkdirs() }
    if (fresh) dir.listFiles()?.forEach { it.delete() }
    return File(dir, "from-phone-${update.build}.apk")
  }

  /** 傳訊息給手機。可以在主執行緒呼叫：不等結果，送不到就算了（手機那邊等不到會自己逾時）。 */
  fun send(context: Context, node: String, path: String, json: String) {
    try {
      Wearable.getMessageClient(context).sendMessage(node, path, json.toByteArray(Charsets.UTF_8))
    } catch (e: Exception) {
    }
  }

  private fun prefs(context: Context) = context.getSharedPreferences("phone_update", Context.MODE_PRIVATE)

  fun rememberSender(context: Context, node: String, build: Int) {
    prefs(context).edit().putString("node", node).putInt("build", build).putLong("at", System.currentTimeMillis()).apply()
  }

  fun forgetSender(context: Context) {
    prefs(context).edit().clear().apply()
  }

  /**
   * 這次安裝如果是手機發起的，把結果回報給手機。手錶自己從網路更新的不會回報（沒有記下傳送者）。
   * [keep]：還沒結束（例如等人在手錶上按確認），先不要忘記傳送者。
   */
  fun reportToSender(context: Context, state: UpdateState, reason: String? = null, keep: Boolean = false) {
    val p = prefs(context)
    val node = p.getString("node", null) ?: return
    val build = p.getInt("build", 0)
    val fresh = System.currentTimeMillis() - p.getLong("at", 0L) < TimeUnit.MINUTES.toMillis(10)
    if (!keep || !fresh) forgetSender(context)
    if (fresh && build > 0) send(context, node, PhoneLink.PATH_STATUS, encodeStatus(UpdateStatus(build, state, reason)))
  }
}

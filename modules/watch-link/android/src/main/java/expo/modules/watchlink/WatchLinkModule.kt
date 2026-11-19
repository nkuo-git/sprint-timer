package expo.modules.watchlink

import android.content.Context
import android.net.Uri
import com.google.android.gms.tasks.Task
import com.google.android.gms.tasks.Tasks
import com.google.android.gms.wearable.CapabilityClient
import com.google.android.gms.wearable.MessageClient
import com.google.android.gms.wearable.Node
import com.google.android.gms.wearable.Wearable
import expo.modules.kotlin.Promise
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import java.io.File
import java.util.concurrent.CountDownLatch
import java.util.concurrent.Executors
import java.util.concurrent.TimeUnit
import java.util.concurrent.atomic.AtomicReference

/**
 * 手機 App ↔ 配對手錶上的手錶版 App（Wear OS Data Layer，走藍牙，不需要同一個 Wi-Fi）。
 * 用途：帳號頁顯示手錶裝的版本、把新版安裝檔傳到手錶安裝。
 * 手錶端在 wear/app 的 PhoneLinkService；路徑與格式定義在 wear/core 的 PhoneLink.kt，兩邊必須相同。
 * 兩個 App 要同一個套件名、同一把簽章金鑰，系統才會讓它們互通（CI 會檢查）。
 */
class WatchLinkModule : Module() {
  private val context: Context
    get() = appContext.reactContext ?: throw IllegalStateException("No context")

  // 問版本和傳檔可能同時進行（傳檔要好幾分鐘），所以不是單一執行緒
  private val pool = Executors.newCachedThreadPool()

  private var statusListener: MessageClient.OnMessageReceivedListener? = null

  override fun definition() = ModuleDefinition {
    Name("WatchLink")

    Events("onSendProgress", "onWatchStatus")

    // 手錶回報的更新狀態：有人在聽、或開始傳檔時才接
    OnStartObserving { listenForStatus() }

    OnDestroy {
      statusListener?.let {
        try {
          Wearable.getMessageClient(context).removeListener(it)
        } catch (e: Exception) {
        }
      }
      statusListener = null
    }

    /**
     * 找配對的手錶並問它裝的版本。回傳 state：
     *  no-watch：沒有連上任何手錶（或這支手機沒有 Wear OS 的配對服務）
     *  no-app：有連上手錶，但手錶上沒有（新版的）手錶 App
     *  no-reply：手錶 App 沒回應
     *  ok：json 是手錶回的 {"build":33,"version":"0.8"}
     */
    AsyncFunction("getWatchInfo") { promise: Promise ->
      pool.execute {
        try {
          promise.resolve(probe())
        } catch (e: Exception) {
          promise.resolve(mapOf("state" to "no-watch", "error" to (e.message ?: e.javaClass.simpleName)))
        }
      }
    }

    /** 把安裝檔傳到手錶。傳完（手錶開始檢查、安裝）才 resolve；途中用 onSendProgress 回報進度。 */
    AsyncFunction("sendUpdate") { fileUri: String, build: Int, version: String, promise: Promise ->
      pool.execute {
        try {
          send(fileUri, build, version)
          promise.resolve(null)
        } catch (e: Exception) {
          promise.reject("WatchSendFailed", e.message ?: e.javaClass.simpleName, e)
        }
      }
    }
  }

  @Synchronized
  private fun listenForStatus() {
    if (statusListener != null) return
    val l = MessageClient.OnMessageReceivedListener { e ->
      if (e.path == PATH_STATUS) sendEvent("onWatchStatus", mapOf("json" to String(e.data, Charsets.UTF_8)))
    }
    try {
      Wearable.getMessageClient(context).addListener(l)
      statusListener = l
    } catch (e: Exception) {
    }
  }

  private fun <T> await(task: Task<T>, seconds: Long = 8): T = Tasks.await(task, seconds, TimeUnit.SECONDS)

  /** 有裝手錶 App 的那支錶（優先選就在旁邊、直接連著的） */
  private fun watchWithApp(): Node? {
    val nodes = await(Wearable.getCapabilityClient(context).getCapability(CAPABILITY, CapabilityClient.FILTER_REACHABLE)).nodes
    return nodes.firstOrNull { it.isNearby } ?: nodes.firstOrNull()
  }

  private fun probe(): Map<String, Any?> {
    val connected = await(Wearable.getNodeClient(context).connectedNodes)
    if (connected.isEmpty()) return mapOf("state" to "no-watch")
    val node = watchWithApp() ?: return mapOf("state" to "no-app", "watchName" to connected.first().displayName)

    val latch = CountDownLatch(1)
    val reply = AtomicReference<String?>(null)
    val listener = MessageClient.OnMessageReceivedListener { e ->
      if (e.path == PATH_INFO_REPLY && e.sourceNodeId == node.id) {
        reply.set(String(e.data, Charsets.UTF_8))
        latch.countDown()
      }
    }
    val messages = Wearable.getMessageClient(context)
    await(messages.addListener(listener))
    try {
      await(messages.sendMessage(node.id, PATH_INFO, ByteArray(0)))
      latch.await(6, TimeUnit.SECONDS)
    } finally {
      messages.removeListener(listener)
    }
    val json = reply.get() ?: return mapOf("state" to "no-reply", "watchName" to node.displayName)
    return mapOf("state" to "ok", "watchName" to node.displayName, "json" to json)
  }

  private fun send(fileUri: String, build: Int, version: String) {
    val path = Uri.parse(fileUri).path ?: throw IllegalArgumentException("bad file uri")
    val file = File(path)
    val total = file.length()
    if (total <= 0) throw IllegalStateException("empty file")
    val node = watchWithApp() ?: throw IllegalStateException("no watch")
    listenForStatus()
    val channels = Wearable.getChannelClient(context)
    val channel = await(channels.openChannel(node.id, "$PATH_UPDATE/$build/$total/$version"), 20)
    try {
      await(channels.getOutputStream(channel), 20).use { out ->
        file.inputStream().use { input ->
          val buf = ByteArray(16 * 1024)
          var sent = 0L
          var lastPct = -1
          while (true) {
            val n = input.read(buf)
            if (n < 0) break
            out.write(buf, 0, n)
            sent += n
            // 每 1% 回報一次就夠了
            val pct = (sent * 100 / total).toInt()
            if (pct != lastPct) {
              lastPct = pct
              sendEvent("onSendProgress", mapOf("sent" to sent.toDouble(), "total" to total.toDouble()))
            }
          }
          out.flush()
        }
      }
      // 正常結束：只關輸出端，手錶收完會自己把通道關掉。這裡不關通道，免得還在路上的資料被丟掉。
    } catch (e: Exception) {
      try {
        channels.close(channel)
      } catch (ignored: Exception) {
      }
      throw e
    }
  }

  companion object {
    // 和 wear/core 的 PhoneLink.kt 相同
    const val CAPABILITY = "sprint_timer_watch"
    const val PATH_INFO = "/sprint-timer/info"
    const val PATH_INFO_REPLY = "/sprint-timer/info-reply"
    const val PATH_UPDATE = "/sprint-timer/update"
    const val PATH_STATUS = "/sprint-timer/update-status"
  }
}

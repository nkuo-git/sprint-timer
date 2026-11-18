package com.nkuo.sprinttimer.wear.core

import java.io.IOException
import java.net.DatagramPacket
import java.net.DatagramSocket
import java.net.InetSocketAddress
import java.net.SocketAddress
import java.util.concurrent.Executors
import java.util.concurrent.ScheduledExecutorService
import java.util.concurrent.TimeUnit
import kotlin.concurrent.thread

/**
 * 起點機的 UDP 端：時鐘 server + 和終點手機互傳訊息。對應手機 App 的 src/net/link.ts（Link）。
 *
 * - 收到 ping 立刻在接收執行緒回 pong（t1 = 收到的時刻，t2 = 送出的時刻），終點用它算兩支裝置的時鐘差。
 * - 收到終點的 hello 就記住對方位址並回 hello。
 * - [clock] 必須是和鳴槍時間同一個時基的單調時鐘（秒）。
 */
class StartServer(
  private val clock: () -> Double,
  private val port: Int = PORT,
  private val name: String = "watch",
) {
  interface Listener {
    /** 終點手機連上、換位址時呼叫 */
    fun onPeer(address: String) {}

    fun onArm(raceId: String) {}

    fun onResult(m: Msg.Result) {}
  }

  @Volatile var listener: Listener? = null

  @Volatile private var socket: DatagramSocket? = null

  @Volatile private var peer: SocketAddress? = null

  /** 最後一次收到終點任何訊息的時刻（[clock] 秒）。終點每 8 秒會同步一輪，所以可用來判斷是否還連著。 */
  @Volatile var lastHeardAt: Double = Double.NEGATIVE_INFINITY
    private set

  private var resender: ScheduledExecutorService? = null

  val hasPeer: Boolean get() = peer != null

  /** 實際綁定的 port（測試用 port 0 時由系統指定） */
  val localPort: Int get() = socket?.localPort ?: -1

  /** [maxSilenceSec] 秒內有收到終點的訊息才算連線中 */
  fun isConnected(maxSilenceSec: Double = 25.0): Boolean = peer != null && clock() - lastHeardAt <= maxSilenceSec

  /**
   * 開始收送。[configure] 在綁定 port 之後呼叫，Android 上用來把 socket 綁到 Wi-Fi 網路
   * （手錶的預設網路常是藍牙代理，不綁的話封包送不到區網）。
   */
  @Synchronized
  fun start(configure: (DatagramSocket) -> Unit = {}) {
    stop()
    val s = DatagramSocket(null)
    try {
      s.reuseAddress = true
      s.bind(InetSocketAddress(port))
      configure(s)
    } catch (e: Exception) {
      s.close()
      throw e
    }
    socket = s
    resender = Executors.newSingleThreadScheduledExecutor { r -> Thread(r, "start-udp-send").apply { isDaemon = true } }
    thread(name = "start-udp-recv", isDaemon = true, priority = Thread.MAX_PRIORITY) { receiveLoop(s) }
  }

  @Synchronized
  fun stop() {
    resender?.shutdownNow()
    resender = null
    socket?.close()
    socket = null
  }

  /** 忘掉終點（例如 Wi-Fi 換了網路） */
  fun forgetPeer() {
    peer = null
    lastHeardAt = Double.NEGATIVE_INFINITY
  }

  private fun receiveLoop(s: DatagramSocket) {
    val buf = ByteArray(2048)
    val packet = DatagramPacket(buf, buf.size)
    while (!s.isClosed) {
      try {
        packet.setData(buf, 0, buf.size)
        s.receive(packet)
      } catch (e: IOException) {
        if (s.isClosed) return
        continue
      }
      val tRecv = clock()
      val m = decode(String(packet.data, packet.offset, packet.length, Charsets.UTF_8)) ?: continue
      val from = packet.socketAddress
      if (m is Msg.Ping) {
        // 時鐘 server：越快回越好，所以不離開這個執行緒
        sendTo(s, Msg.Pong(m.id, m.t0, tRecv, clock()), from)
        lastHeardAt = tRecv
        // App 重開後終點還在同步：直接沿用它
        if (peer == null) adoptPeer(from)
        continue
      }
      // 只聽終點的；自己人（另一支起點機）或舊的訊息不理
      when (m) {
        is Msg.Hello -> {
          if (m.role != "finish") continue
          lastHeardAt = tRecv
          adoptPeer(from)
          sendTo(s, Msg.Hello("start", name), from)
        }
        is Msg.Arm -> {
          lastHeardAt = tRecv
          listener?.onArm(m.raceId)
        }
        is Msg.Result -> {
          lastHeardAt = tRecv
          listener?.onResult(m)
        }
        else -> {}
      }
    }
  }

  private fun adoptPeer(from: SocketAddress) {
    if (peer == from) return
    peer = from
    listener?.onPeer((from as? InetSocketAddress)?.address?.hostAddress ?: from.toString())
  }

  private fun sendTo(s: DatagramSocket, m: Msg, to: SocketAddress) {
    val bytes = encode(m).toByteArray(Charsets.UTF_8)
    try {
      s.send(DatagramPacket(bytes, bytes.size, to))
    } catch (e: IOException) {
      // 斷線時送不出去是正常的；重要訊息會重送
    } catch (e: RuntimeException) {
      // socket 已關或位址不合法
    }
  }

  /** 送一次給終點。還沒連線就不送（回傳 false）。 */
  fun send(m: Msg): Boolean {
    val s = socket ?: return false
    val to = peer ?: return false
    sendTo(s, m, to)
    return true
  }

  /**
   * UDP 可能掉封包：重要訊息重送 [times] 次（終點用 raceId 去重）。
   * 全部在背景執行緒送，所以可以從主執行緒呼叫（Android 不准在主執行緒做網路存取）。
   */
  fun sendReliable(m: Msg, times: Int = 4, gapMs: Long = 40) {
    val ex = resender ?: return
    for (i in 0 until times) {
      try {
        ex.schedule({ send(m) }, i * gapMs, TimeUnit.MILLISECONDS)
      } catch (e: RuntimeException) {
        return // 已停止
      }
    }
  }
}

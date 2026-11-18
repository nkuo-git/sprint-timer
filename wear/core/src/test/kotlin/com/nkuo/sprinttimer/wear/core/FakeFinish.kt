package com.nkuo.sprinttimer.wear.core

import java.net.DatagramPacket
import java.net.DatagramSocket
import java.net.InetAddress
import java.net.SocketTimeoutException
import java.util.concurrent.CopyOnWriteArrayList
import kotlin.concurrent.thread

/** 測試用的「終點手機」：一個 UDP socket，記下收到的每則訊息 */
class FakeFinish(private val serverPort: Int) : AutoCloseable {
  val socket = DatagramSocket(0, InetAddress.getLoopbackAddress()).apply { soTimeout = 100 }
  val received = CopyOnWriteArrayList<Pair<Msg, Long>>() // 訊息、收到的 System.nanoTime()
  @Volatile private var open = true
  @Volatile var paused = false // 模擬斷線：收到也丟掉

  private val reader = thread(isDaemon = true) {
    val buf = ByteArray(2048)
    while (open) {
      val p = DatagramPacket(buf, buf.size)
      try {
        socket.receive(p)
      } catch (e: SocketTimeoutException) {
        continue
      } catch (e: Exception) {
        break
      }
      val t = System.nanoTime()
      if (paused) continue
      decode(String(p.data, 0, p.length, Charsets.UTF_8))?.let { received.add(it to t) }
    }
  }

  fun sendRaw(s: String) {
    val b = s.toByteArray()
    socket.send(DatagramPacket(b, b.size, InetAddress.getLoopbackAddress(), serverPort))
  }

  fun send(m: Msg) = sendRaw(encode(m))

  fun hello() = send(Msg.Hello("finish", "finish"))

  inline fun <reified T : Msg> all(): List<T> = received.map { it.first }.filterIsInstance<T>()

  fun <T> await(timeoutMs: Long = 3000, what: String = "condition", f: () -> T?): T {
    val end = System.currentTimeMillis() + timeoutMs
    while (System.currentTimeMillis() < end) {
      f()?.let { return it }
      Thread.sleep(5)
    }
    throw AssertionError("timed out waiting for $what; received=${received.map { it.first }}")
  }

  override fun close() {
    open = false
    socket.close()
  }
}

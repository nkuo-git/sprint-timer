package expo.modules.precisionclock.shared

import android.content.Context
import android.media.AudioAttributes
import android.media.AudioDeviceInfo
import android.media.AudioFormat
import android.media.AudioManager
import android.media.AudioTimestamp
import android.media.AudioTrack
import android.os.SystemClock
import kotlin.math.exp
import kotlin.math.roundToInt

/**
 * 鳴槍，並量出槍聲實際從喇叭發出的時刻。手機 App（PrecisionClockModule）和手錶 App（wear/）共用這個檔案，
 * 所以這裡不能用到 Expo 或 React Native 的東西。
 *
 * 時基：SystemClock.elapsedRealtimeNanos（CLOCK_BOOTTIME），秒。
 *
 * Android 沒有「在指定時間播放」的 API，所以做法是：
 *  1. 在目標時間前 LEAD 秒呼叫 play()，緩衝區前面放 LEAD 秒的靜音
 *  2. 用 AudioTrack.getTimestamp() 讀回「第 N 個樣本實際在 DAC 輸出的時間」，
 *     反推槍聲第一個樣本真正發出的時間 —— 這是量測值，不是估計值。
 */
class GunPlayer(private val context: Context) {
  data class Shot(
    /** 槍聲第一個樣本從喇叭發出的時刻 */
    val emittedAt: Double,
    /** android-timestamp = 量測值；android-estimated = 讀不到時間戳，用估的（誤差可能到數十 ms） */
    val method: String,
  )

  var sampleRate = 48000
    private set

  private val leadSec = 0.25

  /** 讀取裝置的輸出取樣率。第一次鳴槍前呼叫一次。 */
  fun prepare(): Int {
    val am = context.getSystemService(Context.AUDIO_SERVICE) as AudioManager
    sampleRate = am.getProperty(AudioManager.PROPERTY_OUTPUT_SAMPLE_RATE)?.toIntOrNull() ?: 48000
    return sampleRate
  }

  /** 裝置本身有沒有喇叭（有些手錶沒有） */
  fun hasBuiltInSpeaker(): Boolean = builtInSpeaker() != null

  private fun builtInSpeaker(): AudioDeviceInfo? {
    val am = context.getSystemService(Context.AUDIO_SERVICE) as AudioManager
    return am.getDevices(AudioManager.GET_DEVICES_OUTPUTS).firstOrNull { it.type == AudioDeviceInfo.TYPE_BUILTIN_SPEAKER }
  }

  /** CLOCK_BOOTTIME − CLOCK_MONOTONIC（秒），取五次中來回最短的那次 */
  private fun bootMinusMono(): Double {
    var best = Long.MAX_VALUE
    var diff = 0L
    repeat(5) {
      val a = System.nanoTime()
      val b = SystemClock.elapsedRealtimeNanos()
      val c = System.nanoTime()
      if (c - a < best) {
        best = c - a
        diff = b - (a + c) / 2
      }
    }
    return diff / 1e9
  }

  private fun buildPcm(): ShortArray {
    val lead = (sampleRate * leadSec).roundToInt()
    val gun = (sampleRate * 0.35).roundToInt()
    val pcm = ShortArray(lead + gun)
    var seed = 12345L
    for (i in 0 until gun) {
      seed = (seed * 1103515245L + 12345L) and 0x7fffffffL
      val noise = (seed.toDouble() / 0x7fffffff) * 2 - 1
      val env = exp(-(i.toDouble() / sampleRate) / 0.06)
      pcm[lead + i] = (noise * env * 32000).toInt().toShort()
    }
    return pcm
  }

  /**
   * 在時刻 [at] 鳴槍。會佔住呼叫的執行緒。
   *
   * @param builtInSpeakerOnly 強制從裝置本身的喇叭出聲。藍牙耳機／喇叭有不固定的延遲，量到的時間不可信。
   * @param waitUntilEmitted false：一推算出發聲時刻就回傳（通常比槍聲早 0.1 秒左右）；true：等槍聲真的響了才回傳。
   * @param cancelled 槍聲響之前變成 true 就不鳴槍，回傳 null。執行緒被 interrupt 也視為取消。
   */
  fun playAt(
    at: Double,
    builtInSpeakerOnly: Boolean = false,
    waitUntilEmitted: Boolean = false,
    cancelled: () -> Boolean = { false },
  ): Shot? {
    val pcm = buildPcm()
    val lead = (sampleRate * leadSec).roundToInt()
    val track = AudioTrack.Builder()
      .setAudioAttributes(
        AudioAttributes.Builder()
          .setUsage(AudioAttributes.USAGE_MEDIA)
          .setContentType(AudioAttributes.CONTENT_TYPE_SONIFICATION)
          .build()
      )
      .setAudioFormat(
        AudioFormat.Builder()
          .setEncoding(AudioFormat.ENCODING_PCM_16BIT)
          .setSampleRate(sampleRate)
          .setChannelMask(AudioFormat.CHANNEL_OUT_MONO)
          .build()
      )
      .setTransferMode(AudioTrack.MODE_STATIC)
      .setPerformanceMode(AudioTrack.PERFORMANCE_MODE_LOW_LATENCY)
      .setBufferSizeInBytes(pcm.size * 2)
      .build()
    var handedOff = false
    try {
      track.write(pcm, 0, pcm.size)
      if (builtInSpeakerOnly) builtInSpeaker()?.let { track.setPreferredDevice(it) }

      // 睡到目標前 leadSec，最後 3ms 忙等
      val startAt = at - leadSec
      while (true) {
        if (cancelled()) return null
        val remain = startAt - nowSec()
        if (remain <= 0) break
        // 每次最多睡 50ms，才來得及發現被取消
        if (remain > 0.003) Thread.sleep(((remain - 0.002) * 1000).toLong().coerceIn(1, 50)) else Thread.yield()
      }
      track.play()

      // 讀回 DAC 時間戳
      val ts = AudioTimestamp()
      var emitted = Double.NaN
      var method = "android-estimated"
      val deadline = nowSec() + 1.0
      while (nowSec() < deadline) {
        if (cancelled() && nowSec() < startAt + leadSec - 0.02) {
          track.pause()
          return null
        }
        if (track.getTimestamp(ts) && ts.framePosition > 0) {
          val off = bootMinusMono()
          val frameTime = ts.nanoTime / 1e9 + off
          // 槍聲第一個樣本 = 第 lead 個 frame
          emitted = frameTime + (lead - ts.framePosition).toDouble() / sampleRate
          method = "android-timestamp"
          // 越接近槍聲的時間戳越準，拿到過了 lead 一半以上的就停
          if (ts.framePosition > lead / 2) break
        }
        Thread.sleep(5)
      }
      if (emitted.isNaN()) {
        // 讀不到時間戳（少數裝置）：用呼叫 play 的時間 + 靜音長度估計，誤差可能到數十 ms
        emitted = startAt + leadSec
      }
      if (waitUntilEmitted) {
        while (true) {
          val remain = emitted - nowSec()
          if (remain <= 0) break
          if (cancelled() && remain > 0.02) {
            track.pause()
            return null
          }
          Thread.sleep((remain * 1000).toLong().coerceIn(1, 10))
        }
      }
      handedOff = true
      Thread {
        try {
          Thread.sleep(800)
          track.stop()
        } catch (e: Exception) {
          // 已經停了
        } finally {
          track.release()
        }
      }.start()
      return Shot(emitted, method)
    } catch (e: InterruptedException) {
      // 被取消：槍聲還沒響的話讓它不要響
      try {
        track.pause()
      } catch (ignored: IllegalStateException) {
      }
      return null
    } finally {
      if (!handedOff) track.release()
    }
  }

  companion object {
    /** 現在時刻（秒），和相機影格時間、鳴槍時間同一個時基 */
    fun nowSec(): Double = SystemClock.elapsedRealtimeNanos() / 1e9
  }
}

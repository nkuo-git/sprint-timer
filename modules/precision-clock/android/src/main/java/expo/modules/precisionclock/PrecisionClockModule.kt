package expo.modules.precisionclock

import android.content.Context
import android.hardware.camera2.CameraCharacteristics
import android.hardware.camera2.CameraManager
import android.media.AudioAttributes
import android.media.AudioFormat
import android.media.AudioManager
import android.media.AudioTimestamp
import android.media.AudioTrack
import android.os.SystemClock
import expo.modules.kotlin.Promise
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import kotlin.math.exp
import kotlin.math.roundToInt

/**
 * 精準時鐘 + 鳴槍（Android）
 * 時基：SystemClock.elapsedRealtimeNanos（CLOCK_BOOTTIME），
 * 與相機 SENSOR_INFO_TIMESTAMP_SOURCE_REALTIME 的影格時間相同。
 *
 * Android 沒有「在指定時間播放」的 API，所以做法是：
 *  1. 在目標時間前 LEAD 秒呼叫 play()，緩衝區前面放 LEAD 秒的靜音
 *  2. 用 AudioTrack.getTimestamp() 讀回「第 N 個樣本實際在 DAC 輸出的時間」，
 *     反推槍聲第一個樣本真正發出的時間 —— 這是量測值，不是估計值。
 */
class PrecisionClockModule : Module() {
  private var sampleRate = 48000
  private val leadSec = 0.25

  private val context: Context
    get() = appContext.reactContext ?: throw IllegalStateException("No context")

  private fun nowSec(): Double = SystemClock.elapsedRealtimeNanos() / 1e9

  /** CLOCK_BOOTTIME − CLOCK_MONOTONIC（秒），取三次中來回最短的那次 */
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

  override fun definition() = ModuleDefinition {
    Name("PrecisionClock")

    Function("now") { nowSec() }

    Function("cameraTimestampSource") {
      try {
        val cm = context.getSystemService(Context.CAMERA_SERVICE) as CameraManager
        val back = cm.cameraIdList.firstOrNull { id ->
          cm.getCameraCharacteristics(id).get(CameraCharacteristics.LENS_FACING) == CameraCharacteristics.LENS_FACING_BACK
        } ?: return@Function "no-back-camera"
        when (cm.getCameraCharacteristics(back).get(CameraCharacteristics.SENSOR_INFO_TIMESTAMP_SOURCE)) {
          CameraCharacteristics.SENSOR_INFO_TIMESTAMP_SOURCE_REALTIME -> "realtime"
          else -> "unknown"
        }
      } catch (e: Exception) {
        "error: ${e.message}"
      }
    }

    AsyncFunction("prepareAudio") {
      val am = context.getSystemService(Context.AUDIO_SERVICE) as AudioManager
      sampleRate = am.getProperty(AudioManager.PROPERTY_OUTPUT_SAMPLE_RATE)?.toIntOrNull() ?: 48000
      mapOf("sampleRate" to sampleRate.toDouble(), "outputLatency" to 0.0)
    }

    AsyncFunction("playGunAt") { at: Double, promise: Promise ->
      Thread {
        try {
          promise.resolve(playGun(at))
        } catch (e: Exception) {
          promise.reject("GunFailed", e.message ?: "unknown", e)
        }
      }.apply { priority = Thread.MAX_PRIORITY }.start()
    }
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

  private fun playGun(at: Double): Map<String, Any> {
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
    track.write(pcm, 0, pcm.size)

    // 睡到目標前 leadSec，最後 3ms 忙等
    val startAt = at - leadSec
    while (true) {
      val remain = startAt - nowSec()
      if (remain <= 0) break
      if (remain > 0.003) Thread.sleep(((remain - 0.002) * 1000).toLong().coerceAtLeast(1)) else Thread.yield()
    }
    track.play()

    // 讀回 DAC 時間戳
    val ts = AudioTimestamp()
    var emitted = Double.NaN
    var method = "android-estimated"
    val deadline = nowSec() + 1.0
    while (nowSec() < deadline) {
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
    Thread {
      Thread.sleep(800)
      track.stop()
      track.release()
    }.start()
    return mapOf("emittedAt" to emitted, "outputLatency" to 0.0, "method" to method)
  }
}

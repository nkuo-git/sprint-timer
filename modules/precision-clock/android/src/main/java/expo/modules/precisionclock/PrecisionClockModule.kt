package expo.modules.precisionclock

import android.content.Context
import android.hardware.camera2.CameraCharacteristics
import android.hardware.camera2.CameraManager
import expo.modules.kotlin.Promise
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import expo.modules.precisionclock.shared.GunPlayer

/**
 * 精準時鐘 + 鳴槍（Android）
 * 時基：SystemClock.elapsedRealtimeNanos（CLOCK_BOOTTIME），
 * 與相機 SENSOR_INFO_TIMESTAMP_SOURCE_REALTIME 的影格時間相同。
 *
 * 鳴槍與發聲時刻的量測在 shared/GunPlayer.kt（手錶 App 也用同一份）。
 */
class PrecisionClockModule : Module() {
  private val context: Context
    get() = appContext.reactContext ?: throw IllegalStateException("No context")

  private val gun by lazy { GunPlayer(context) }

  override fun definition() = ModuleDefinition {
    Name("PrecisionClock")

    Function("now") { GunPlayer.nowSec() }

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
      mapOf("sampleRate" to gun.prepare().toDouble(), "outputLatency" to 0.0)
    }

    AsyncFunction("playGunAt") { at: Double, promise: Promise ->
      Thread {
        try {
          val shot = gun.playAt(at) ?: throw IllegalStateException("cancelled")
          promise.resolve(mapOf("emittedAt" to shot.emittedAt, "outputLatency" to 0.0, "method" to shot.method))
        } catch (e: Exception) {
          promise.reject("GunFailed", e.message ?: "unknown", e)
        }
      }.apply { priority = Thread.MAX_PRIORITY }.start()
    }
  }
}

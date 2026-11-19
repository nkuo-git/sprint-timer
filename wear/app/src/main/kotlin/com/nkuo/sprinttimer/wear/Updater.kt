package com.nkuo.sprinttimer.wear

import android.app.PendingIntent
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.pm.PackageInstaller
import android.os.Build
import com.nkuo.sprinttimer.wear.core.FailReason
import com.nkuo.sprinttimer.wear.core.ReleaseInfo
import com.nkuo.sprinttimer.wear.core.UpdateState
import com.nkuo.sprinttimer.wear.core.isNewer
import com.nkuo.sprinttimer.wear.core.pickRelease
import java.io.File
import java.io.IOException
import java.net.HttpURLConnection
import java.net.URL

/**
 * App 內更新（和手機 App 的 src/update/ 同一套規則）：查 GitHub 最新 Release，有比較新的 build 就下載
 * sprint-timer-wear.apk，交給系統安裝。
 *
 * 安裝：Android 12 以上，App 更新「自己」而且宣告了 UPDATE_PACKAGES_WITHOUT_USER_ACTION 時，系統可以不跳確認直接裝；
 * 其他情況系統會要求確認（[UpdateReceiver] 會把確認畫面叫出來）。有些手錶沒有確認畫面，那就只能用手機的安裝工具。
 * 這裡的函式都會連網路或讀寫檔案，不能在主執行緒呼叫。
 */
class Updater(private val context: Context) {
  val currentBuild: Int
  val currentVersion: String

  init {
    val info = context.packageManager.getPackageInfo(context.packageName, 0)
    currentBuild = info.longVersionCode.toInt()
    currentVersion = info.versionName ?: ""
  }

  /** 有比目前新的版本就回傳，否則 null。連不上網路會丟 IOException。 */
  fun check(): ReleaseInfo? {
    val conn = URL("https://api.github.com/repos/$REPO/releases/latest").openConnection() as HttpURLConnection
    try {
      conn.connectTimeout = 10_000
      conn.readTimeout = 15_000
      conn.setRequestProperty("Accept", "application/vnd.github+json")
      if (conn.responseCode != 200) throw IOException("HTTP ${conn.responseCode}")
      val rel = pickRelease(conn.inputStream.bufferedReader().use { it.readText() })
      return if (isNewer(rel, currentBuild)) rel else null
    } finally {
      conn.disconnect()
    }
  }

  /** 下載安裝檔到快取資料夾。[onProgress] 回報 0–1。 */
  fun download(rel: ReleaseInfo, onProgress: (Float) -> Unit): File {
    val dir = File(context.cacheDir, "updates").apply { mkdirs() }
    // 舊的下載檔都清掉，不佔手錶空間
    dir.listFiles()?.forEach { it.delete() }
    val dest = File(dir, "sprint-timer-wear-${rel.build}.apk")
    val conn = URL(rel.apkUrl).openConnection() as HttpURLConnection
    try {
      conn.connectTimeout = 10_000
      conn.readTimeout = 30_000
      if (conn.responseCode != 200) throw IOException("HTTP ${conn.responseCode}")
      val total = if (conn.contentLengthLong > 0) conn.contentLengthLong else rel.sizeBytes
      conn.inputStream.use { input ->
        dest.outputStream().use { out ->
          val buf = ByteArray(64 * 1024)
          var done = 0L
          while (true) {
            val n = input.read(buf)
            if (n < 0) break
            out.write(buf, 0, n)
            done += n
            if (total > 0) onProgress((done.toFloat() / total).coerceIn(0f, 1f))
          }
        }
      }
      if (dest.length() == 0L) throw IOException("empty download")
      return dest
    } catch (e: Exception) {
      dest.delete()
      throw e
    } finally {
      conn.disconnect()
    }
  }

  /** 讀安裝檔本身的 versionCode。讀不出來、或不是這個 App 的安裝檔回傳 null。（簽章由系統在安裝時檢查。） */
  fun archiveBuild(apk: File): Int? =
    try {
      val info = context.packageManager.getPackageArchiveInfo(apk.path, 0)
      if (info != null && info.packageName == context.packageName) info.longVersionCode.toInt() else null
    } catch (e: Exception) {
      null
    }

  /** 把下載好的安裝檔交給系統安裝。結果（失敗或需要確認）由 [UpdateReceiver] 收。成功的話 App 會被系統關掉。 */
  fun install(apk: File) {
    val installer = context.packageManager.packageInstaller
    val params = PackageInstaller.SessionParams(PackageInstaller.SessionParams.MODE_FULL_INSTALL)
    params.setAppPackageName(context.packageName)
    params.setSize(apk.length())
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
      params.setRequireUserAction(PackageInstaller.SessionParams.USER_ACTION_NOT_REQUIRED)
    }
    val id = installer.createSession(params)
    val session = installer.openSession(id)
    try {
      session.openWrite("base.apk", 0, apk.length()).use { out ->
        apk.inputStream().use { it.copyTo(out) }
        session.fsync(out)
      }
      val intent = Intent(context, UpdateReceiver::class.java).setAction(UpdateReceiver.ACTION)
      // 系統要把結果填進這個 Intent，所以必須是 mutable
      val flags = PendingIntent.FLAG_UPDATE_CURRENT or (if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) PendingIntent.FLAG_MUTABLE else 0)
      session.commit(PendingIntent.getBroadcast(context, id, intent, flags).intentSender)
    } catch (e: Exception) {
      session.abandon()
      throw e
    } finally {
      session.close()
    }
  }

  companion object {
    const val REPO = "nkuo-git/sprint-timer"
  }
}

/** 收系統回報的安裝結果。手錶自己下載的更新、手機傳來的更新（[PhoneLinkService]）都走這裡。 */
class UpdateReceiver : BroadcastReceiver() {
  override fun onReceive(context: Context, intent: Intent) {
    when (intent.getIntExtra(PackageInstaller.EXTRA_STATUS, PackageInstaller.STATUS_FAILURE)) {
      PackageInstaller.STATUS_SUCCESS -> PhoneUpdate.forgetSender(context)
      PackageInstaller.STATUS_PENDING_USER_ACTION -> {
        // 系統要使用者確認：把確認畫面叫出來。手錶上沒有這個畫面的話就當作不能安裝。
        @Suppress("DEPRECATION")
        val confirm = intent.getParcelableExtra<Intent>(Intent.EXTRA_INTENT)
        try {
          context.startActivity(confirm!!.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK))
          PhoneUpdate.reportToSender(context, UpdateState.NEEDS_CONFIRM, keep = true)
        } catch (e: Exception) {
          failed(context)
        }
      }
      else -> failed(context)
    }
  }

  private fun failed(context: Context) {
    onInstallFailed?.invoke()
    PhoneUpdate.set(PhoneUpdate.State.None)
    PhoneUpdate.reportToSender(context, UpdateState.FAILED, FailReason.INSTALL_BLOCKED)
  }

  companion object {
    const val ACTION = "com.nkuo.sprinttimer.wear.INSTALL_STATUS"

    /** 安裝失敗（或使用者按了取消）時呼叫。由畫面那邊設定。 */
    @Volatile var onInstallFailed: (() -> Unit)? = null
  }
}

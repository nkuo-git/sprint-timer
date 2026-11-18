package com.nkuo.sprinttimer.wear

import android.content.Context
import com.nkuo.sprinttimer.wear.core.Gun
import com.nkuo.sprinttimer.wear.core.GunShot
import expo.modules.precisionclock.shared.GunPlayer

/** 手錶的槍：用和手機同一份 GunPlayer，強制從手錶本身的喇叭出聲，等槍聲真的響了才回報。 */
class WatchGun(context: Context) : Gun {
  private val player = GunPlayer(context.applicationContext)

  val hasSpeaker: Boolean get() = player.hasBuiltInSpeaker()

  fun prepare() {
    player.prepare()
  }

  override fun playAt(at: Double, cancelled: () -> Boolean): GunShot? {
    val shot = player.playAt(at, builtInSpeakerOnly = true, waitUntilEmitted = true, cancelled = cancelled) ?: return null
    return GunShot(shot.emittedAt, shot.method)
  }
}

package com.nkuo.sprinttimer.wear

import android.content.Context
import android.media.AudioManager
import android.media.ToneGenerator
import android.os.Bundle
import android.speech.tts.TextToSpeech
import com.nkuo.sprinttimer.wear.core.Announcer
import com.nkuo.sprinttimer.wear.core.Command
import java.util.Locale

enum class CommandLang { ZH, EN }

/**
 * 喊「各就位／預備」。用手錶系統的語音合成；手錶沒有那個語言的語音時改用提示音
 * （各就位 = 一長聲，預備 = 兩短聲），確保一定有聲音。口令的時間不需精準，只有槍聲需要。
 */
class Speech(context: Context) : Announcer {
  @Volatile var lang: CommandLang = CommandLang.ZH

  @Volatile private var ready = false
  private val tts: TextToSpeech = TextToSpeech(context.applicationContext) { status -> ready = status == TextToSpeech.SUCCESS }

  private fun locale(): Locale? {
    val wanted = when (lang) {
      CommandLang.ZH -> listOf(Locale.TAIWAN, Locale.CHINA, Locale.CHINESE)
      CommandLang.EN -> listOf(Locale.US, Locale.UK, Locale.ENGLISH)
    }
    return wanted.firstOrNull {
      try {
        tts.isLanguageAvailable(it) >= TextToSpeech.LANG_AVAILABLE
      } catch (e: Exception) {
        false
      }
    }
  }

  override fun say(cmd: Command) {
    val loc = if (ready) locale() else null
    if (loc == null) {
      beep(cmd)
      return
    }
    val text = when (lang) {
      CommandLang.ZH -> if (cmd == Command.MARKS) "各就位" else "預備"
      CommandLang.EN -> if (cmd == Command.MARKS) "On your marks" else "Set"
    }
    try {
      tts.language = loc
      tts.setSpeechRate(0.9f)
      val params = Bundle().apply {
        putInt(TextToSpeech.Engine.KEY_PARAM_STREAM, AudioManager.STREAM_MUSIC)
        putFloat(TextToSpeech.Engine.KEY_PARAM_VOLUME, 1f)
      }
      if (tts.speak(text, TextToSpeech.QUEUE_FLUSH, params, cmd.name) != TextToSpeech.SUCCESS) beep(cmd)
    } catch (e: Exception) {
      beep(cmd)
    }
  }

  private fun beep(cmd: Command) {
    Thread {
      try {
        val tone = ToneGenerator(AudioManager.STREAM_MUSIC, ToneGenerator.MAX_VOLUME)
        try {
          if (cmd == Command.MARKS) {
            tone.startTone(ToneGenerator.TONE_DTMF_A, 700)
            Thread.sleep(800)
          } else {
            tone.startTone(ToneGenerator.TONE_DTMF_D, 180)
            Thread.sleep(300)
            tone.startTone(ToneGenerator.TONE_DTMF_D, 180)
            Thread.sleep(280)
          }
        } finally {
          tone.release()
        }
      } catch (e: Exception) {
        // 連提示音都放不出來就算了，槍聲走另一條路
      }
    }.start()
  }

  /** 取消這一趟時把還沒講完的口令停掉 */
  fun stop() {
    try {
      tts.stop()
    } catch (e: Exception) {
    }
  }

  fun close() {
    try {
      tts.shutdown()
    } catch (e: Exception) {
    }
  }
}

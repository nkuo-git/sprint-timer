package com.nkuo.sprinttimer.wear.core

import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertNull
import kotlin.test.assertTrue

class UpdateTest {
  private fun release(tag: String = "build-14", name: String = "v0.7", assets: String = both) =
    """{"tag_name":"$tag","name":"$name","body":"自動建置","assets":[$assets]}"""

  private val phone = """{"name":"sprint-timer.apk","size":61000000,"browser_download_url":"https://github.com/nkuo-git/sprint-timer/releases/download/build-14/sprint-timer.apk"}"""
  private val watch = """{"name":"sprint-timer-wear.apk","size":8123456,"browser_download_url":"https://github.com/nkuo-git/sprint-timer/releases/download/build-14/sprint-timer-wear.apk"}"""
  private val both = "$phone,$watch"

  @Test
  fun picksTheWatchApkNotThePhoneOne() {
    val r = pickRelease(release())!!
    assertEquals(14, r.build)
    assertEquals("0.7", r.version)
    assertEquals("build-14", r.tag)
    assertTrue(r.apkUrl.endsWith("/sprint-timer-wear.apk"))
    assertEquals(8123456L, r.sizeBytes)
    assertEquals("8.1 MB", formatSize(r.sizeBytes))
  }

  @Test
  fun olderReleasesWithoutAWatchApkAreIgnored() {
    // v0.5 以前的 Release 只有手機安裝檔
    assertNull(pickRelease(release(assets = phone)))
    assertNull(pickRelease(release(assets = "")))
  }

  @Test
  fun rejectsUnexpectedShapes() {
    assertNull(pickRelease("not json"))
    assertNull(pickRelease("[]"))
    assertNull(pickRelease(release(tag = "v0.7")))
    assertNull(pickRelease("""{"message":"API rate limit exceeded"}"""))
    // 下載網址一定要是 https
    assertNull(pickRelease(release(assets = """{"name":"sprint-timer-wear.apk","size":1,"browser_download_url":"http://example.com/x.apk"}""")))
  }

  @Test
  fun versionFallsBackToTag() {
    assertEquals("build-14", pickRelease(release(name = "Nightly"))!!.version)
  }

  @Test
  fun newerOnlyWhenBuildNumberIsHigher() {
    val r = pickRelease(release())
    assertTrue(isNewer(r, 13))
    assertFalse(isNewer(r, 14))
    assertFalse(isNewer(r, 15))
    assertFalse(isNewer(null, 1))
    assertEquals(7, parseBuildTag("build-7"))
    assertNull(parseBuildTag("build-7a"))
    assertNull(parseBuildTag(null))
  }
}

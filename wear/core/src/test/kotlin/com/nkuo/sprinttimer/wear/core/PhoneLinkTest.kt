package com.nkuo.sprinttimer.wear.core

import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertNull

class PhoneLinkTest {
  @Test
  fun infoRoundTrips() {
    val json = encodeInfo(WatchInfo(33, "0.8"))
    assertEquals("""{"build":33,"version":"0.8"}""", json)
    assertEquals(WatchInfo(33, "0.8"), decodeInfo(json))
    assertNull(decodeInfo("nope"))
    assertNull(decodeInfo("""{"version":"0.8"}"""))
    assertNull(decodeInfo("""{"build":"33","version":"0.8"}"""))
  }

  @Test
  fun updatePathCarriesBuildSizeAndVersion() {
    val u = IncomingUpdate(34, 17_120_670L, "0.9")
    assertEquals("/sprint-timer/update/34/17120670/0.9", updatePath(u))
    assertEquals(u, parseUpdatePath(updatePath(u)))
  }

  @Test
  fun otherChannelsAreIgnored() {
    assertNull(parseUpdatePath(null))
    assertNull(parseUpdatePath("/sprint-timer/info"))
    assertNull(parseUpdatePath("/sprint-timer/update"))
    assertNull(parseUpdatePath("/sprint-timer/update/34/0/0.9"))
    assertNull(parseUpdatePath("/sprint-timer/update/0/100/0.9"))
    assertNull(parseUpdatePath("/sprint-timer/update/34/100/../x"))
    assertNull(parseUpdatePath("/other/update/34/100/0.9"))
  }

  @Test
  fun statusRoundTrips() {
    val failed = UpdateStatus(34, UpdateState.FAILED, FailReason.INCOMPLETE)
    assertEquals("""{"build":34,"state":"failed","reason":"incomplete"}""", encodeStatus(failed))
    assertEquals(failed, decodeStatus(encodeStatus(failed)))
    val installing = UpdateStatus(34, UpdateState.INSTALLING)
    assertEquals("""{"build":34,"state":"installing"}""", encodeStatus(installing))
    assertEquals(installing, decodeStatus(encodeStatus(installing)))
    assertNull(decodeStatus("""{"build":34,"state":"dancing"}"""))
  }

  @Test
  fun onlyACompleteNewerFileOfThisAppIsInstalled() {
    val u = IncomingUpdate(34, 1000L, "0.9")
    assertNull(checkIncoming(u, receivedBytes = 1000L, apkBuild = 34, currentBuild = 33))
    // 傳到一半斷線
    assertEquals(FailReason.INCOMPLETE, checkIncoming(u, receivedBytes = 640L, apkBuild = null, currentBuild = 33))
    // 檔案讀不出版本，或和手機說的不是同一版
    assertEquals(FailReason.BAD_FILE, checkIncoming(u, receivedBytes = 1000L, apkBuild = null, currentBuild = 33))
    assertEquals(FailReason.BAD_FILE, checkIncoming(u, receivedBytes = 1000L, apkBuild = 35, currentBuild = 33))
    // 手錶已經是這一版或更新
    assertEquals(FailReason.NOT_NEWER, checkIncoming(u, receivedBytes = 1000L, apkBuild = 34, currentBuild = 34))
  }
}

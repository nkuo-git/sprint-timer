package com.nkuo.sprinttimer.wear.core

import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertNull
import kotlin.test.assertTrue

class NavTest {
  @Test
  fun opensOnHomeAndSwipingExits() {
    val n = navigate(NavInput())
    assertEquals(WatchScreen.HOME, n.screen)
    assertNull(n.behind)
    assertTrue(n.canSwipe)
    assertEquals(BackAction.EXIT, n.back)
  }

  @Test
  fun homeStaysEvenWhenTheFinishPhoneIsAlreadyConnected() {
    assertEquals(WatchScreen.HOME, navigate(NavInput(connected = true)).screen)
    assertEquals(WatchScreen.HOME, navigate(NavInput(hasWifi = false)).screen)
    // 沒有喇叭也要能進首頁看設定和版本
    assertEquals(WatchScreen.HOME, navigate(NavInput(hasSpeaker = false)).screen)
  }

  @Test
  fun startDeviceGoesToConnectThenReady() {
    val waiting = navigate(NavInput(inStart = true))
    assertEquals(WatchScreen.CONNECT, waiting.screen)
    assertEquals(WatchScreen.HOME, waiting.behind)
    assertEquals(BackAction.LEAVE_START, waiting.back)

    val noWifi = navigate(NavInput(inStart = true, hasWifi = false))
    assertEquals(WatchScreen.NO_WIFI, noWifi.screen)
    assertEquals(WatchScreen.HOME, noWifi.behind)

    val ready = navigate(NavInput(inStart = true, connected = true))
    assertEquals(WatchScreen.READY, ready.screen)
    assertEquals(WatchScreen.HOME, ready.behind)
    assertEquals(BackAction.LEAVE_START, ready.back)
  }

  @Test
  fun soloReadyGoesBackToConnectFirst() {
    val solo = navigate(NavInput(inStart = true, solo = true))
    assertEquals(WatchScreen.READY, solo.screen)
    assertEquals(WatchScreen.CONNECT, solo.behind)
    assertEquals(BackAction.LEAVE_SOLO, solo.back)

    val soloNoWifi = navigate(NavInput(inStart = true, solo = true, hasWifi = false))
    assertEquals(WatchScreen.NO_WIFI, soloNoWifi.behind)

    // 選了只發令之後終點又連上：照一般的待命，往右滑回首頁
    val both = navigate(NavInput(inStart = true, solo = true, connected = true))
    assertEquals(WatchScreen.HOME, both.behind)
    assertEquals(BackAction.LEAVE_START, both.back)
  }

  @Test
  fun noSpeakerBlocksOnlyTheStartDevice() {
    val n = navigate(NavInput(inStart = true, hasSpeaker = false, connected = true))
    assertEquals(WatchScreen.NO_SPEAKER, n.screen)
    assertEquals(WatchScreen.HOME, n.behind)
    assertEquals(BackAction.LEAVE_START, n.back)
  }

  @Test
  fun settingsReturnsToWhereItWasOpened() {
    val fromHome = navigate(NavInput(showSettings = true))
    assertEquals(WatchScreen.SETTINGS, fromHome.screen)
    assertEquals(WatchScreen.HOME, fromHome.behind)
    assertEquals(BackAction.CLOSE_SETTINGS, fromHome.back)

    val fromReady = navigate(NavInput(showSettings = true, inStart = true, connected = true))
    assertEquals(WatchScreen.SETTINGS, fromReady.screen)
    assertEquals(WatchScreen.READY, fromReady.behind)
  }

  @Test
  fun sequenceCannotBeSwipedAway() {
    for (p in listOf(Phase.COUNTDOWN, Phase.MARKS, Phase.SET, Phase.GUN)) {
      val n = navigate(NavInput(inStart = true, connected = true, phase = p, update = UpdateStage.PROMPT))
      assertEquals(WatchScreen.SEQUENCE, n.screen)
      assertFalse(n.canSwipe)
    }
  }

  @Test
  fun resultComesBeforeUpdates() {
    for (p in listOf(Phase.RESULT, Phase.NO_RESULT)) {
      val n = navigate(NavInput(inStart = true, connected = true, phase = p, update = UpdateStage.PROMPT, phoneUpdate = true))
      assertEquals(WatchScreen.RESULT, n.screen)
      assertTrue(n.canSwipe)
      assertEquals(BackAction.EXIT, n.back)
    }
  }

  @Test
  fun updatePromptCoversTheCurrentScreenAndCanBeDismissed() {
    val onHome = navigate(NavInput(update = UpdateStage.PROMPT))
    assertEquals(WatchScreen.UPDATE, onHome.screen)
    assertEquals(WatchScreen.HOME, onHome.behind)
    assertEquals(BackAction.DISMISS_UPDATE, onHome.back)

    // 從設定頁的版本按「更新」失敗後按稍後：回到設定頁
    val onSettings = navigate(NavInput(update = UpdateStage.PROMPT, showSettings = true))
    assertEquals(WatchScreen.SETTINGS, onSettings.behind)

    val onReady = navigate(NavInput(update = UpdateStage.PROMPT, inStart = true, connected = true))
    assertEquals(WatchScreen.READY, onReady.behind)
  }

  @Test
  fun downloadingAndInstallingCannotBeSwipedAway() {
    val n = navigate(NavInput(update = UpdateStage.BUSY, showSettings = true))
    assertEquals(WatchScreen.UPDATE, n.screen)
    assertFalse(n.canSwipe)
    assertNull(n.behind)
  }

  @Test
  fun updateFromThePhoneWinsOverTheWatchOwnUpdate() {
    val n = navigate(NavInput(phoneUpdate = true, update = UpdateStage.PROMPT, showSettings = true))
    assertEquals(WatchScreen.PHONE_UPDATE, n.screen)
    assertFalse(n.canSwipe)
  }
}

package com.nkuo.sprinttimer.wear.core

/** 手錶 App 的畫面。數字是 Claude Design 設計稿的畫面編號。 */
enum class WatchScreen {
  /** 32 首頁：起點機、設定 */
  HOME,
  NO_SPEAKER,
  NO_WIFI,

  /** 10 等終點手機連線 */
  CONNECT,

  /** 11 待命 */
  READY,

  /** 33、34 設定（往下捲是版本） */
  SETTINGS,

  /** 12 口令進行中 */
  SEQUENCE,

  /** 13 成績 */
  RESULT,

  /** 15 App 內更新 */
  UPDATE,

  /** 26 手機傳來的更新 */
  PHONE_UPDATE,
}

/** App 內更新畫面的狀態，只分導覽需要的三種 */
enum class UpdateStage {
  NONE,

  /** 在問要不要更新，或更新失敗：可以滑掉 */
  PROMPT,

  /** 下載或安裝中：不能滑掉 */
  BUSY,
}

/** 往右滑（返回）要做的事 */
enum class BackAction {
  EXIT,
  DISMISS_UPDATE,
  CLOSE_SETTINGS,

  /** 從「只發令」的待命回到等連線 */
  LEAVE_SOLO,

  /** 離開起點機，回首頁 */
  LEAVE_START,
}

data class NavInput(
  val hasSpeaker: Boolean = true,
  val hasWifi: Boolean = true,
  /** 終點手機已連線 */
  val connected: Boolean = false,
  /** 選了「只發令，不計時」 */
  val solo: Boolean = false,
  val phase: Phase = Phase.IDLE,
  /** 在首頁按了「起點機」 */
  val inStart: Boolean = false,
  val showSettings: Boolean = false,
  val update: UpdateStage = UpdateStage.NONE,
  /** 正在接收或安裝手機傳來的更新 */
  val phoneUpdate: Boolean = false,
)

data class Nav(
  val screen: WatchScreen,
  /** 往右滑時底下露出來的畫面；null = 什麼都沒有（離開 App），或這個畫面不能滑 */
  val behind: WatchScreen?,
  val canSwipe: Boolean,
  val back: BackAction,
)

/**
 * 現在該顯示哪個畫面、往右滑會回到哪裡。
 * 層次：首頁 →（起點機）等連線／待命 → 口令 → 成績；設定可以從首頁或待命進去；更新畫面只在沒有一趟在進行時蓋在最上面。
 */
fun navigate(i: NavInput): Nav {
  val waiting = if (i.hasWifi) WatchScreen.CONNECT else WatchScreen.NO_WIFI
  // 起點機這一層在待命時的畫面
  val start = when {
    !i.hasSpeaker -> WatchScreen.NO_SPEAKER
    i.connected || i.solo -> WatchScreen.READY
    else -> waiting
  }
  val underSettings = if (i.inStart) start else WatchScreen.HOME
  val base = if (i.showSettings) WatchScreen.SETTINGS else underSettings
  val screen = when {
    i.phase == Phase.COUNTDOWN || i.phase == Phase.MARKS || i.phase == Phase.SET || i.phase == Phase.GUN -> WatchScreen.SEQUENCE
    i.phase == Phase.RESULT || i.phase == Phase.NO_RESULT -> WatchScreen.RESULT
    // 更新只在待命時出現，不打斷進行中的一趟
    i.phoneUpdate -> WatchScreen.PHONE_UPDATE
    i.update != UpdateStage.NONE -> WatchScreen.UPDATE
    else -> base
  }
  return when (screen) {
    // 口令進行中、接收手機傳來的更新時不能滑掉，避免誤觸
    WatchScreen.SEQUENCE, WatchScreen.PHONE_UPDATE -> Nav(screen, null, false, BackAction.EXIT)
    WatchScreen.UPDATE ->
      if (i.update == UpdateStage.BUSY) Nav(screen, null, false, BackAction.EXIT) else Nav(screen, base, true, BackAction.DISMISS_UPDATE)
    WatchScreen.SETTINGS -> Nav(screen, underSettings, true, BackAction.CLOSE_SETTINGS)
    WatchScreen.READY ->
      if (i.solo && !i.connected) Nav(screen, waiting, true, BackAction.LEAVE_SOLO) else Nav(screen, WatchScreen.HOME, true, BackAction.LEAVE_START)
    WatchScreen.CONNECT, WatchScreen.NO_WIFI, WatchScreen.NO_SPEAKER -> Nav(screen, WatchScreen.HOME, true, BackAction.LEAVE_START)
    WatchScreen.HOME, WatchScreen.RESULT -> Nav(screen, null, true, BackAction.EXIT)
  }
}

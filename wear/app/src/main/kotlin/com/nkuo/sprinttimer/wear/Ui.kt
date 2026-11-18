package com.nkuo.sprinttimer.wear

import android.content.Context
import android.content.Intent
import android.provider.Settings
import androidx.compose.foundation.Canvas
import androidx.compose.foundation.Image
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.defaultMinSize
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.BasicText
import androidx.compose.runtime.Composable
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.compositionLocalOf
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableDoubleStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.runtime.withFrameNanos
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.ColorFilter
import androidx.compose.ui.graphics.StrokeCap
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.platform.LocalConfiguration
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.TextUnit
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.em
import androidx.wear.compose.material.SwipeToDismissBox
import com.nkuo.sprinttimer.wear.core.Phase
import com.nkuo.sprinttimer.wear.core.StartState
import com.nkuo.sprinttimer.wear.core.formatOfficial
import com.nkuo.sprinttimer.wear.core.formatRaw
import com.nkuo.sprinttimer.wear.core.formatSize
import kotlin.math.ceil

/**
 * 手錶起點機的畫面。
 * 設計稿：Claude Design「短跑計時 App 介面」畫面 10–15 https://claude.ai/artifact/UXK5fTNCPcaz6D5CiXfARX
 * 設計稿把 192dp 的圓形錶面畫成 384px（2 倍），這裡所有尺寸都直接寫設計稿的 px，再依實際錶面大小縮放。
 * 顏色沿用手機版（src/ui/kit.tsx），只有底色改純黑（手錶省電）。
 */
private object C {
  val bg = Color.Black
  val card = Color(0xFF181C23)
  val raised = Color(0xFF232833)
  val line = Color(0xFF2A303A)
  val text = Color(0xFFF2F4F7)
  val soft = Color(0xFFC5CBD4)
  val dim = Color(0xFFA3ABB8)
  val accent = Color(0xFFFF7A3D)
  val onAccent = Color(0xFF0E1116)
  val info = Color(0xFF5AB0FF)
  val infoText = Color(0xFF8CCBFF)
  val infoBg = Color(0xFF12263A)
  val warn = Color(0xFFFFC24D)
  val bad = Color(0xFFFF5468)
  val badText = Color(0xFFFF8090)
  val badSoft = Color(0xFFFFC2CA)
}

/** 實際錶面寬度 ÷ 192dp */
private val LocalUnit = compositionLocalOf { 1f }

/** 設計稿的 px → 這支手錶上的 dp */
@Composable
private fun px(designPx: Number): Dp = (designPx.toFloat() / 2f * LocalUnit.current).dp

/** 設計稿的字級 px → sp。跟著錶面縮放、不跟系統字體大小，圓形錶面上才不會被切掉。 */
@Composable
private fun fpx(designPx: Number): TextUnit {
  val d = px(designPx)
  return with(LocalDensity.current) { d.toSp() }
}

@Composable
private fun Txt(
  text: String,
  size: Number,
  color: Color,
  weight: FontWeight = FontWeight.Normal,
  modifier: Modifier = Modifier,
  /** 數字等寬（計時數字不會左右跳） */
  tabular: Boolean = false,
  letterSpacingEm: Float = 0f,
  lineHeight: Float? = null,
  maxLines: Int = Int.MAX_VALUE,
) {
  BasicText(
    text = text,
    modifier = modifier,
    style = TextStyle(
      color = color,
      fontSize = fpx(size),
      fontWeight = weight,
      textAlign = TextAlign.Center,
      fontFeatureSettings = if (tabular) "tnum" else null,
      letterSpacing = if (letterSpacingEm != 0f) letterSpacingEm.em else TextUnit.Unspecified,
      lineHeight = if (lineHeight != null) fpx(size.toFloat() * lineHeight) else TextUnit.Unspecified,
    ),
    softWrap = maxLines != 1,
    maxLines = maxLines,
  )
}

@Composable
private fun Icon(id: Int, size: Number, tint: Color, description: String? = null) {
  Image(
    painter = painterResource(id),
    contentDescription = description,
    modifier = Modifier.size(px(size)),
    colorFilter = ColorFilter.tint(tint),
  )
}

/** 膠囊形按鈕。[border] 不為 null 時是外框樣式。 */
@Composable
private fun PillButton(
  label: String,
  onClick: () -> Unit,
  bg: Color,
  fg: Color,
  minHeight: Number,
  padH: Number,
  textSize: Number,
  weight: FontWeight,
  modifier: Modifier = Modifier,
  border: Color? = null,
) {
  val shape = RoundedCornerShape(percent = 50)
  Box(
    modifier = modifier
      .defaultMinSize(minHeight = px(minHeight))
      .clip(shape)
      .background(bg)
      .then(if (border != null) Modifier.border(px(2), border, shape) else Modifier)
      .clickable(role = Role.Button, onClick = onClick)
      .padding(horizontal = px(padH)),
    contentAlignment = Alignment.Center,
  ) {
    Txt(label, textSize, fg, weight, maxLines = 1)
  }
}

@Composable
private fun PrimaryButton(label: String, onClick: () -> Unit, minHeight: Number = 76, padH: Number = 44, textSize: Number = 28) =
  PillButton(label, onClick, C.accent, C.onAccent, minHeight, padH, textSize, FontWeight.Black)

@Composable
private fun QuietButton(label: String, onClick: () -> Unit, minHeight: Number = 72, padH: Number = 28, textSize: Number = 24) =
  PillButton(label, onClick, C.card, C.text, minHeight, padH, textSize, FontWeight.Bold, border = C.line)

@Composable
private fun Chip(label: String, bg: Color, fg: Color, dot: Color? = null, icon: Int? = null) {
  Row(
    modifier = Modifier.clip(RoundedCornerShape(percent = 50)).background(bg).padding(horizontal = px(16), vertical = px(5)),
    verticalAlignment = Alignment.CenterVertically,
    horizontalArrangement = Arrangement.spacedBy(px(8)),
  ) {
    if (dot != null) Box(Modifier.size(px(10)).clip(CircleShape).background(dot))
    if (icon != null) Icon(icon, 24, fg)
    Txt(label, 22, fg, FontWeight.Medium, maxLines = 1)
  }
}

/** 畫面的共同外框：純黑底、內容置中、留出圓形錶面的邊 */
@Composable
private fun Face(padH: Number = 40, padV: Number = 40, gap: Number = 8, content: @Composable () -> Unit) {
  Column(
    modifier = Modifier.fillMaxSize().background(C.bg).padding(horizontal = px(padH), vertical = px(padV)),
    verticalArrangement = Arrangement.spacedBy(px(gap), Alignment.CenterVertically),
    horizontalAlignment = Alignment.CenterHorizontally,
  ) {
    content()
  }
}

private enum class Screen { NO_SPEAKER, NO_WIFI, CONNECT, READY, SETTINGS, SEQUENCE, RESULT, UPDATE }

@Composable
fun App(vm: StartDeviceViewModel, onExit: () -> Unit) {
  val cfg = LocalConfiguration.current
  val unit = minOf(cfg.screenWidthDp, cfg.screenHeightDp) / 192f
  var showSettings by rememberSaveable { mutableStateOf(false) }
  val race = vm.race
  val update = vm.update

  // 待命時最底下那一層：還沒連線顯示 IP，連上了（或選了只發令）顯示開始鈕
  val waiting = if (vm.ip == null) Screen.NO_WIFI else Screen.CONNECT
  val home = if (race.connected || vm.solo) Screen.READY else waiting
  val screen = when {
    !vm.hasSpeaker -> Screen.NO_SPEAKER
    race.phase == Phase.COUNTDOWN || race.phase == Phase.MARKS || race.phase == Phase.SET || race.phase == Phase.GUN -> Screen.SEQUENCE
    race.phase == Phase.RESULT || race.phase == Phase.NO_RESULT -> Screen.RESULT
    // 更新只在待命時出現，不打斷進行中的一趟
    update != UpdateUi.None -> Screen.UPDATE
    showSettings -> Screen.SETTINGS
    else -> home
  }
  // 下載和安裝途中不能滑掉
  val updateBusy = update is UpdateUi.Downloading || update is UpdateUi.Installing
  // 往右滑會回到哪一個畫面；null = 離開 App
  val behind = when {
    screen == Screen.UPDATE -> if (updateBusy) null else home
    screen == Screen.SETTINGS -> home
    screen == Screen.READY && vm.solo && !race.connected -> waiting
    else -> null
  }

  CompositionLocalProvider(LocalUnit provides unit) {
    SwipeToDismissBox(
      onDismissed = {
        when {
          screen == Screen.UPDATE -> vm.dismissUpdate()
          screen == Screen.SETTINGS -> showSettings = false
          behind != null -> vm.solo = false
          else -> onExit()
        }
      },
      modifier = Modifier.fillMaxSize().background(C.bg),
      backgroundScrimColor = C.bg,
      contentScrimColor = C.bg,
      backgroundKey = behind ?: "exit",
      contentKey = screen,
      // 口令進行中不能滑掉，避免誤觸
      hasBackground = screen != Screen.SEQUENCE && !(screen == Screen.UPDATE && updateBusy),
    ) { isBackground ->
      when (if (isBackground) behind else screen) {
        Screen.NO_SPEAKER -> NoSpeakerScreen()
        Screen.NO_WIFI -> NoWifiScreen()
        Screen.CONNECT -> ConnectScreen(ip = vm.ip ?: "", onSolo = { vm.solo = true })
        Screen.READY -> ReadyScreen(race, onStart = vm::start, onSettings = { showSettings = true })
        Screen.SETTINGS -> SettingsScreen(vm)
        Screen.SEQUENCE -> SequenceScreen(race, now = vm::now, onCancel = vm::cancel, onStopWaiting = vm::next)
        Screen.RESULT -> ResultScreen(race, onAgain = vm::next)
        Screen.UPDATE -> UpdateScreen(update, vm.currentVersion, onUpdate = vm::startUpdate, onLater = vm::dismissUpdate)
        null -> Box(Modifier.fillMaxSize().background(C.bg))
      }
    }
  }
}

// ---------- 畫面 10：等待終點連線 ----------

@Composable
private fun ConnectScreen(ip: String, onSolo: () -> Unit) {
  Face(padV = 44) {
    Txt("起點手錶", 22, C.dim)
    Chip("Wi-Fi 已連線", C.infoBg, C.infoText, icon = R.drawable.ic_wifi)
    // IP 最長 15 個字，太長就縮小才放得進圓形錶面
    val ipSize = when {
      ip.length <= 13 -> 42
      ip.length == 14 -> 39
      else -> 36
    }
    Txt(ip, ipSize, C.text, FontWeight.Bold, tabular = true, letterSpacingEm = -0.01f, maxLines = 1)
    Txt("在終點手機輸入這個 IP", 22, C.soft)
    Spacer(Modifier.height(px(0)))
    QuietButton("只發令，不計時", onSolo)
  }
}

@Composable
private fun NoWifiScreen() {
  val context = LocalContext.current
  Face(gap = 10) {
    Icon(R.drawable.ic_wifi_off, 56, C.warn, "沒有 Wi-Fi")
    Txt("沒有連上 Wi-Fi", 30, C.warn, FontWeight.Black)
    Txt("讓手錶連上終點手機的熱點，或和它同一個 Wi-Fi", 22, C.soft, lineHeight = 1.35f)
    PrimaryButton("Wi-Fi 設定", { openWifiSettings(context) }, minHeight = 72, padH = 28, textSize = 24)
  }
}

private fun openWifiSettings(context: Context) {
  for (action in listOf(Settings.ACTION_WIFI_SETTINGS, Settings.ACTION_WIRELESS_SETTINGS, Settings.ACTION_SETTINGS)) {
    try {
      context.startActivity(Intent(action).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK))
      return
    } catch (e: Exception) {
      // 這支手錶沒有這個設定頁，試下一個
    }
  }
}

@Composable
private fun NoSpeakerScreen() {
  Face(gap = 10) {
    Icon(R.drawable.ic_speaker_off, 56, C.bad, "沒有喇叭")
    Txt("這支手錶沒有喇叭", 30, C.badText, FontWeight.Black)
    Txt("沒辦法發出槍聲，不能當起點機。藍牙耳機和喇叭有延遲，也不能用。", 22, C.badSoft, lineHeight = 1.35f)
  }
}

// ---------- 畫面 11：待命 ----------

@Composable
private fun ReadyScreen(race: StartState, onStart: () -> Unit, onSettings: () -> Unit) {
  Face(padV = 26, gap = 10) {
    if (race.connected) {
      Chip("終點已連線", C.infoBg, C.infoText, dot = C.info)
    } else {
      Chip("只發令 · 不計時", C.raised, C.soft)
    }
    Column(
      modifier = Modifier
        .size(px(188))
        .clip(CircleShape)
        .background(C.accent)
        .clickable(role = Role.Button, onClick = onStart),
      verticalArrangement = Arrangement.spacedBy(px(2), Alignment.CenterVertically),
      horizontalAlignment = Alignment.CenterHorizontally,
    ) {
      Txt("開始", 52, C.onAccent, FontWeight.Black, lineHeight = 1.1f)
      Txt("第 ${race.raceNo} 趟", 20, C.onAccent, FontWeight.Bold)
    }
    Box(
      modifier = Modifier
        .size(width = px(96), height = px(64))
        .clip(RoundedCornerShape(percent = 50))
        .background(C.card)
        .clickable(role = Role.Button, onClick = onSettings)
        .semantics { contentDescription = "設定" },
      contentAlignment = Alignment.Center,
    ) {
      Icon(R.drawable.ic_tune, 30, C.soft)
    }
  }
}

// ---------- 畫面 12：口令進行中 ----------

@Composable
private fun SequenceScreen(race: StartState, now: () -> Double, onCancel: () -> Unit, onStopWaiting: () -> Unit) {
  // 每一格畫面更新一次現在時刻，用來畫倒數和進度環
  var t by remember { mutableDoubleStateOf(now()) }
  LaunchedEffect(Unit) {
    while (true) {
      withFrameNanos { }
      t = now()
    }
  }

  val end = race.phaseEndsAt
  // 「預備」和鳴槍後沒有結束時刻：進度環畫滿。預備多久會鳴槍不能讓人看出來。
  val fraction = if (end == null || end <= race.phaseStartedAt) 1f else ((t - race.phaseStartedAt) / (end - race.phaseStartedAt)).toFloat().coerceIn(0f, 1f)
  val ringColor = when (race.phase) {
    Phase.COUNTDOWN -> C.info
    Phase.MARKS -> C.text
    Phase.SET -> C.warn
    else -> C.accent
  }
  val strokePx = with(LocalDensity.current) { px(10).toPx() }
  val insetPx = with(LocalDensity.current) { px(8).toPx() }

  Box(Modifier.fillMaxSize().background(C.bg), contentAlignment = Alignment.Center) {
    Canvas(Modifier.fillMaxSize()) {
      val r = size.minDimension / 2 - insetPx
      drawCircle(color = C.raised, radius = r, style = Stroke(width = strokePx))
      drawArc(
        color = ringColor,
        startAngle = -90f,
        sweepAngle = 360f * fraction,
        useCenter = false,
        topLeft = Offset(center.x - r, center.y - r),
        size = Size(r * 2, r * 2),
        style = Stroke(width = strokePx, cap = StrokeCap.Round),
      )
    }
    Column(
      modifier = Modifier.padding(px(40)),
      verticalArrangement = Arrangement.spacedBy(px(2), Alignment.CenterVertically),
      horizontalAlignment = Alignment.CenterHorizontally,
    ) {
      when (race.phase) {
        Phase.COUNTDOWN -> {
          Txt("走回起跑線", 22, C.dim, letterSpacingEm = 0.1f)
          val left = if (end == null) 0 else ceil(end - t).toInt().coerceAtLeast(1)
          Txt(left.toString(), 132, C.text, FontWeight.Bold, tabular = true, lineHeight = 1.05f, maxLines = 1)
        }
        Phase.MARKS -> {
          Txt("ON YOUR MARKS", 22, C.dim, letterSpacingEm = 0.1f)
          Txt("各就位", 84, C.text, FontWeight.Black, lineHeight = 1.2f, maxLines = 1)
        }
        Phase.SET -> {
          Txt("SET", 22, C.dim, letterSpacingEm = 0.1f)
          Txt("預備", 108, C.warn, FontWeight.Black, lineHeight = 1.2f, maxLines = 1)
        }
        else -> {
          Txt("GO", 22, C.dim, letterSpacingEm = 0.1f)
          Txt("砰！", 108, C.accent, FontWeight.Black, lineHeight = 1.2f, maxLines = 1)
        }
      }
      Spacer(Modifier.height(px(8)))
      when {
        race.phase != Phase.GUN ->
          PillButton("取消", onCancel, C.bg, C.badText, 68, 36, 24, FontWeight.Bold, border = C.bad)
        race.timed -> {
          Txt("等待終點成績…", 22, C.soft)
          Spacer(Modifier.height(px(4)))
          QuietButton("不等了", onStopWaiting, minHeight = 60, padH = 28, textSize = 22)
        }
        else -> Txt("已鳴槍", 22, C.soft)
      }
    }
  }
}

// ---------- 畫面 13：成績 ----------

@Composable
private fun ResultScreen(race: StartState, onAgain: () -> Unit) {
  val raw = race.resultRaw
  if (raw != null) {
    Face(gap = 0) {
      Txt("第 ${race.raceNo} 趟 · 雙機", 22, C.dim)
      Row(verticalAlignment = Alignment.Bottom, horizontalArrangement = Arrangement.spacedBy(px(6))) {
        val official = formatOfficial(raw)
        // 超過 100 秒多一位數，縮小才放得下
        Txt(official, if (official.length <= 5) 116 else 92, C.text, FontWeight.Bold, tabular = true, letterSpacingEm = -0.02f, lineHeight = 1.1f, maxLines = 1)
        Txt("秒", 26, C.soft, FontWeight.Bold, modifier = Modifier.padding(bottom = px(20)))
      }
      Txt("原始 ${formatRaw(raw)}", 22, C.dim, tabular = true)
      Spacer(Modifier.height(px(14)))
      PrimaryButton("再一次", onAgain)
    }
  } else {
    Face(gap = 8) {
      Txt("第 ${race.raceNo} 趟 · 雙機", 22, C.dim)
      Txt("沒收到成績", 34, C.warn, FontWeight.Black)
      Txt("終點沒有回傳。可能斷線，或沒偵測到衝線。", 22, C.soft, lineHeight = 1.35f)
      Spacer(Modifier.height(px(0)))
      PrimaryButton("再一次", onAgain)
    }
  }
}

// ---------- 畫面 15：App 內更新 ----------

/** 文字按鈕（沒有底色），用在次要的「稍後」 */
@Composable
private fun TextButton(label: String, onClick: () -> Unit) =
  PillButton(label, onClick, C.bg, C.soft, 56, 28, 22, FontWeight.Medium)

@Composable
private fun UpdateScreen(update: UpdateUi, currentVersion: String, onUpdate: () -> Unit, onLater: () -> Unit) {
  when (update) {
    is UpdateUi.Offer -> Face(gap = 4) {
      Txt("有新版本", 22, C.infoText)
      Txt("v${update.release.version}", 60, C.text, FontWeight.Bold, tabular = true, lineHeight = 1.1f, maxLines = 1)
      val size = if (update.release.sizeBytes > 0) " · ${formatSize(update.release.sizeBytes)}" else ""
      Txt("目前 v$currentVersion$size", 22, C.dim, maxLines = 1)
      Spacer(Modifier.height(px(4)))
      PrimaryButton("更新", onUpdate, padH = 52)
      TextButton("稍後", onLater)
    }
    is UpdateUi.Downloading -> RingFace(update.fraction) {
      Txt("下載 v${update.release.version}", 22, C.dim, maxLines = 1)
      Row(verticalAlignment = Alignment.Bottom, horizontalArrangement = Arrangement.spacedBy(px(4))) {
        Txt((update.fraction * 100).toInt().toString(), 112, C.text, FontWeight.Bold, tabular = true, lineHeight = 1.1f, maxLines = 1)
        Txt("%", 30, C.soft, FontWeight.Bold, modifier = Modifier.padding(bottom = px(20)))
      }
      Txt("請讓 App 保持開著", 22, C.soft)
    }
    is UpdateUi.Installing -> RingFace(1f) {
      Txt("安裝中…", 44, C.text, FontWeight.Black)
      Spacer(Modifier.height(px(8)))
      Txt("App 會自己關掉。\n裝好後請再打開一次。", 22, C.soft, lineHeight = 1.35f)
    }
    is UpdateUi.Failed -> Face(gap = 8) {
      Txt("更新失敗", 34, C.warn, FontWeight.Black)
      Txt(
        if (update.installBlocked) "這支手錶不讓 App 自己安裝。請改用手機的安裝工具更新。" else "下載失敗。請確認手錶連得上網路。",
        22,
        C.soft,
        lineHeight = 1.35f,
      )
      PrimaryButton("再試一次", onUpdate, minHeight = 72, padH = 36, textSize = 24)
      TextButton("稍後", onLater)
    }
    UpdateUi.None -> Box(Modifier.fillMaxSize().background(C.bg))
  }
}

/** 外圈有進度環的畫面（下載、安裝） */
@Composable
private fun RingFace(fraction: Float, content: @Composable () -> Unit) {
  val strokePx = with(LocalDensity.current) { px(10).toPx() }
  val insetPx = with(LocalDensity.current) { px(8).toPx() }
  Box(Modifier.fillMaxSize().background(C.bg), contentAlignment = Alignment.Center) {
    Canvas(Modifier.fillMaxSize()) {
      val r = size.minDimension / 2 - insetPx
      drawCircle(color = C.raised, radius = r, style = Stroke(width = strokePx))
      drawArc(
        color = C.info,
        startAngle = -90f,
        sweepAngle = 360f * fraction.coerceIn(0f, 1f),
        useCenter = false,
        topLeft = Offset(center.x - r, center.y - r),
        size = Size(r * 2, r * 2),
        style = Stroke(width = strokePx, cap = StrokeCap.Round),
      )
    }
    Column(
      modifier = Modifier.padding(px(40)),
      verticalArrangement = Arrangement.spacedBy(px(2), Alignment.CenterVertically),
      horizontalAlignment = Alignment.CenterHorizontally,
    ) {
      content()
    }
  }
}

// ---------- 畫面 14：設定 ----------

@Composable
private fun SettingsScreen(vm: StartDeviceViewModel) {
  Face(padV = 36, gap = 6) {
    Txt("口令語言", 22, C.dim)
    Row(horizontalArrangement = Arrangement.spacedBy(px(8))) {
      LangButton("中文", vm.lang == CommandLang.ZH) { vm.chooseLang(CommandLang.ZH) }
      LangButton("English", vm.lang == CommandLang.EN) { vm.chooseLang(CommandLang.EN) }
    }
    Spacer(Modifier.height(px(4)))
    Txt("按開始後倒數", 22, C.dim)
    Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(px(14))) {
      StepButton(R.drawable.ic_minus, "減少") { vm.changeLeadIn(-1) }
      Row(modifier = Modifier.widthIn(min = px(96)), verticalAlignment = Alignment.Bottom, horizontalArrangement = Arrangement.Center) {
        Txt(vm.leadInSec.toString(), 48, C.text, FontWeight.Bold, tabular = true, maxLines = 1)
        Txt(" 秒", 24, C.soft, modifier = Modifier.padding(bottom = px(8)))
      }
      StepButton(R.drawable.ic_plus, "增加") { vm.changeLeadIn(1) }
    }
    Spacer(Modifier.height(px(2)))
    Txt("預備→鳴槍 隨機 1.6–2.6 秒", 20, C.dim)
  }
}

@Composable
private fun LangButton(label: String, selected: Boolean, onClick: () -> Unit) {
  if (selected) {
    PillButton(label, onClick, C.accent, C.onAccent, 72, 0, 26, FontWeight.Black, modifier = Modifier.width(px(132)))
  } else {
    PillButton(label, onClick, C.card, C.text, 72, 0, 24, FontWeight.Medium, modifier = Modifier.width(px(132)), border = C.line)
  }
}

@Composable
private fun StepButton(icon: Int, description: String, onClick: () -> Unit) {
  Box(
    modifier = Modifier
      .size(px(76))
      .clip(CircleShape)
      .background(C.card)
      .border(px(2), C.line, CircleShape)
      .clickable(role = Role.Button, onClick = onClick)
      .semantics { contentDescription = description },
    contentAlignment = Alignment.Center,
  ) {
    Icon(icon, 28, C.text)
  }
}

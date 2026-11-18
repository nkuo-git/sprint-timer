package com.nkuo.sprinttimer.wear

import android.os.Bundle
import android.view.WindowManager
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.activity.viewModels

class MainActivity : ComponentActivity() {
  private val vm: StartDeviceViewModel by viewModels()

  override fun onCreate(savedInstanceState: Bundle?) {
    super.onCreate(savedInstanceState)
    // 起點機要隨時能按、隨時回應終點的同步，所以在前景時螢幕保持開啟
    window.addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)
    setContent { App(vm, onExit = { finish() }) }
  }

  override fun onStop() {
    super.onStop()
    vm.restoreVolumeIfIdle()
  }
}

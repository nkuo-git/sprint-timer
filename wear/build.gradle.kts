// 外掛只在這裡載入一次，各模組再各自套用（版本在 settings.gradle.kts）
plugins {
  id("com.android.application") apply false
  id("org.jetbrains.kotlin.android") apply false
  id("org.jetbrains.kotlin.jvm") apply false
  id("org.jetbrains.kotlin.plugin.compose") apply false
}

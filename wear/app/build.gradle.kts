import org.jetbrains.kotlin.gradle.dsl.JvmTarget

plugins {
  id("com.android.application")
  id("org.jetbrains.kotlin.android")
  id("org.jetbrains.kotlin.plugin.compose")
}

// 版本由 CI 傳入，和手機 App 同一組：顯示版本 0.N、versionCode = GitHub Actions run number
val appVersion = providers.gradleProperty("appVersion").orElse("0.0")
val buildNumber = providers.gradleProperty("buildNumber").map { it.toInt() }.orElse(1)
// 簽章金鑰：CI 傳入手機 App 用的那一把（-PsigningStore=…/android/app/debug.keystore），兩個 App 簽章才會相同。
// 沒傳時用這個資料夾裡的測試金鑰，只適合自己單獨測手錶版。
val signingStore = providers.gradleProperty("signingStore").orElse("debug.keystore")

android {
  namespace = "com.nkuo.sprinttimer.wear"
  compileSdk = 35

  defaultConfig {
    // 和手機 App 同一個套件名、同一把簽章金鑰：Wear OS 只讓「同一個 App」的手機版和手錶版透過配對連線互通
    //（手機看手錶版本、把新版傳到手錶安裝）。手錶版仍然可以獨立使用，手機上不一定要裝 App。
    applicationId = "com.nkuo.sprinttimer"
    minSdk = 30 // Wear OS 3
    // 要夠新：系統只讓目標版本夠新的 App 不經確認更新自己（App 內更新用）
    targetSdk = 35
    versionCode = buildNumber.get()
    versionName = appVersion.get()
  }

  signingConfigs {
    // 固定的金鑰，每次雲端建置的 APK 才能互相覆蓋安裝。和手機 App 同一把測試用金鑰，不是上架用的。
    create("fixed") {
      storeFile = file(signingStore.get())
      storePassword = "android"
      keyAlias = "androiddebugkey"
      keyPassword = "android"
    }
  }

  buildTypes {
    debug {
      signingConfig = signingConfigs.getByName("fixed")
    }
    release {
      signingConfig = signingConfigs.getByName("fixed")
      isMinifyEnabled = false
    }
  }

  compileOptions {
    sourceCompatibility = JavaVersion.VERSION_17
    targetCompatibility = JavaVersion.VERSION_17
  }

  buildFeatures {
    compose = true
  }

  lint {
    // 雲端建置只要 APK；lint 另外看，不讓它擋住發佈
    checkReleaseBuilds = false
  }

  sourceSets {
    getByName("main") {
      // 和手機 App 共用的鳴槍程式（不依賴 Expo）
      java.srcDir("../../modules/precision-clock/android/src/main/java/expo/modules/precisionclock/shared")
    }
  }
}

kotlin {
  compilerOptions {
    jvmTarget.set(JvmTarget.JVM_17)
  }
}

dependencies {
  implementation(project(":core"))
  implementation(platform("androidx.compose:compose-bom:2024.12.01"))
  implementation("androidx.compose.ui:ui")
  implementation("androidx.compose.foundation:foundation")
  implementation("androidx.activity:activity-compose:1.9.3")
  implementation("androidx.lifecycle:lifecycle-viewmodel-compose:2.8.7")
  implementation("androidx.wear.compose:compose-foundation:1.4.0")
  implementation("androidx.wear.compose:compose-material:1.4.0")
  // 和配對手機上的 App 互通（Wear OS Data Layer）
  implementation("com.google.android.gms:play-services-wearable:18.2.0")
}

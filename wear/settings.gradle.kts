// 手錶版（Wear OS）起點機。和手機 App（Expo）分開的原生專案，共用 modules/precision-clock 的鳴槍程式。
// :core 是純 Kotlin（流程、通訊協定、UDP，有單元測試）；:app 是手錶 App 本體。
pluginManagement {
  repositories {
    mavenCentral()
    // Google 的倉庫只拿 Android 相關套件，其他一律走 Maven Central
    google {
      content {
        includeGroupByRegex("com\\.android.*")
        includeGroupByRegex("com\\.google.*")
        includeGroupByRegex("androidx.*")
      }
    }
    gradlePluginPortal()
  }
  plugins {
    id("com.android.application") version "8.9.1"
    id("org.jetbrains.kotlin.android") version "2.1.20"
    id("org.jetbrains.kotlin.jvm") version "2.1.20"
    id("org.jetbrains.kotlin.plugin.compose") version "2.1.20"
  }
}
dependencyResolutionManagement {
  repositoriesMode.set(RepositoriesMode.FAIL_ON_PROJECT_REPOS)
  repositories {
    mavenCentral()
    // Google 的倉庫只拿 Android 相關套件，其他一律走 Maven Central
    google {
      content {
        includeGroupByRegex("com\\.android.*")
        includeGroupByRegex("com\\.google.*")
        includeGroupByRegex("androidx.*")
      }
    }
  }
}
rootProject.name = "sprint-timer-wear"
include(":core")
include(":app")

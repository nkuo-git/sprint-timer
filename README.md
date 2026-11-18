# 短跑計時（Sprint Timer）

手機版短跑電子計時：成績 = 衝線時間 − 鳴槍時間（含反應時間），iOS / Android。

- **雙手機模式**：起跑手機發令鳴槍（＋選用反應時間/搶跑偵測），終點手機用 240fps 相機偵測軀幹衝線，兩機透過區網 UDP 做毫秒級時鐘同步。
- **單手機模式**：手機放終點，自己鳴槍並自動扣除聲音傳遞時間；或用閃光起跑。
- **手錶起點機（Wear OS）**：手錶取代雙手機模式的起跑手機，喊口令、鳴槍，用 Wi-Fi 直接和終點手機同步。程式在 `wear/`。

設計細節見 [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md)。

## 開發
```bash
npm ci
npm test            # 單元測試（演算法 + 合成影格模擬）
npm run typecheck
npx expo prebuild   # 產生 android/ ios/ 原生專案
```
手錶版在 `wear/`（Gradle 專案）：
```bash
cd wear
./gradlew :core:test            # 流程與通訊協定的單元測試
./gradlew :app:assembleRelease  # 手錶 APK
```
App 使用原生模組（相機、精準時鐘），無法在 Expo Go 執行，需要自行建置的 dev client 或 APK。

## 雲端建置
- Android：push 到 main 後 GitHub Actions 自動建置並發佈 Release。最新版固定連結：
  https://github.com/nkuo-git/sprint-timer/releases/latest/download/sprint-timer.apk
- 手錶（Wear OS）：同一個 Release 裡的 `sprint-timer-wear.apk`，固定連結：
  https://github.com/nkuo-git/sprint-timer/releases/latest/download/sprint-timer-wear.apk
  手錶不能直接開 APK，要從 Android 手機用無線偵錯安裝：手錶「設定 → 開發人員選項 → 無線偵錯」，
  手機用 Bugjaeger 或 Wear Installer 之類的 App 連上手錶後安裝這個檔案。
- iOS：設定 `EXPO_TOKEN` secret 後手動執行 “iOS build (EAS)” workflow（需 Apple Developer 帳號）。

## 版本號
- 顯示版本 `主版.次版`（例如 v0.4），每次發佈次版 +1（`scripts/next-version.mjs` 依上一個 Release 計算）。
- 主版在 `version.json`，只在需要時手動改；改了之後次版從 0 開始。
- Release 標籤是 `build-<versionCode>`（GitHub Actions run number），App 內更新用它比較新舊。

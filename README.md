# 短跑計時（Sprint Timer）

手機版短跑電子計時：成績 = 衝線時間 − 鳴槍時間（含反應時間），iOS / Android。

- **雙手機模式**：起跑手機發令鳴槍（＋選用反應時間/搶跑偵測），終點手機用 240fps 相機偵測軀幹衝線，兩機透過區網 UDP 做毫秒級時鐘同步。
- **單手機模式**：手機放終點，自己鳴槍並自動扣除聲音傳遞時間；或用閃光起跑。

設計細節見 [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md)。

## 開發
```bash
npm ci
npm test            # 單元測試（演算法 + 合成影格模擬）
npm run typecheck
npx expo prebuild   # 產生 android/ ios/ 原生專案
```
App 使用原生模組（相機、精準時鐘），無法在 Expo Go 執行，需要自行建置的 dev client 或 APK。

## 雲端建置
- Android：push 到 main 後 GitHub Actions 自動建置並發佈 Release。最新版固定連結：
  https://github.com/nkuo-git/sprint-timer/releases/latest/download/sprint-timer.apk
- iOS：設定 `EXPO_TOKEN` secret 後手動執行 “iOS build (EAS)” workflow（需 Apple Developer 帳號）。

## 版本號
- 顯示版本 `主版.次版`（例如 v0.4），每次發佈次版 +1（`scripts/next-version.mjs` 依上一個 Release 計算）。
- 主版在 `version.json`，只在需要時手動改；改了之後次版從 0 開始。
- Release 標籤是 `build-<versionCode>`（GitHub Actions run number），App 內更新用它比較新舊。

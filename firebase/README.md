# 雲端（Firebase）設定

App 的 Email 登入、暱稱、雲端紀錄都放在一個 Firebase 專案裡（免費的 Spark 方案）。
App 只用 `fetch` 直接呼叫 Firebase 的 REST API，沒有裝 Firebase SDK。

目前的專案：`sprint-timer-3e0751`（[後台](https://console.firebase.google.com/project/sprint-timer-3e0751/overview)）。
`cloud.config.json` 裡的 `projectId` 和 `apiKey` 是公開的識別碼，不是密碼：誰能讀寫什麼由 `firestore.rules` 決定。

## 用到的東西

| 項目 | 用途 |
| --- | --- |
| Authentication：電子郵件連結（不需密碼） | 寄登入信、確認身分 |
| Firestore（asia-east1） | 暱稱與成績，權限規則在 `firestore.rules` |
| Hosting | 登入連結的網域 `sprint-timer-3e0751.firebaseapp.com`：`firebase/hosting/` 裡的後備網頁和 Android App Links 驗證檔 |
| Android 應用程式 `com.nkuo.sprinttimer` | 登記了簽署憑證的 SHA-1、SHA-256 指紋 |

## 登入流程

1. App 呼叫 `accounts:sendOobCode`（`EMAIL_SIGNIN`），Firebase 寄出登入信，App 記下「在等哪個 Email」。
2. 使用者在同一支手機點信裡的連結 `https://<專案>.firebaseapp.com/__/auth/action?...&oobCode=...`。
3. App 在 `app.config.js` 把自己註冊成這個網域 `/__/auth/` 底下連結的處理者（Android App Links），
   手機直接用連結打開 App，`src/account/AccountContext.tsx` 把連結交給 `service.handleLink()`，
   用裡面的一次性登入碼呼叫 `accounts:signInWithEmailLink` 完成登入。
4. 如果手機沒有直接開 App（例如信箱 App 用內建瀏覽器開連結），連結會落到 `firebase/hosting/index.html`：
   上面有「打開 App 完成登入」按鈕和「複製登入連結」。App 的登入畫面也可以直接貼上連結。

App Links 要通過驗證，`firebase/hosting/.well-known/assetlinks.json` 裡的指紋必須和 APK 的簽署憑證一致。
現在 CI 用 React Native 範本的 debug.keystore 簽署（指紋固定）；**之後如果換簽署金鑰，要同時更新這個檔案並重新發佈 Hosting。**

## 資料

- `users/{uid}`：`nickname`、`nicknameKey`（英文字母轉小寫，用來比對重複）、`search`（暱稱的所有片段，用來做「輸入一部分就找得到」）
- `nicknames/{nicknameKey}`：`{ uid }`，保證暱稱不重複
- `emails/{email}`：`{ uid }`，只能用完整的 Email 查，不能列出
- `results/{id}`：一筆成績，帶著那一趟的 `raceId`、`ranAt`、`distanceM`、`mode`。`owner` 是計時的人，
  `runner` 是被標記的帳號（可以是自己），`taggedTo` 只在標記給別人時有值，`runnerName` 是非用戶的名字

- `runs/{id}`：一次長跑（GPS 測距）：`ranAt`、`distanceM`、`durationS`、`targetM`（自由跑是 null）、`completed`、
  `splitsS`（每公里秒數）、`track`（路線，每段一個 Google encoded polyline 字串，暫停會分段）。只有跑的人自己（`owner`）讀寫得到。
  路線全部加起來限制 30 萬字元，App 存檔前會先簡化（一般一次跑步幾千到一兩萬字元）。

## 發佈規則與網頁

改了 `firestore.rules` 或 `firebase/hosting/` 之後要重新發佈：

```bash
gcloud auth login            # 用專案擁有者的 Google 帳號
GOOGLE_ACCESS_TOKEN=$(gcloud auth print-access-token) node scripts/deploy-firebase.mjs          # 兩個都發佈
GOOGLE_ACCESS_TOKEN=$(gcloud auth print-access-token) node scripts/deploy-firebase.mjs rules    # 只發佈規則
```

規則也可以直接貼到後台：Firestore Database → 規則 → 發佈。

## 測試

- `npm test`：用記憶體裡的假 Firebase（`test/fakeFirebase.ts`），很快，不用裝東西。
- `npm run test:cloud`：啟動 Firebase 模擬器（需要 Java 21），用真的 Auth / Firestore 行為和真的 `firestore.rules`
  把雲端相關的測試再跑一次。CI 每次都會跑。改規則時兩邊（`firestore.rules` 和 `test/fakeFirebase.ts`）要一起改。
- `test/realProject.test.ts`：對真的專案跑一遍主要流程（平常跳過，要專案擁有者的憑證；用法寫在檔案開頭）。

## 限制

- 免費方案一天只能寄 5 封登入信。要給比較多人用時，到後台升級成 Blaze 方案（用多少付多少）。
- 登入信要在裝了 App 的那支手機上點；在電腦上點沒辦法登入手機。
- 刪除帳號要求幾分鐘內登入過（Firebase 的規定），太久以前登入的要先登出再登入。
- 登入信的寄件人與內容是 Firebase 的預設範本，可以在後台 Authentication → 範本修改。
- iOS 還沒設定（需要 Associated Domains 與 Apple 開發者帳號）。

## 換成另一個 Firebase 專案

1. 建立專案，開啟 Authentication 的「電子郵件連結」登入，建立 Firestore 資料庫。
2. 登記 Android 應用程式 `com.nkuo.sprinttimer` 和簽署憑證的 SHA-1、SHA-256；新增一個網頁應用程式取得 `apiKey`。
3. 把 `projectId`、`apiKey` 填進 `cloud.config.json`（兩個都空白時，App 會隱藏登入與同步功能）。
4. 執行上面的發佈指令。

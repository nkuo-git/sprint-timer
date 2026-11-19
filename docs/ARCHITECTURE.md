# 短跑計時 App：架構與計畫

## 目標
用手機做出接近正式比賽電子計時（FAT）的短跑計時：**成績 = 衝線時間 − 鳴槍時間**，包含反應時間。
iOS 與 Android 都要支援，並提供兩種模式。

## 技術選型
| 項目 | 選擇 | 原因 |
|---|---|---|
| 框架 | React Native + Expo（SDK 58，dev client） | 一份程式碼兩個平台；Expo 可在雲端建置 iOS/Android |
| 相機 | react-native-vision-camera v5 + worklets | 支援指定 fps（120/240）、逐格在原生執行緒處理、每格有硬體時間戳 |
| 時鐘 / 槍聲 | 自寫原生模組 `modules/precision-clock`（Swift / Kotlin） | 需要和相機**同一個時基**的時鐘，以及能回報「槍聲實際從喇叭發出時間」的播放 |
| 兩機通訊 | 區網 UDP（react-native-udp） | 見下方「為什麼不用藍牙」 |
| 口令 | expo-speech（語音合成） | 「各就位／預備」時間不需精準，只有槍聲需要 |

## 時間基準（最關鍵的設計）
所有時間都用同一個單調時鐘（秒，float64）：
- iOS：host time（mach_absolute_time）。AVCapture 影格時間戳、AVAudioTime 都是這個時基。
- Android：`elapsedRealtimeNanos`（CLOCK_BOOTTIME）。相機 `SENSOR_INFO_TIMESTAMP_SOURCE = REALTIME` 時影格時間戳就是它；
  AudioTrack 時間戳是 CLOCK_MONOTONIC，原生端會換算。
- App 會顯示「影格時間 vs 現在時間」的差，若不在 0–300ms 內就警告該手機不可信（少數 Android 相機時間來源是 UNKNOWN）。

## 雙手機模式（最準）
```
起跑手機 A（時鐘 server）                 終點手機 B（client）
  ├ 語音：各就位 → 預備                     ├ 每 8 秒 NTP 式同步（40 次 ping，取 rtt 最小 20% 的中位數）
  ├ 原生排程鳴槍 → 回報實際發聲時間 tGun ──► ├ 收到 tGun（A 時鐘）→ 換算成 B 時鐘
  ├ （選用）相機偵測起動 → 反應時間/搶跑 ──► ├ 240fps 相機偵測軀幹衝線 → tCross（B 時鐘）
  └ 顯示成績                    ◄───────── └ 成績 = tCross − tGun(B)
```
- 時鐘同步：offset = ((t1−t0)+(t2−t3))/2，誤差上限 rtt/2。只取 rtt 最小的樣本，Wi-Fi 下約 0.5–1ms。
- 漂移：手機振盪器 ±10–50ppm，10 分鐘可差 30ms。所以**持續同步**並用加權回歸估計 skew。
- 傳輸延遲不影響成績（傳的是時間戳，不是「現在」訊號）。UDP 掉包用重送 + raceId 去重。
- 反應時間：A 相機在「預備」後先取 0.6 秒當靜止基準，之後畫面變化超過門檻即判定起動；
  扣掉喇叭到跑者的聲音時間。低於 0.100s 判搶跑。**注意：** 正式比賽用起跑器力感測，相機看到動作會較晚（估 20–50ms），所以反應時間標示為參考值；**總成績不受影響**。

### 為什麼不用藍牙
原先討論用藍牙同步。實作時改為區網 UDP（同一 Wi-Fi，或一支手機開熱點）：
1. 跨平台 BLE 需要一支手機當「周邊（peripheral）」，React Native 生態對 iOS+Android peripheral 支援很差。
2. 同步精度取決於來回延遲的最小值與穩定度，Wi-Fi（~3ms）比 BLE 連線間隔（7.5–30ms）好。
3. 100 公尺距離 BLE 也不穩，熱點通常較好。之後若需要，可加 BLE 作為備援傳輸（協定已抽象成 `Msg`）。

## 單手機模式
手機放終點，自己發令並偵測衝線，時間都在同一支手機，不需同步。
- **槍聲（預設）**：成績 = tCross − tGun − 距離/音速（20°C 時 100m 扣 0.291s，可輸入氣溫）。
  ⚠ 手機喇叭在 100m 外可能聽不清楚，可接**有線**喇叭（藍牙喇叭有 100–200ms 不固定延遲，不可用）。
- **閃光（選用）**：手電筒閃一下。光速可忽略，但：手電筒點亮延遲未校正（約數十 ms）、
  視覺反應比聽覺慢 30–50ms、手機背面要朝向起點跑者才看得到（與側拍終點線的擺法衝突）。所以只當備用。

## 衝線偵測（photo-finish 式）
1. 使用者在畫面上設定終點線（紅線）與「軀幹高度帶」（肩到腰），把頭、手、腳排除——規則以軀幹為準。
2. 跑道淨空時學習背景 15 格，之後只分析終點線左右的窄帶。
3. 每一欄算「佔有率」（軀幹帶中與背景差異大的像素比例）。手臂細、佔有率低；軀幹寬、佔有率高，且需連續 ≥6 欄。
4. 每格得到軀幹前緣位置 s（px，終點線 = 0）。s 由負轉正時，用前後 2 格做線性回歸解 s = 0 → **次影格精度**。
5. 模擬測試：240fps 誤差 < 0.83ms、120fps < 1.7ms、60fps < 3.3ms（含雜訊、部分覆蓋像素、手臂在軀幹前）。

### 擺放建議
- 手機架在終點線延長線上、跑道外側，鏡頭垂直對著跑道（側拍），用腳架固定。
- 鎖定曝光/對焦（快速移動時自動曝光會讓背景亮度跳動）。
- 240fps 在 iPhone 後鏡頭普遍支援；**Android 很多機型對「逐格處理」最多只給 60 或 120fps**（240fps 常只限錄影），內插後 60fps 仍有約 ±3ms。

## 預估誤差（雙手機，iPhone 240fps）
| 來源 | 誤差 |
|---|---|
| 時鐘同步 | ±0.5–1ms |
| 衝線內插 | ±0.5–1ms |
| 槍聲發聲時間（iOS 排程 + 系統回報輸出延遲） | ±1–5ms，未校正 |
| rolling shutter（列掃描延遲） | 0–4ms，固定偏差，可校正 |
| **合計** | 約 ±5ms 內，足以判讀到 0.01s |

## 程式結構
```
src/core/          純 TypeScript 演算法（有單元測試，可在 frame processor 執行緒跑）
  clockSync.ts     NTP 式同步 + 漂移模型
  finishLine.ts    衝線偵測與次影格內插
  reaction.ts      起跑動作偵測 / 反應時間
  startSequence.ts 口令排程（預備→鳴槍隨機 1.6–2.6s）
  physics.ts       音速、聲音延遲、正式成績進位
  result.ts        兩種模式的成績計算
  protocol.ts      兩機訊息格式
modules/precision-clock/  原生模組：now()、prepareAudio()、playGunAt()、cameraTimestampSource()
src/camera/        FinishCamera（衝線）、StartCamera（反應時間）
src/net/link.ts    UDP 連線與同步回合
src/screens/       首頁、起跑手機、終點手機、單手機
test/              Vitest 單元測試（含合成影格模擬器）
```

## 雲端建置
- GitHub Actions（`.github/workflows/ci.yml`）：每次 push 跑型別檢查 + 單元測試，並建置 Android APK（Actions 頁面下載）。
- iOS：`ios-eas.yml` 透過 Expo EAS 在雲端 macOS 建置。需要 Apple Developer 帳號（US$99/年）與 Expo 帳號（免費）。

## 待實機驗證 / 下一步
1. 在實機確認相機時間戳與 PrecisionClock 同時基（App 內有警告顯示）。
2. 量測槍聲實際延遲：用另一支手機錄音或高速攝影對照，必要時加校正值。
3. 調整衝線偵測門檻（光線、衣服顏色、陰影）；加入衝線瞬間的截圖供人工確認（像真的 photo-finish 影像）。
4. 閃光模式：用相機偵測手電筒亮起的影格來取得精確閃光時間。
5. 多跑道 / 多人、成績紀錄與匯出。

## 手持＋多人終點（multi-finish）
給沒有腳架、多位跑者同時計時用。程式在 `src/core/lineTracker.ts`、`src/core/multiFinish.ts`。

1. **點一下辨識終點線**：在點擊處附近找「比兩側都亮的細長條」（白線在深色跑道上），沿線往上下延伸並擬合成直線（允許傾斜）。
2. **每格追蹤**：在上一格位置附近重新找線。跑者遮住線時只用露出來的部分；整條被遮住就短暫外推。
   兩腿之間露出的跑道也「比兩側亮」，所以另外檢查亮度是否達到線本身的亮度、線寬是否正常。
3. **穩定取樣**：每格沿著線取一小塊影像（列 = 沿線位置，欄 = 線左右位移），左右手晃已被追線抵銷；
   上下手晃用線兩側的直向亮度輪廓（分道線）比對補償。
4. **背景與前景**：待命前學 0.4 秒，記每個取樣點亮度的最小/最大值；超出範圍的是前景。
5. **終點攝影條**：每格把線上那一欄存起來，橫軸 = 時間，和正式比賽的 photo-finish 影像一樣。
6. **跑者與時間**：線上的前景在「時間 × 位置」連成一塊 = 一位跑者。每列用前後格的身體前緣位置內插出通過時間，
   取軀幹高度帶（身高 15%–50%）的第 25 百分位數，避開伸在前面的手臂。
7. **人工修正**：自動結果是建議值。介面可在終點攝影條上拖曳標記、或補上被擋住的跑者（`FinishSession`）。

模擬結果（360×640、手晃 ±4px、含伸在前面的手臂）：深色/灰色衣服 240fps ≤ 0.8ms、60fps ≤ 1.5ms；白衣服（和白線同色）≤ 3.3ms。
實機會比較差，預估手持 ±5–10ms。

### 已知限制
- 手機要**直拿**，而且仍然要站在終點線的延長線上：偏離延長線時，不同跑道的跑者會有視差誤差，手持無法消除。
- 側拍時相鄰跑道的跑者會互相遮擋。兩人相差不到約 0.06 秒且在畫面上重疊時會被當成一人，需要手動補標記。
  把手機舉高（或站高一點）可以大幅改善。
- 終點線要是「深色地面上的亮線」。沒有畫線的場地暫不支援。
- 還沒在實機上跑過；門檻值（對比、前景亮度差）需要實測調整。

## 手錶版起點機（Wear OS）
Wear OS 手錶可以取代雙手機模式的「起跑手機 A」：喊口令、鳴槍、記下槍聲時刻，並當時鐘 server。終點手機 App 完全不用改，照樣輸入起點機的 IP 連線。
程式在 `wear/`，是和手機 App 分開的原生專案（Kotlin + Compose），獨立安裝（套件名 `com.nkuo.sprinttimer.wear`）。

```
wear/core/   純 Kotlin，有單元測試
  Protocol.kt        和 src/core/protocol.ts 相同的 UDP JSON 訊息
  StartServer.kt     UDP：回 pong（時鐘 server）、記住終點位址、重送
  RaceController.kt  一趟的流程：倒數 → 各就位 → 預備 → 鳴槍 → 等成績
  StartSequence.kt   口令排程（同 src/core/startSequence.ts）
wear/app/    手錶 App
  WifiLink.kt        要求系統打開 Wi-Fi，並把 UDP socket 綁在 Wi-Fi 上
  WatchGun.kt        鳴槍（共用手機的 GunPlayer）
  Speech.kt          語音口令（系統語音合成，沒有該語言時改用提示音）
  Updater.kt         App 內更新：查最新 Release、下載、交給系統安裝
  Ui.kt              畫面（設計稿：Claude Design 畫面 10–15）
modules/precision-clock/android/.../shared/GunPlayer.kt   手機和手錶共用的鳴槍與發聲時刻量測
```

- **連線**：手錶平常靠藍牙走配對手機上網，Wi-Fi 是關的。App 向系統要求 Wi-Fi 網路（`requestNetwork(TRANSPORT_WIFI)`），
  系統才會連上已儲存的 Wi-Fi 或熱點；UDP socket 要綁在這個網路上，否則封包會走藍牙代理，到不了終點手機。
  不透過配對手機、不用藍牙：終點在 100 公尺外，藍牙到不了；而且這樣終點手機是 iPhone 或 Android 都可以。
- **鳴槍時刻**：和手機同一份程式，用 `AudioTrack.getTimestamp()` 量測槍聲第一個樣本實際輸出的時刻。
  強制從手錶本身的喇叭出聲（`setPreferredDevice`）：藍牙耳機／喇叭有不固定的延遲，量到的時間不可信。
- **斷線補送**：手錶 Wi-Fi 天線比手機弱，鳴槍當下可能剛好斷線。鳴槍時間每秒重送一次直到收到成績（最長 10 分鐘），
  終點用 raceId 去重。按了「不等了」之後成績才到，仍會顯示。
- **音量**：手錶喇叭小聲，發令時自動把媒體音量開到最大，離開 App 時還原。
- **App 內更新**：和手機同一套規則（Release 標籤 `build-N` 比大小），下載同一個 Release 裡的 `sprint-timer-wear.apk`，
  用 `PackageInstaller` 交給系統安裝。Android 12 以上，App 更新自己且宣告 `UPDATE_PACKAGES_WITHOUT_USER_ACTION` 時系統可以不跳確認；
  否則會要求確認。有些手錶沒有確認畫面，這時會顯示「更新失敗」，要改用手機的安裝工具。第一次安裝一定要用安裝工具。
- **沒有的功能**：手錶沒有相機，所以沒有反應時間與搶跑判定。
- **Apple Watch**：未做。需要 Apple Developer 帳號才能裝到手錶；而且 watchOS 只允許音訊串流類 App 使用底層網路（UDP），
  一般 App 只能透過配對的 iPhone 中轉（WatchConnectivity），延遲大又不穩，不適合做時鐘同步。

### 待實機驗證
- 手錶喇叭在起跑線旁聽不聽得清楚；鳴槍時刻的量測在手錶上準不準（和手機一樣，用錄音或高速攝影對照）。
- 手錶連終點手機熱點的距離；螢幕關閉（蓋住錶面）時同步是否持續。
- 手錶上有沒有中文語音（沒有時會改用提示音）。
- App 內更新在實體手錶上裝不裝得起來（不同廠牌、不同 Wear OS 版本可能不一樣）。

## 帳號、雲端紀錄、標記跑者

不登入也能計時；登入後成績同步到雲端（Supabase，設定見 `supabase/README.md`）。

- `src/cloud/client.ts`：只用 `fetch` 的 Supabase 用戶端。Email 驗證碼登入（`requestCode` → `verifyCode`）、憑證自動換新、REST 讀寫。沒有用 supabase-js，方便在 Node 測試。
- `src/cloud/profile.ts`：暱稱（檢查、儲存、是否被用掉）、找人（暱稱或完整 Email）、取消標記、刪除帳號。
- `src/records/store.ts`：手機上的紀錄（一個 JSON 檔）。成績一律先存這裡，`dirty` 表示還沒上傳。`myResults()` 合併「自己計時並標記為自己」和「別人標記給我」的成績。
- `src/records/sync.ts`：先上傳 `dirty` 的比賽，再抓雲端的。本機未上傳的修改優先；`rev` 用來避免上傳途中的修改被當成已上傳。
- `src/records/draft.ts`：成績畫面的暫存。每位跑者標記給誰（自己／用戶／只寫名字），同一位跑者重複儲存用同一個成績 id。
- `src/account/service.ts`：把以上串起來給畫面用（登入狀態、暱稱、同步狀態、待上傳數量）。

成績由終點那支手機儲存（雙手機的終點機、單手機）。起點手機與手錶不存。

資料表：`profiles`（暱稱）、`races`（一趟，owner = 計時的人）、`results`（每位跑者一筆，`runner` = 被標記的帳號，`runner_name` = 非用戶的名字）。
權限：計時的人可讀寫整趟；被標記的人只讀得到自己的那一筆和那一趟的日期距離；Email 不對外，只能用完整地址查到對應的暱稱。

測試：`test/cloud.test.ts`、`test/records.test.ts`、`test/account.test.ts` 用 `test/fakeCloud.ts`（照 RLS 規則實作的假雲端）；`scripts/test-db.sh` 在真的 PostgreSQL 上驗證 RLS。

畫面（設計稿 16 到 23）：`src/account/AccountContext.tsx`（`useAccount()`）、`src/screens/Login.tsx`（Email 與驗證碼）、`Nickname.tsx`、`Account.tsx`、`History.tsx`、`src/ui/PickRunner.tsx`（選擇跑者面板與標記膠囊）。
多人成績（`src/ui/HandheldFinish.tsx` 的 `MultiResults`）每次變動都呼叫 `service.saveRace(draft.toRace(...))`；雙手機模式在成績畫面選距離。
`cloud.config.json` 是空的時候，登入入口不顯示，成績只存在手機。

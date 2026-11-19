# 雲端設定（Supabase）

App 的 Email 登入、暱稱、雲端成績都放在一個 Supabase 專案（免費方案即可）。
這個資料夾是那個專案的全部設定；App 端只需要專案網址和公開金鑰（`cloud.config.json`）。

## 功能對應

| 功能 | 做法 |
| --- | --- |
| Email 登入、不用密碼 | Supabase Auth 的 Email OTP：寄 6 位數驗證碼，在 App 輸入 |
| 換手機紀錄帶著走 | 成績存在 `races` / `results`，登入後同步回手機 |
| 暱稱 | `profiles`，不分大小寫不可重複，2 到 16 個字 |
| 把成績標記給別人 | `results.runner` 指向對方帳號；對方只讀得到自己的那一筆 |

權限全部由資料庫的 RLS 規則控管（`migrations/0001_accounts.sql`），`tests/rls_test.sql` 逐項驗證。

## 第一次設定

1. **建立專案**：在 supabase.com 建一個專案，區域選離使用者近的（例如 Tokyo 或 Singapore）。
2. **建立資料表**：SQL Editor 貼上 `migrations/0001_accounts.sql` 整份執行。
3. **寄信設定（必要）**：Authentication › Emails › SMTP Settings，開啟 Custom SMTP。
   Supabase 內建的寄信服務只會寄給專案成員，而且新的免費專案不能改信件內容，所以一定要接自己的寄信服務。
   沒有自己網域的話，最簡單是用一個 Gmail 帳號：
   - 那個 Google 帳號開啟兩步驟驗證，到 https://myaccount.google.com/apppasswords 建一組「應用程式密碼」。
   - Host `smtp.gmail.com`、Port `465`、Username 填完整 Gmail 地址、Password 填應用程式密碼、Sender email 填同一個 Gmail 地址、Sender name 填「短跑計時」。
   - Gmail 每天約可寄 500 封，足夠小規模使用。
4. **信件內容**：Authentication › Emails › Templates，把 **Magic Link** 和 **Confirm signup** 兩個範本都改成：
   - Subject：`短跑計時 驗證碼 {{ .Token }}`
   - Body：`templates/otp.html` 的內容
   第一次登入的人收到的是 Confirm signup，之後收到的是 Magic Link，所以兩個都要改。信裡不放連結，只放驗證碼。
5. **登入選項**：Authentication › Sign In / Providers › Email：
   - Enable Email provider：開
   - Confirm email：開
   - Email OTP Length：`6`
   - Email OTP Expiration：`3600` 秒
6. **寄信頻率**：Authentication › Rate Limits 的 emails per hour 預設 30，人多時再調高。
7. **填入 App**：Project Settings › API 取得 Project URL 和 anon（或 publishable）key，填進專案根目錄的 `cloud.config.json`：
   ```json
   { "url": "https://xxxxxxxx.supabase.co", "key": "..." }
   ```
   這兩個值是公開的，可以進版本庫。**不要**把 service_role / secret key 放進來。

`cloud.config.json` 是空的時候，App 會隱藏登入與同步功能，其餘照常運作。

## 之後修改資料表

新增一個 `migrations/000N_*.sql`，不要改已經套用過的檔案；同時更新 `tests/rls_test.sql`。

## 測試

```bash
# 需要本機有 PostgreSQL，並能以超級使用者連線
PGHOST=localhost PGUSER=postgres PGPASSWORD=postgres bash scripts/test-db.sh
```

會建一個暫時的資料庫，用 `tests/stub_auth.sql` 模擬 Supabase 的 auth 結構，套用 migrations 後跑 `tests/rls_test.sql`。CI 每次都會跑。

## 免費方案的限制

- 專案一週沒有活動可能被暫停。`.github/workflows/cloud-keepalive.yml` 每週兩次送一個小查詢避免這件事；如果還是被暫停，到後台按 Restore。
- 資料庫 500 MB：一筆成績約 200 bytes，足夠存幾十萬筆。衝線照片不上傳。

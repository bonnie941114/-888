# LINE 記帳 Bot

把記帳搬進 LINE 聊天室：傳一句「午餐 150」給官方帳號，就自動記一筆。

## 使用方式（記帳語法）

- `午餐 150` → 台幣 150，分類餐飲
- `日幣 咖哩飯 1200` → 日圓 1200，自動折算台幣
- `昨天 交通 50*2` → 支援加減乘除、支援「今天/明天/後天/昨天/前天」
- `7/5 購物 899` → 指定日期
- 沒分類時直接回傳分類名稱（例如「餐飲」）即可補分類到最近一筆

## 部署步驟

### 1. 設定 Supabase
1. 到 https://supabase.com 用 GitHub 帳號登入，建立新專案
2. 進入專案後到左側「SQL Editor」，貼上 `supabase_schema.sql` 整份內容執行
3. 到「Project Settings → API」，複製：
   - `Project URL` → 對應 `SUPABASE_URL`
   - `service_role` key（不是 anon key）→ 對應 `SUPABASE_SERVICE_ROLE_KEY`

### 2. 推上 GitHub
把這整個資料夾 push 到你現有的 GitHub repo（`.env` 不會被推上去，`.gitignore` 已經排除）。

### 3. 部署到 Vercel
1. 到 https://vercel.com 用 GitHub 帳號登入，選擇「Import」這個 repo
2. 在「Environment Variables」填入四組值（`.env.example` 有列出）：
   - `LINE_CHANNEL_SECRET`
   - `LINE_CHANNEL_ACCESS_TOKEN`
   - `SUPABASE_URL`
   - `SUPABASE_SERVICE_ROLE_KEY`
3. 按 Deploy，完成後會拿到一個網址，例如 `https://your-project.vercel.app`

### 4. 回填 LINE Webhook 網址
到 LINE 官方帳號管理後台（manager.line.biz）→ 設定 → Messaging API，
把 Webhook 網址填成：

```
https://your-project.vercel.app/api/webhook
```

按「儲存」，再把右側的「使用 Webhook」開關打開，並確認「允許加入群組/聊天室」依需求設定。

### 5. 測試
加官方帳號好友，傳一句「午餐 150」，應該會收到記帳成功的回覆。

## 安全提醒

- `LINE_CHANNEL_SECRET` / `LINE_CHANNEL_ACCESS_TOKEN` / `SUPABASE_SERVICE_ROLE_KEY` 這三組都是機密值，
  絕對不要寫死在程式碼或 commit 進 GitHub，只能放在 Vercel 的 Environment Variables。
- 如果不小心在對話或程式碼中洩漏過 Channel Secret，建議到 LINE Developers Console 重新 Issue 一組新的。

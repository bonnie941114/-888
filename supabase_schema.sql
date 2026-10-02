-- ========================================
-- 記帳 LINE Bot — Supabase 資料表設計
-- 到 Supabase 專案後台 -> SQL Editor -> 貼上整段執行即可
-- ========================================

-- 交易紀錄主表
create table if not exists transactions (
  id           bigint generated always as identity primary key,
  client_id    text unique,             -- 網頁版本機產生的唯一ID，用來對應刪除/編輯；LINE記的筆可以是 null
  line_user_id text not null,           -- 記帳者的 LINE user ID（之後要分人記帳就靠這欄）
  date         date not null,           -- 消費日期
  time         text,                    -- 消費時間 HH:MM
  amount_twd   numeric not null,        -- 換算後的台幣金額（主要記帳幣別）
  amount_orig  numeric not null,        -- 原始輸入金額
  currency     text not null default 'TWD', -- 原始幣別：TWD / JPY / USD ...
  category     text,                    -- 分類 id，例如 food, transport
  note         text,                    -- 備註
  account      text default 'cash',     -- 支付方式 id
  tag          text default 'none',     -- 網頁版的標籤欄位
  photo        text,                    -- 網頁版的收據小圖（base64），資料量大時可考慮改存檔案
  created_at   timestamptz not null default now()
);

create index if not exists idx_transactions_user_date
  on transactions (line_user_id, date desc);

-- 使用者設定（例如自訂匯率、預設幣別）
create table if not exists user_settings (
  line_user_id   text primary key,
  display_name   text,
  exchange_rates jsonb not null default '{"JPY": 0.21, "USD": 31.5}'::jsonb,
  created_at     timestamptz not null default now()
);

-- 開放 service role 完整存取（Webhook 後端會用 service_role key，所以不需要額外的 RLS policy）
alter table transactions enable row level security;
alter table user_settings enable row level security;

create policy "service role full access on transactions"
  on transactions for all
  using (true) with check (true);

create policy "service role full access on user_settings"
  on user_settings for all
  using (true) with check (true);

-- 讓網頁版（用 anon key 連線）也能讀寫這張表。
-- ⚠️ 安全提醒：這組 policy 是「只要有這個 Supabase 專案的 anon key 就能讀寫全部資料」，
-- 沒有依照登入身分做隔離。因為目前只有你自己用、網頁也不會公開分享，這樣的風險可接受；
-- 之後如果真的要開放給別人用，要把這條 policy 換成「只能存取自己 line_user_id 的資料」的版本。
grant select, insert, update, delete on transactions to anon;
grant usage, select on sequence transactions_id_seq to anon;

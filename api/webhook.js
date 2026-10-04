const crypto = require("crypto");
const { createClient } = require("@supabase/supabase-js");
const { parseMessage, CATEGORIES, ACCOUNTS } = require("../lib/parser");
const { buildDailySummaryFlex, buildRangeStatsFlex, buildPickStartFlex, buildPickEndFlex } = require("../lib/flexBuilders");
const {
  taiwanNow, taiwanTodayStr, taiwanMonthRange, taiwanTimeStr, isValidYMD, isDateStr, presetRange, pad,
} = require("../lib/time");

// Vercel: 要自己拿「原始 body」驗證 LINE 簽章，所以關掉自動 body parsing
module.exports.config = {
  api: { bodyParser: false },
};

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

function readRawBody(req) {
  return new Promise((resolve, reject) => {
    let data = "";
    req.on("data", (chunk) => (data += chunk));
    req.on("end", () => resolve(data));
    req.on("error", reject);
  });
}

function verifySignature(rawBody, signature) {
  const hash = crypto
    .createHmac("SHA256", process.env.LINE_CHANNEL_SECRET)
    .update(rawBody)
    .digest("base64");
  return hash === signature;
}

async function replyRaw(replyToken, messages) {
  await fetch("https://api.line.me/v2/bot/message/reply", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${process.env.LINE_CHANNEL_ACCESS_TOKEN}`,
    },
    body: JSON.stringify({ replyToken, messages }),
  });
}

async function replyMessage(replyToken, text) {
  await replyRaw(replyToken, [{ type: "text", text }]);
}

// 文字訊息 + 快速回覆按鈕（最多13顆，每顆label不超過20字）
async function replyWithQuickReply(replyToken, text, items) {
  await replyRaw(replyToken, [
    {
      type: "text",
      text,
      quickReply: {
        items: items.slice(0, 13).map((it) => ({
          type: "action",
          action: { type: "postback", label: it.label, data: it.data, displayText: it.label },
        })),
      },
    },
  ]);
}

async function getUserSettings(lineUserId) {
  const { data } = await supabase
    .from("user_settings")
    .select("exchange_rates, monthly_budget")
    .eq("line_user_id", lineUserId)
    .maybeSingle();
  return {
    exchangeRates: data?.exchange_rates || { JPY: 0.21, USD: 31.5 },
    monthlyBudget: data?.monthly_budget != null ? Number(data.monthly_budget) : null,
  };
}

async function setMonthlyBudget(lineUserId, amount) {
  await supabase
    .from("user_settings")
    .upsert({ line_user_id: lineUserId, monthly_budget: amount }, { onConflict: "line_user_id" });
}

// 撈某區間內的所有交易（Supabase 一次最多回 1000 筆，所以分頁撈，查「今年」也不會少算）
async function fetchRowsInRange(lineUserId, start, end) {
  const all = [];
  const size = 1000;
  for (let from = 0; ; from += size) {
    const { data, error } = await supabase
      .from("transactions")
      .select("category, account, amount_twd")
      .eq("line_user_id", lineUserId)
      .gte("date", start)
      .lte("date", end)
      .order("id", { ascending: true })
      .range(from, from + size - 1);
    if (error) throw error;
    all.push(...(data || []));
    if (!data || data.length < size) break;
  }
  return all;
}

// 查詢區間 → 回覆統計卡片（含日曆／常用區間按鈕）
// g: "c" 依分類、"a" 依支付方式；key: 區間名稱代號（month/week/... 或 custom）
async function replyRangeStats(replyToken, lineUserId, g, start, end, key) {
  if (start > end) [start, end] = [end, start];
  const rows = await fetchRowsInRange(lineUserId, start, end);
  await replyRaw(replyToken, [buildRangeStatsFlex({ rows, start, end, key, groupBy: g })]);
}

async function replyPresetStats(replyToken, lineUserId, g, key) {
  const r = presetRange(key);
  if (!r) return;
  await replyRangeStats(replyToken, lineUserId, g, r.start, r.end, key);
}

// 解析手打的區間：10/1~10/15、12/20~1/5（自動跨年）、2025/12/20~2026/1/5
function parseTypedRange(text) {
  const m = text.match(/^(?:(\d{4})[/.])?(\d{1,2})[/.](\d{1,2})\s*(?:~|～|到|-|—|－)\s*(?:(\d{4})[/.])?(\d{1,2})[/.](\d{1,2})$/);
  if (!m) return null;
  const thisYear = taiwanNow().year;
  const m1 = +m[2], d1 = +m[3], m2 = +m[5], d2 = +m[6];
  let y1 = m[1] ? +m[1] : null;
  let y2 = m[4] ? +m[4] : null;
  if (y1 === null && y2 === null) {
    y2 = thisYear;
    y1 = m1 > m2 ? thisYear - 1 : thisYear; // 12/20~1/5 → 去年12月到今年1月
  } else if (y1 === null) {
    y1 = m1 > m2 ? y2 - 1 : y2;
  } else if (y2 === null) {
    y2 = m1 > m2 ? y1 + 1 : y1;
  }
  if (!isValidYMD(y1, m1, d1) || !isValidYMD(y2, m2, d2)) return { error: true };
  let start = `${y1}-${pad(m1)}-${pad(d1)}`;
  let end = `${y2}-${pad(m2)}-${pad(d2)}`;
  if (start > end) [start, end] = [end, start];
  return { start, end };
}

// 文字指令 → 常用區間
const PRESET_COMMANDS = {
  "統計": ["c", "month"], "本月統計": ["c", "month"], "圖表": ["c", "month"], "本月": ["c", "month"],
  "支付方式統計": ["a", "month"], "支付統計": ["a", "month"],
  "本週": ["c", "week"], "本週統計": ["c", "week"], "這週": ["c", "week"],
  "上個月": ["c", "lastmonth"], "上月": ["c", "lastmonth"], "上個月統計": ["c", "lastmonth"], "上月統計": ["c", "lastmonth"],
  "近30天": ["c", "last30"], "近 30 天": ["c", "last30"], "最近30天": ["c", "last30"],
  "今年": ["c", "year"], "今年統計": ["c", "year"],
};
const PICKER_COMMANDS = ["區間", "自訂區間", "選日期", "查區間", "日期區間"];

// 今日結算 + 本月預算剩餘，手動查詢「今日」跟每天自動推播都共用這段邏輯
// 回傳 Flex Message（圖表卡片：預算進度條 + 今日分類長條圖），不是純文字
async function buildDailySummaryFlexForUser(lineUserId) {
  const todayStr = taiwanTodayStr();
  const t = taiwanNow();
  const { start, nextMonthStart: end, daysInMonth } = taiwanMonthRange(t.year, t.month);

  const { data: todayRows } = await supabase
    .from("transactions")
    .select("amount_twd, category")
    .eq("line_user_id", lineUserId)
    .eq("date", todayStr);

  const { data: monthRows } = await supabase
    .from("transactions")
    .select("amount_twd")
    .eq("line_user_id", lineUserId)
    .gte("date", start)
    .lt("date", end);

  const todayTotal = (todayRows || []).reduce((s, r) => s + Number(r.amount_twd), 0);
  const monthTotal = (monthRows || []).reduce((s, r) => s + Number(r.amount_twd), 0);
  const settings = await getUserSettings(lineUserId);
  const daysLeft = daysInMonth - t.day + 1;

  return buildDailySummaryFlex({
    dateStr: todayStr,
    todayTotal,
    todayRows: todayRows || [],
    monthLabel: `${t.year}年${t.month}月`,
    monthTotal,
    budget: settings.monthlyBudget,
    daysLeft,
  });
}

// 這筆記完之後，檢查本月累計是否接近/超過預算，是的話回覆多加一行警示
async function checkBudgetWarning(lineUserId, settings) {
  if (!settings.monthlyBudget) return null;
  const t = taiwanNow();
  const { start, nextMonthStart: end } = taiwanMonthRange(t.year, t.month);

  const { data: monthRows } = await supabase
    .from("transactions")
    .select("amount_twd")
    .eq("line_user_id", lineUserId)
    .gte("date", start)
    .lt("date", end);

  const monthTotal = (monthRows || []).reduce((s, r) => s + Number(r.amount_twd), 0);
  const pct = monthTotal / settings.monthlyBudget;

  if (pct >= 1) {
    return `⚠️ 本月已超支 NT$ ${Math.round(monthTotal - settings.monthlyBudget).toLocaleString()}！`;
  }
  if (pct >= 0.8) {
    return `⚠️ 本月花費已達預算 ${Math.round(pct * 100)}%，剩 NT$ ${Math.round(settings.monthlyBudget - monthTotal).toLocaleString()} 可花`;
  }
  return null;
}

function formatReply(parsed) {
  const catText = parsed.categoryInfo
    ? `${parsed.categoryInfo.icon} ${parsed.categoryInfo.name}`
    : "⚠️ 未分類（可以直接回我分類名稱，例如「餐飲」補分類）";

  const exprText = parsed.isExpr ? `${parsed.exprRaw} = ` : "";
  let amountLine;
  if (parsed.currency === "TWD") {
    amountLine = `台幣 NT$ ${exprText}${parsed.amountTwd.toLocaleString()}`;
  } else {
    amountLine = `${parsed.currencyLabel} ${exprText}${parsed.amountOriginal.toLocaleString()}（折合台幣 NT$ ${parsed.amountTwd.toLocaleString()}）`;
  }

  const accountText = parsed.accountInfo ? `${parsed.accountInfo.icon} ${parsed.accountInfo.name}` : "💴 現金（預設）";

  return (
    `✅ 已記一筆\n` +
    `📅 日期：${parsed.date} ${parsed.dateInfoText}\n` +
    `💰 金額：${amountLine}\n` +
    `🏷️ 分類：${catText}\n` +
    `💳 支付方式：${accountText}\n` +
    `📝 備註：${parsed.note || "（無）"}`
  );
}

module.exports = async (req, res) => {
  if (req.method !== "POST") {
    res.status(200).send("LINE bookkeeping webhook is alive.");
    return;
  }

  const rawBody = await readRawBody(req);
  const signature = req.headers["x-line-signature"];

  if (!signature || !verifySignature(rawBody, signature)) {
    res.status(401).send("Invalid signature");
    return;
  }

  const body = JSON.parse(rawBody);
  const events = body.events || [];

  await Promise.all(
    events.map(async (event) => {
      const lineUserId = event.source.userId;

      // 處理按鈕點擊（分類選擇 / 刪除確認）
      if (event.type === "postback") {
        const data = event.postback.data || "";
        const parts = data.split(":");
        const action = parts[0];

        if (action === "cat") {
          const catId = parts[1];
          const rowId = parts[2];
          const catInfo = CATEGORIES.find((c) => c.id === catId);
          await supabase.from("transactions").update({ category: catId }).eq("id", rowId).eq("line_user_id", lineUserId);
          await replyMessage(event.replyToken, `🏷️ 已設定分類為 ${catInfo ? catInfo.icon + " " + catInfo.name : catId}`);
          return;
        }

        // ── 區間統計相關按鈕 ──
        const g = parts[1] === "a" ? "a" : "c";
        const pickedDate = event.postback.params && event.postback.params.date;

        if (action === "sp") {
          await replyPresetStats(event.replyToken, lineUserId, g, parts[2]);
          return;
        }
        if (action === "st") {
          if (!isDateStr(parts[2]) || !isDateStr(parts[3])) return;
          await replyRangeStats(event.replyToken, lineUserId, g, parts[2], parts[3], parts[4] || "custom");
          return;
        }
        if (action === "ps") {
          if (!isDateStr(pickedDate)) return;
          await replyRaw(event.replyToken, [buildPickEndFlex(g, pickedDate)]);
          return;
        }
        if (action === "pe") {
          if (!isDateStr(parts[2]) || !isDateStr(pickedDate)) return;
          await replyRangeStats(event.replyToken, lineUserId, g, parts[2], pickedDate, "custom");
          return;
        }

        if (action === "del") {
          const rowId = parts[1];
          await supabase.from("transactions").delete().eq("id", rowId).eq("line_user_id", lineUserId);
          await replyMessage(event.replyToken, "🗑️ 已刪除這筆紀錄");
          return;
        }
        return;
      }

      if (event.type !== "message" || event.message.type !== "text") return;

      const text = event.message.text.trim();

      // 指令：統計／本週／上個月／近30天／今年… → 區間統計卡片（附日曆按鈕可換區間）
      if (PRESET_COMMANDS[text]) {
        const [g, key] = PRESET_COMMANDS[text];
        await replyPresetStats(event.replyToken, lineUserId, g, key);
        return;
      }

      // 指令：區間／選日期 → 跳出日曆讓使用者選開始日、結束日
      if (PICKER_COMMANDS.includes(text)) {
        await replyRaw(event.replyToken, [buildPickStartFlex("c")]);
        return;
      }

      // 指令：今日 → 今天花了多少 + 本月預算剩多少（圖表卡片）
      if (text === "今日" || text === "今日結算" || text === "今天") {
        const flexMsg = await buildDailySummaryFlexForUser(lineUserId);
        await replyRaw(event.replyToken, [flexMsg]);
        return;
      }

      // 指令：預算 20000 → 設定本月預算
      const budgetMatch = text.match(/^(?:設定預算|預算)\s*([\d,]+)/);
      if (budgetMatch) {
        const amount = parseInt(budgetMatch[1].replace(/,/g, ""), 10);
        await setMonthlyBudget(lineUserId, amount);
        await replyMessage(event.replyToken, `✅ 已設定本月預算為 NT$ ${amount.toLocaleString()}`);
        return;
      }

      // 指令：10/1~10/15、12/20~1/5、2025/12/20~2026/1/5 → 該區間的統計卡片
      const typedRange = parseTypedRange(text);
      if (typedRange) {
        if (typedRange.error) {
          await replyMessage(event.replyToken, "❌ 日期好像不存在，範例：「10/1~10/15」\n或傳「區間」用日曆選");
          return;
        }
        await replyRangeStats(event.replyToken, lineUserId, "c", typedRange.start, typedRange.end, "custom");
        return;
      }

      // 指令：刪除 → 列出最近5筆，用按鈕選要刪哪一筆
      if (text === "刪除" || text === "刪除紀錄") {
        const { data: recent } = await supabase
          .from("transactions")
          .select("id, date, note, amount_twd, category")
          .eq("line_user_id", lineUserId)
          .order("id", { ascending: false })
          .limit(5);

        if (!recent || recent.length === 0) {
          await replyMessage(event.replyToken, "目前沒有任何紀錄可以刪除。");
          return;
        }

        const items = recent.map((t) => {
          const c = CATEGORIES.find((x) => x.id === t.category);
          const label = `${t.date.slice(5)} ${(t.note || (c ? c.name : "其他")).slice(0, 6)} $${t.amount_twd}`;
          return { label: label.slice(0, 20), data: `del:${t.id}` };
        });
        await replyWithQuickReply(event.replyToken, "點選要刪除的那一筆：", items);
        return;
      }

      // 補分類：如果使用者直接回傳一個分類名稱，補到最近一筆「未分類」紀錄
      const matchedCat = CATEGORIES.find((c) => text === c.name);
      if (matchedCat) {
        const { data: lastTxn } = await supabase
          .from("transactions")
          .select("id")
          .eq("line_user_id", lineUserId)
          .is("category", null)
          .order("id", { ascending: false })
          .limit(1)
          .maybeSingle();

        if (lastTxn) {
          await supabase
            .from("transactions")
            .update({ category: matchedCat.id })
            .eq("id", lastTxn.id);
          await replyMessage(
            event.replyToken,
            `🏷️ 已補分類為 ${matchedCat.icon} ${matchedCat.name}`
          );
          return;
        }
      }

      const settings = await getUserSettings(lineUserId);
      const parsed = parseMessage(text, settings.exchangeRates);

      if (!parsed.ok) {
        await replyMessage(
          event.replyToken,
          "❌ 沒辨識到金額喔！\n格式範例：\n「午餐 150」\n「日幣 咖哩飯 1200」\n「昨天 交通 50*2」\n「悠遊卡 150」（可同時判斷分類跟支付方式）\n\n想刪除紀錄請傳「刪除」\n想看統計請傳「統計」（卡片下方可以直接換區間）\n想用日曆選區間請傳「區間」\n也可以直接打「10/1~10/15」"
        );
        return;
      }

      const { data: inserted } = await supabase
        .from("transactions")
        .insert({
          client_id: "line-" + Date.now() + "-" + Math.floor(Math.random() * 1000),
          line_user_id: lineUserId,
          date: parsed.date,
          time: taiwanTimeStr(),
          amount_twd: parsed.amountTwd,
          amount_orig: parsed.amountOriginal,
          currency: parsed.currency,
          category: parsed.category,
          account: parsed.account || "cash",
          note: parsed.note,
        })
        .select("id")
        .single();

      const budgetWarning = await checkBudgetWarning(lineUserId, settings);
      const replyText = formatReply(parsed) + (budgetWarning ? `\n\n${budgetWarning}` : "");

      // 沒抓到分類的話，跳出分類按鈕讓使用者點選（比打字補分類更方便）
      if (!parsed.category && inserted) {
        const items = CATEGORIES.map((c) => ({
          label: `${c.icon} ${c.name}`,
          data: `cat:${c.id}:${inserted.id}`,
        }));
        await replyWithQuickReply(event.replyToken, replyText + "\n\n請選擇分類：", items);
        return;
      }

      await replyMessage(event.replyToken, replyText);
    })
  );

  res.status(200).json({ ok: true });
};

const crypto = require("crypto");
const { createClient } = require("@supabase/supabase-js");
const { parseMessage, CATEGORIES, ACCOUNTS } = require("../lib/parser");
const { buildDailySummaryFlex } = require("../lib/flexBuilders");
const { taiwanNow, taiwanTodayStr, taiwanMonthRange, taiwanTimeStr } = require("../lib/time");

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

// 建立「本月統計」Flex Message（用色塊模擬長條圖，不需要額外產圖或外部圖片）
// groupBy: "category"（預設）或 "account"
function buildStatsFlex(rows, monthLabel, groupBy) {
  groupBy = groupBy || "category";
  const LIST = groupBy === "account" ? ACCOUNTS : CATEGORIES;
  const keyField = groupBy === "account" ? "account" : "category";
  const fallbackId = groupBy === "account" ? "cash" : "other";

  const totals = {};
  rows.forEach((t) => {
    const key = t[keyField] || fallbackId;
    totals[key] = (totals[key] || 0) + Number(t.amount_twd);
  });
  const total = rows.reduce((s, t) => s + Number(t.amount_twd), 0);

  const arr = Object.keys(totals)
    .map((id) => {
      const c = LIST.find((x) => x.id === id);
      return { id, name: c ? c.name : "其他", icon: c ? c.icon : "❔", color: c ? c.color : "#999999", amount: totals[id] };
    })
    .sort((a, b) => b.amount - a.amount)
    .slice(0, 8);

  const maxAmount = arr.length > 0 ? arr[0].amount : 1;

  const rowsContents = arr.map((item) => {
    const pct = Math.max(4, Math.round((item.amount / maxAmount) * 100)); // 最小4%讓短的也看得到一點顏色
    return {
      type: "box",
      layout: "vertical",
      margin: "md",
      contents: [
        {
          type: "box",
          layout: "horizontal",
          contents: [
            { type: "text", text: `${item.icon} ${item.name}`, size: "sm", flex: 3 },
            { type: "text", text: `NT$${item.amount.toLocaleString()}`, size: "sm", align: "end", flex: 2 },
          ],
        },
        {
          type: "box",
          layout: "vertical",
          height: "8px",
          backgroundColor: "#EEEEEE",
          cornerRadius: "4px",
          margin: "xs",
          contents: [
            {
              type: "box",
              layout: "vertical",
              height: "8px",
              width: `${pct}%`,
              backgroundColor: item.color,
              cornerRadius: "4px",
              contents: [],
            },
          ],
        },
      ],
    };
  });

  const titleSuffix = groupBy === "account" ? "（依支付方式）" : "";

  return {
    type: "flex",
    altText: `${monthLabel} 統計${titleSuffix}：共 NT$${total.toLocaleString()}`,
    contents: {
      type: "bubble",
      header: {
        type: "box",
        layout: "vertical",
        contents: [
          { type: "text", text: `📊 ${monthLabel} 統計${titleSuffix}`, weight: "bold", size: "lg" },
          { type: "text", text: `總支出 NT$ ${total.toLocaleString()}`, size: "sm", color: "#999999" },
        ],
      },
      body: {
        type: "box",
        layout: "vertical",
        contents: rowsContents.length > 0 ? rowsContents : [{ type: "text", text: "這個月還沒有任何紀錄" }],
      },
    },
  };
}

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

      // 指令：統計 → 回傳本月分類長條圖卡片；支付方式統計 → 改依支付方式分組
      if (text === "統計" || text === "本月統計" || text === "圖表" || text === "支付方式統計" || text === "支付統計") {
        const t = taiwanNow();
        const { start, nextMonthStart: end } = taiwanMonthRange(t.year, t.month);
        const groupBy = text.indexOf("支付") !== -1 ? "account" : "category";

        const { data: rows } = await supabase
          .from("transactions")
          .select("category, account, amount_twd")
          .eq("line_user_id", lineUserId)
          .gte("date", start)
          .lt("date", end);

        const flexMsg = buildStatsFlex(rows || [], `${t.year}年${t.month}月`, groupBy);
        await replyRaw(event.replyToken, [flexMsg]);
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

      // 指令：10/1~10/15 或 10/1-10/15 或 10/1到10/15 → 回傳該區間的分類統計圖表卡片
      // （沒寫年份就當作今年；只能查到「今年」的區間，跨年區間請分開查）
      const rangeMatch = text.match(/^(\d{1,2})[/.](\d{1,2})\s*[~到-]\s*(\d{1,2})[/.](\d{1,2})$/);
      if (rangeMatch) {
        const year = taiwanNow().year;
        const p2 = (n) => String(n).padStart(2, "0");
        const mStart = parseInt(rangeMatch[1], 10), dStart = parseInt(rangeMatch[2], 10);
        const mEnd = parseInt(rangeMatch[3], 10), dEnd = parseInt(rangeMatch[4], 10);

        if (mStart < 1 || mStart > 12 || dStart < 1 || dStart > 31 || mEnd < 1 || mEnd > 12 || dEnd < 1 || dEnd > 31) {
          await replyMessage(event.replyToken, "❌ 日期格式看起來怪怪的，範例：「10/1~10/15」");
          return;
        }

        let startDate = `${year}-${p2(mStart)}-${p2(dStart)}`;
        let endDate = `${year}-${p2(mEnd)}-${p2(dEnd)}`;
        if (startDate > endDate) { const tmp = startDate; startDate = endDate; endDate = tmp; } // 容錯：寫反了也幫忙對調

        const { data: rows } = await supabase
          .from("transactions")
          .select("category, account, amount_twd")
          .eq("line_user_id", lineUserId)
          .gte("date", startDate)
          .lte("date", endDate);

        const rangeLabel = `${mStart}/${dStart} ~ ${mEnd}/${dEnd}`;
        const flexMsg = buildStatsFlex(rows || [], rangeLabel);
        await replyRaw(event.replyToken, [flexMsg]);
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
          "❌ 沒辨識到金額喔！\n格式範例：\n「午餐 150」\n「日幣 咖哩飯 1200」\n「昨天 交通 50*2」\n「悠遊卡 150」（可同時判斷分類跟支付方式）\n\n想刪除紀錄請傳「刪除」\n想看本月統計請傳「統計」\n想看支付方式統計請傳「支付方式統計」\n想查特定區間請傳「10/1~10/15」"
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

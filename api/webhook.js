const crypto = require("crypto");
const { createClient } = require("@supabase/supabase-js");
const { parseMessage, CATEGORIES } = require("../lib/parser");

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

function monthRangeOf(date) {
  const y = date.getFullYear();
  const m = date.getMonth() + 1;
  const start = `${y}-${String(m).padStart(2, "0")}-01`;
  const end = new Date(y, m, 1).toISOString().slice(0, 10);
  return { y, m, start, end };
}

// 建立「本月統計」Flex Message（用色塊模擬長條圖，不需要額外產圖或外部圖片）
function buildStatsFlex(rows, monthLabel) {
  const totals = {};
  rows.forEach((t) => {
    totals[t.category || "other"] = (totals[t.category || "other"] || 0) + Number(t.amount_twd);
  });
  const total = rows.reduce((s, t) => s + Number(t.amount_twd), 0);

  const arr = Object.keys(totals)
    .map((catId) => {
      const c = CATEGORIES.find((x) => x.id === catId);
      return { id: catId, name: c ? c.name : "其他", icon: c ? c.icon : "❔", color: c ? c.color : "#999999", amount: totals[catId] };
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

  return {
    type: "flex",
    altText: `${monthLabel} 統計：共 NT$${total.toLocaleString()}`,
    contents: {
      type: "bubble",
      header: {
        type: "box",
        layout: "vertical",
        contents: [
          { type: "text", text: `📊 ${monthLabel} 統計`, weight: "bold", size: "lg" },
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
async function buildDailySummaryText(lineUserId) {
  const now = new Date();
  const todayStr = now.toISOString().slice(0, 10);
  const { y, m, start, end } = monthRangeOf(now);

  const { data: todayRows } = await supabase
    .from("transactions")
    .select("amount_twd")
    .eq("line_user_id", lineUserId)
    .eq("date", todayStr);

  const { data: monthRows } = await supabase
    .from("transactions")
    .select("amount_twd")
    .eq("line_user_id", lineUserId)
    .gte("date", start)
    .lt("date", end);

  const todayTotal = (todayRows || []).reduce((s, t) => s + Number(t.amount_twd), 0);
  const monthTotal = (monthRows || []).reduce((s, t) => s + Number(t.amount_twd), 0);
  const settings = await getUserSettings(lineUserId);

  let lines = [
    `📅 ${todayStr} 今日結算`,
    `今日花費：NT$ ${todayTotal.toLocaleString()}`,
    `本月累計（${y}年${m}月）：NT$ ${monthTotal.toLocaleString()}`,
  ];

  if (settings.monthlyBudget != null) {
    const remain = settings.monthlyBudget - monthTotal;
    const daysInMonth = new Date(y, m, 0).getDate();
    const daysLeft = daysInMonth - now.getDate() + 1;
    const perDay = daysLeft > 0 ? Math.floor(remain / daysLeft) : remain;
    lines.push(`本月預算：NT$ ${settings.monthlyBudget.toLocaleString()}`);
    lines.push(
      remain >= 0
        ? `剩餘可花：NT$ ${remain.toLocaleString()}（剩 ${daysLeft} 天，平均每天可花 NT$ ${perDay.toLocaleString()}）`
        : `⚠️ 已超支 NT$ ${Math.abs(remain).toLocaleString()}`
    );
  } else {
    lines.push("（尚未設定本月預算，傳「預算 20000」即可設定）");
  }

  return lines.join("\n");
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

  return (
    `✅ 已記一筆\n` +
    `📅 日期：${parsed.date} ${parsed.dateInfoText}\n` +
    `💰 金額：${amountLine}\n` +
    `🏷️ 分類：${catText}\n` +
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

      // 指令：統計 → 回傳本月分類長條圖卡片
      if (text === "統計" || text === "本月統計" || text === "圖表") {
        const now = new Date();
        const { y, m, start, end } = monthRangeOf(now);

        const { data: rows } = await supabase
          .from("transactions")
          .select("category, amount_twd")
          .eq("line_user_id", lineUserId)
          .gte("date", start)
          .lt("date", end);

        const flexMsg = buildStatsFlex(rows || [], `${y}年${m}月`);
        await replyRaw(event.replyToken, [flexMsg]);
        return;
      }

      // 指令：今日 → 今天花了多少 + 本月預算剩多少
      if (text === "今日" || text === "今日結算" || text === "今天") {
        await replyMessage(event.replyToken, await buildDailySummaryText(lineUserId));
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
          "❌ 沒辨識到金額喔！\n格式範例：\n「午餐 150」\n「日幣 咖哩飯 1200」\n「昨天 交通 50*2」\n\n想刪除紀錄請傳「刪除」\n想看本月統計請傳「統計」"
        );
        return;
      }

      const { data: inserted } = await supabase
        .from("transactions")
        .insert({
          client_id: "line-" + Date.now() + "-" + Math.floor(Math.random() * 1000),
          line_user_id: lineUserId,
          date: parsed.date,
          time: new Date().toTimeString().slice(0, 5),
          amount_twd: parsed.amountTwd,
          amount_orig: parsed.amountOriginal,
          currency: parsed.currency,
          category: parsed.category,
          note: parsed.note,
        })
        .select("id")
        .single();

      // 沒抓到分類的話，跳出分類按鈕讓使用者點選（比打字補分類更方便）
      if (!parsed.category && inserted) {
        const items = CATEGORIES.map((c) => ({
          label: `${c.icon} ${c.name}`,
          data: `cat:${c.id}:${inserted.id}`,
        }));
        await replyWithQuickReply(event.replyToken, formatReply(parsed) + "\n\n請選擇分類：", items);
        return;
      }

      await replyMessage(event.replyToken, formatReply(parsed));
    })
  );

  res.status(200).json({ ok: true });
};

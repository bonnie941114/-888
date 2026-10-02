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

async function getUserRates(lineUserId) {
  const { data } = await supabase
    .from("user_settings")
    .select("exchange_rates")
    .eq("line_user_id", lineUserId)
    .maybeSingle();
  return data?.exchange_rates || { JPY: 0.21, USD: 31.5 };
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

      const rates = await getUserRates(lineUserId);
      const parsed = parseMessage(text, rates);

      if (!parsed.ok) {
        await replyMessage(
          event.replyToken,
          "❌ 沒辨識到金額喔！\n格式範例：\n「午餐 150」\n「日幣 咖哩飯 1200」\n「昨天 交通 50*2」\n\n想刪除紀錄請傳「刪除」"
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

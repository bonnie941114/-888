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

async function replyMessage(replyToken, text) {
  await fetch("https://api.line.me/v2/bot/message/reply", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${process.env.LINE_CHANNEL_ACCESS_TOKEN}`,
    },
    body: JSON.stringify({
      replyToken,
      messages: [{ type: "text", text }],
    }),
  });
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
      if (event.type !== "message" || event.message.type !== "text") return;

      const lineUserId = event.source.userId;
      const text = event.message.text;

      // 補分類：如果使用者直接回傳一個分類名稱，補到最近一筆「未分類」紀錄
      const matchedCat = CATEGORIES.find((c) => text.trim() === c.name);
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
          "❌ 沒辨識到金額喔！\n格式範例：\n「午餐 150」\n「日幣 咖哩飯 1200」\n「昨天 交通 50*2」"
        );
        return;
      }

      await supabase.from("transactions").insert({
        client_id: "line-" + Date.now() + "-" + Math.floor(Math.random() * 1000),
        line_user_id: lineUserId,
        date: parsed.date,
        time: new Date().toTimeString().slice(0, 5),
        amount_twd: parsed.amountTwd,
        amount_orig: parsed.amountOriginal,
        currency: parsed.currency,
        category: parsed.category,
        note: parsed.note,
      });

      await replyMessage(event.replyToken, formatReply(parsed));
    })
  );

  res.status(200).json({ ok: true });
};

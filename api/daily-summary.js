const { createClient } = require("@supabase/supabase-js");

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

function monthRangeOf(date) {
  const y = date.getFullYear();
  const m = date.getMonth() + 1;
  const start = `${y}-${String(m).padStart(2, "0")}-01`;
  const end = new Date(y, m, 1).toISOString().slice(0, 10);
  return { y, m, start, end };
}

async function getUserSettings(lineUserId) {
  const { data } = await supabase
    .from("user_settings")
    .select("monthly_budget")
    .eq("line_user_id", lineUserId)
    .maybeSingle();
  return { monthlyBudget: data?.monthly_budget != null ? Number(data.monthly_budget) : null };
}

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
    `🌙 ${todayStr} 每日結算`,
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
  }

  return lines.join("\n");
}

async function pushMessage(lineUserId, text) {
  await fetch("https://api.line.me/v2/bot/message/push", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${process.env.LINE_CHANNEL_ACCESS_TOKEN}`,
    },
    body: JSON.stringify({
      to: lineUserId,
      messages: [{ type: "text", text }],
    }),
  });
}

// Vercel Cron 會定時打這支 API（見 vercel.json 的排程設定）
module.exports = async (req, res) => {
  // 保護：避免被外人隨便打這支API亂發推播，Vercel Cron 打進來的請求帶有這個標頭
  const authHeader = req.headers["authorization"];
  if (process.env.CRON_SECRET && authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    res.status(401).send("Unauthorized");
    return;
  }

  // 找出所有曾經記過帳的使用者（去重）
  const { data: rows } = await supabase.from("transactions").select("line_user_id");
  const userIds = [...new Set((rows || []).map((r) => r.line_user_id))];

  for (const uid of userIds) {
    const text = await buildDailySummaryText(uid);
    await pushMessage(uid, text);
  }

  res.status(200).json({ ok: true, sent: userIds.length });
};

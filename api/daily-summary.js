const { createClient } = require("@supabase/supabase-js");
const { buildDailySummaryFlex } = require("../lib/flexBuilders");
const { taiwanNow, taiwanTodayStr, taiwanMonthRange } = require("../lib/time");

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

async function getUserSettings(lineUserId) {
  const { data } = await supabase
    .from("user_settings")
    .select("monthly_budget")
    .eq("line_user_id", lineUserId)
    .maybeSingle();
  return { monthlyBudget: data?.monthly_budget != null ? Number(data.monthly_budget) : null };
}

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

async function pushFlexMessage(lineUserId, flexMsg) {
  await fetch("https://api.line.me/v2/bot/message/push", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${process.env.LINE_CHANNEL_ACCESS_TOKEN}`,
    },
    body: JSON.stringify({
      to: lineUserId,
      messages: [flexMsg],
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
    const flexMsg = await buildDailySummaryFlexForUser(uid);
    await pushFlexMessage(uid, flexMsg);
  }

  res.status(200).json({ ok: true, sent: userIds.length });
};

// 共用的 LINE Flex Message 產生器。
// LINE 沒辦法塞真正的 SVG/Canvas 圖表進訊息，這裡用色塊 + 寬度百分比模擬長條圖／進度條，
// 排版後視覺上就是圖表，不是純文字。

const { CATEGORIES, ACCOUNTS } = require("./parser");

function barColorForPct(pct) {
  if (pct >= 100) return "#C94B4B"; // 超支：紅
  if (pct >= 80) return "#E0A030"; // 接近預算：橘
  return "#4A9B95"; // 正常：主色
}

// 今日結算卡片：今日花費 + 本月預算進度條 + 今日分類小計
// opts: { dateStr, todayTotal, todayRows, monthLabel, monthTotal, budget, daysLeft }
function buildDailySummaryFlex(opts) {
  const { dateStr, todayTotal, todayRows, monthLabel, monthTotal, budget, daysLeft } = opts;

  const bodyContents = [
    {
      type: "box",
      layout: "horizontal",
      contents: [
        { type: "text", text: "今日花費", size: "sm", color: "#999999", flex: 1 },
        { type: "text", text: `NT$ ${todayTotal.toLocaleString()}`, size: "lg", weight: "bold", align: "end", flex: 1 },
      ],
    },
  ];

  if (budget && budget > 0) {
    const pct = Math.min(100, Math.round((monthTotal / budget) * 100));
    const barColor = barColorForPct(pct);
    const remain = budget - monthTotal;
    const perDay = daysLeft > 0 ? Math.floor(remain / daysLeft) : remain;

    bodyContents.push({ type: "separator", margin: "lg" });
    bodyContents.push({
      type: "box",
      layout: "vertical",
      margin: "lg",
      contents: [
        {
          type: "box",
          layout: "horizontal",
          contents: [
            { type: "text", text: `本月累計（${monthLabel}）`, size: "xs", color: "#999999", flex: 3 },
            { type: "text", text: `NT$ ${monthTotal.toLocaleString()}`, size: "xs", align: "end", flex: 2, weight: "bold" },
          ],
        },
        {
          type: "box",
          layout: "vertical",
          height: "10px",
          backgroundColor: "#EEEEEE",
          cornerRadius: "5px",
          margin: "xs",
          contents: [
            {
              type: "box",
              layout: "vertical",
              height: "10px",
              width: `${Math.max(pct, 4)}%`,
              backgroundColor: barColor,
              cornerRadius: "5px",
              contents: [],
            },
          ],
        },
        {
          type: "text",
          text: `本月預算 NT$ ${budget.toLocaleString()}（${pct}%）`,
          size: "xxs",
          color: "#999999",
          margin: "xs",
        },
      ],
    });

    bodyContents.push({
      type: "text",
      margin: "md",
      wrap: true,
      size: "xs",
      weight: "bold",
      color: remain >= 0 ? "#4A9B95" : "#C94B4B",
      text:
        remain >= 0
          ? `剩餘可花 NT$ ${remain.toLocaleString()}（剩 ${daysLeft} 天，平均每天可花 NT$ ${perDay.toLocaleString()}）`
          : `⚠️ 已超支 NT$ ${Math.abs(remain).toLocaleString()}`,
    });
  } else {
    bodyContents.push({
      type: "text",
      margin: "lg",
      size: "xs",
      color: "#999999",
      wrap: true,
      text: "（尚未設定本月預算，傳「預算 20000」即可設定）",
    });
  }

  // 今日分類小計（有紀錄才顯示）
  if (todayRows && todayRows.length > 0) {
    const totals = {};
    todayRows.forEach((t) => {
      const key = t.category || "other";
      totals[key] = (totals[key] || 0) + Number(t.amount_twd);
    });
    const arr = Object.keys(totals)
      .map((catId) => {
        const c = CATEGORIES.find((x) => x.id === catId);
        return {
          name: c ? c.name : "其他",
          icon: c ? c.icon : "❔",
          color: c ? c.color : "#999999",
          amount: totals[catId],
        };
      })
      .sort((a, b) => b.amount - a.amount)
      .slice(0, 5);
    const maxAmt = arr.length > 0 ? arr[0].amount : 1;

    bodyContents.push({ type: "separator", margin: "lg" });
    bodyContents.push({ type: "text", text: "📊 今日分類", size: "xs", color: "#999999", margin: "lg" });

    arr.forEach((item) => {
      const pct = Math.max(4, Math.round((item.amount / maxAmt) * 100));
      bodyContents.push({
        type: "box",
        layout: "vertical",
        margin: "sm",
        contents: [
          {
            type: "box",
            layout: "horizontal",
            contents: [
              { type: "text", text: `${item.icon} ${item.name}`, size: "xs", flex: 3 },
              { type: "text", text: `NT$${item.amount.toLocaleString()}`, size: "xs", align: "end", flex: 2 },
            ],
          },
          {
            type: "box",
            layout: "vertical",
            height: "6px",
            backgroundColor: "#EEEEEE",
            cornerRadius: "3px",
            margin: "xs",
            contents: [
              {
                type: "box",
                layout: "vertical",
                height: "6px",
                width: `${pct}%`,
                backgroundColor: item.color,
                cornerRadius: "3px",
                contents: [],
              },
            ],
          },
        ],
      });
    });
  }

  return {
    type: "flex",
    altText: `🌙 ${dateStr} 每日結算：今日花費 NT$${todayTotal.toLocaleString()}`,
    contents: {
      type: "bubble",
      header: {
        type: "box",
        layout: "vertical",
        contents: [{ type: "text", text: `🌙 ${dateStr} 每日結算`, weight: "bold", size: "lg" }],
      },
      body: { type: "box", layout: "vertical", contents: bodyContents },
    },
  };
}

// ───────── 區間統計（含日曆選擇器）─────────
// postback data 格式（都不含「:」以外的特殊字元，總長遠低於 LINE 的 300 字上限）：
//   sp:<g>:<preset>              點常用區間（本週/本月/上個月…）
//   st:<g>:<start>:<end>:<key>   直接查某區間（切換分類⇄支付方式時用）
//   ps:<g>                       日曆選「開始日」（日期在 postback.params.date）
//   pe:<g>:<start>               日曆選「結束日」
// <g> = c（依分類）或 a（依支付方式）

const {
  taiwanTodayStr, daysBetweenInclusive, formatRangeZh, formatDateZh, RANGE_PRESETS,
} = require("./time");

const MAIN_COLOR = "#4A9B95";
const GROUP_NAME = { c: "分類", a: "支付方式" };

function pickStartAction(g, label) {
  return {
    type: "datetimepicker",
    label: label || "📅 自訂區間",
    data: `ps:${g}`,
    mode: "date",
    initial: taiwanTodayStr(),
  };
}

function pickEndAction(g, start, label) {
  const today = taiwanTodayStr();
  return {
    type: "datetimepicker",
    label: label || "📅 選結束日",
    data: `pe:${g}:${start}`,
    mode: "date",
    initial: today >= start ? today : start,
    min: start,
  };
}

// 統計卡片下方的快速按鈕：自訂區間、常用區間、切換分組
function statsQuickReply(g, start, end, key) {
  const other = g === "c" ? "a" : "c";
  const items = [
    { type: "action", action: pickStartAction(g) },
    ...["week", "month", "lastmonth", "last30", "year"].map((k) => ({
      type: "action",
      action: {
        type: "postback",
        label: RANGE_PRESETS[k].replace(/\s/g, ""),
        data: `sp:${g}:${k}`,
        displayText: `${RANGE_PRESETS[k]}統計`,
      },
    })),
    {
      type: "action",
      action: {
        type: "postback",
        label: `🔄 看${GROUP_NAME[other]}`,
        data: `st:${other}:${start}:${end}:${key}`,
        displayText: `改看${GROUP_NAME[other]}`,
      },
    },
  ];
  return { items };
}

// opts: { rows, start, end, key, groupBy: "c" | "a" }
function buildRangeStatsFlex(opts) {
  const { rows, start, end, key } = opts;
  const g = opts.groupBy === "a" ? "a" : "c";
  const LIST = g === "a" ? ACCOUNTS : CATEGORIES;
  const keyField = g === "a" ? "account" : "category";
  const fallbackId = g === "a" ? "cash" : "other";
  const label = RANGE_PRESETS[key] || RANGE_PRESETS.custom;

  const totals = {};
  rows.forEach((r) => {
    const k = r[keyField] || fallbackId;
    totals[k] = (totals[k] || 0) + Number(r.amount_twd);
  });
  const total = rows.reduce((s, r) => s + Number(r.amount_twd), 0);

  const arr = Object.keys(totals)
    .map((id) => {
      const c = LIST.find((x) => x.id === id);
      return {
        name: c ? c.name : g === "c" ? "未分類" : "其他",
        icon: c ? c.icon : "❔",
        color: (c && c.color) || "#999999",
        amount: totals[id],
      };
    })
    .sort((a, b) => b.amount - a.amount);
  const maxAmount = arr.length > 0 ? arr[0].amount : 1;

  // 日均：只算到今天為止（例如「本月」才過 4 天，就除以 4，不除以 31）
  const today = taiwanTodayStr();
  const avgEnd = end < today ? end : today;
  const avgDays = avgEnd >= start ? daysBetweenInclusive(start, avgEnd) : 0;
  const totalDays = daysBetweenInclusive(start, end);
  const avg = avgDays > 0 ? Math.round(total / avgDays) : null;

  const rowsContents = arr.map((item) => ({
    type: "box",
    layout: "vertical",
    margin: "md",
    contents: [
      {
        type: "box",
        layout: "horizontal",
        contents: [
          { type: "text", text: `${item.icon} ${item.name}`, size: "sm", flex: 5 },
          { type: "text", text: `${total > 0 ? Math.round((item.amount / total) * 100) : 0}%`, size: "xs", color: "#999999", align: "end", flex: 2, gravity: "center" },
          { type: "text", text: `NT$${Math.round(item.amount).toLocaleString()}`, size: "sm", align: "end", flex: 4 },
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
            width: `${Math.max(4, Math.round((item.amount / maxAmount) * 100))}%`,
            backgroundColor: item.color,
            cornerRadius: "4px",
            contents: [],
          },
        ],
      },
    ],
  }));

  const other = g === "c" ? "a" : "c";
  const subLine = [`${rows.length} 筆`];
  if (avg !== null) subLine.push(`日均 NT$ ${avg.toLocaleString()}`);

  return {
    type: "flex",
    altText: `📊 ${label}統計（${formatRangeZh(start, end)}）：共 NT$${Math.round(total).toLocaleString()}`,
    contents: {
      type: "bubble",
      header: {
        type: "box",
        layout: "vertical",
        paddingBottom: "md",
        contents: [
          { type: "text", text: `📊 ${label}統計・依${GROUP_NAME[g]}`, weight: "bold", size: "md" },
          {
            type: "box",
            layout: "horizontal",
            margin: "sm",
            backgroundColor: "#EEF6F5",
            cornerRadius: "6px",
            paddingAll: "8px",
            contents: [
              { type: "text", text: `🗓 ${formatRangeZh(start, end)}`, size: "sm", color: MAIN_COLOR, weight: "bold", wrap: true, flex: 5 },
              { type: "text", text: `${totalDays} 天`, size: "xs", color: MAIN_COLOR, align: "end", gravity: "center", flex: 1 },
            ],
          },
          { type: "text", text: `NT$ ${Math.round(total).toLocaleString()}`, size: "xxl", weight: "bold", margin: "md" },
          { type: "text", text: subLine.join("・"), size: "xs", color: "#999999" },
        ],
      },
      body: {
        type: "box",
        layout: "vertical",
        paddingTop: "none",
        contents: [
          { type: "separator" },
          ...(rowsContents.length > 0
            ? rowsContents
            : [{ type: "text", text: "這段期間沒有任何紀錄", size: "sm", color: "#999999", margin: "lg" }]),
        ],
      },
      footer: {
        type: "box",
        layout: "horizontal",
        spacing: "sm",
        contents: [
          { type: "button", style: "primary", color: MAIN_COLOR, height: "sm", action: pickStartAction(g, "📅 換區間") },
          {
            type: "button",
            style: "secondary",
            height: "sm",
            action: { type: "postback", label: `看${GROUP_NAME[other]}`, data: `st:${other}:${start}:${end}:${key}`, displayText: `改看${GROUP_NAME[other]}` },
          },
        ],
      },
    },
    quickReply: statsQuickReply(g, start, end, key),
  };
}

// 選區間第一步：請使用者選開始日（傳「區間」「選日期」時回這張）
function buildPickStartFlex(g) {
  return {
    type: "flex",
    altText: "📅 請選擇開始日",
    contents: {
      type: "bubble",
      size: "kilo",
      body: {
        type: "box",
        layout: "vertical",
        spacing: "sm",
        contents: [
          { type: "text", text: "📅 查詢日期區間", weight: "bold", size: "md" },
          { type: "text", text: "步驟 1/2：先選開始日", size: "sm", color: "#999999" },
        ],
      },
      footer: {
        type: "box",
        layout: "vertical",
        contents: [{ type: "button", style: "primary", color: MAIN_COLOR, height: "sm", action: pickStartAction(g, "選開始日") }],
      },
    },
    quickReply: { items: [{ type: "action", action: pickStartAction(g, "📅 選開始日") }] },
  };
}

// 選區間第二步：已選開始日，請選結束日
function buildPickEndFlex(g, start) {
  return {
    type: "flex",
    altText: `開始日 ${formatDateZh(start)}，請選結束日`,
    contents: {
      type: "bubble",
      size: "kilo",
      body: {
        type: "box",
        layout: "vertical",
        spacing: "sm",
        contents: [
          { type: "text", text: "📅 查詢日期區間", weight: "bold", size: "md" },
          { type: "text", text: `開始日：${formatDateZh(start)}`, size: "sm", color: MAIN_COLOR, weight: "bold" },
          { type: "text", text: "步驟 2/2：再選結束日", size: "sm", color: "#999999" },
        ],
      },
      footer: {
        type: "box",
        layout: "vertical",
        spacing: "sm",
        contents: [
          { type: "button", style: "primary", color: MAIN_COLOR, height: "sm", action: pickEndAction(g, start, "選結束日") },
          { type: "button", style: "secondary", height: "sm", action: { type: "postback", label: "只看這一天", data: `st:${g}:${start}:${start}:custom`, displayText: "只看這一天" } },
        ],
      },
    },
    quickReply: {
      items: [
        { type: "action", action: pickEndAction(g, start) },
        { type: "action", action: { type: "postback", label: "只看這一天", data: `st:${g}:${start}:${start}:custom`, displayText: "只看這一天" } },
      ],
    },
  };
}

module.exports = { buildDailySummaryFlex, buildRangeStatsFlex, buildPickStartFlex, buildPickEndFlex };

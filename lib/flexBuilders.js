// 共用的 LINE Flex Message 產生器。
// LINE 沒辦法塞真正的 SVG/Canvas 圖表進訊息，這裡用色塊 + 寬度百分比模擬長條圖／進度條，
// 排版後視覺上就是圖表，不是純文字。

const { CATEGORIES } = require("./parser");

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

module.exports = { buildDailySummaryFlex };

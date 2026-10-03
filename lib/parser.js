// 解析使用者傳來的記帳文字，邏輯沿用自原本「金錢豹」網頁版記帳工具，
// 差別是：改成「台幣為主，可切換記錄日圓等外幣」。

const { taiwanTodayAsUTCDate, toDateStrUTC } = require("./time");

const CATEGORIES = [
  {
    id: "food", name: "餐飲", icon: "🍴",
    keywords: ["餐飲","早餐","午餐","晚餐","宵夜","下午茶","飲料","咖啡","手搖","便當","吃飯","聚餐","外送","foodpanda","ubereats","小吃","火鍋","燒肉","早午餐","點心","零食"],
  },
  {
    id: "transport", name: "交通", icon: "🚗",
    keywords: ["交通","捷運","公車","計程車","uber","高鐵","火車","悠遊卡","加油","停車","機票","客運","taxi"],
  },
  {
    id: "stay", name: "住宿", icon: "🛏️",
    keywords: ["住宿","飯店","旅館","民宿","訂房","airbnb"],
  },
  {
    id: "shopping", name: "購物", icon: "🛍️",
    keywords: ["購物","衣服","鞋子","網購","蝦皮","momo","買","包包","化妝品","3c"],
  },
  {
    id: "fun", name: "娛樂", icon: "🎬",
    keywords: ["娛樂","電影","唱歌","ktv","遊戲","展覽","門票","訂閱","netflix","旅遊","玩樂"],
  },
  {
    id: "medical", name: "醫療", icon: "🏥",
    keywords: ["醫療","看醫生","診所","藥局","藥品","掛號","健保","牙醫"],
  },
  {
    id: "education", name: "教育", icon: "📚",
    keywords: ["教育","學費","補習","書籍","課程","文具"],
  },
  {
    id: "daily", name: "日用品", icon: "🏠",
    keywords: ["日用品","衛生紙","清潔","家用","生活用品","超市","全聯","家樂福"],
  },
  {
    id: "pet", name: "寵物", icon: "🐾",
    keywords: ["寵物","貓","狗","飼料","寵物醫院","寵物美容"],
  },
  {
    id: "utility", name: "水電費", icon: "⚡",
    keywords: ["水電費","電費","水費","瓦斯費","房租","管理費"],
  },
  {
    id: "phone", name: "通訊費", icon: "📱",
    keywords: ["通訊費","電信費","手機費","網路費","門號"],
  },
  {
    id: "topup", name: "儲值", icon: "💰",
    keywords: ["儲值","加值","儲值卡","悠遊卡加值","街口儲值"],
  },
];

// 支付方式清單（id/icon/color 跟網頁版 ACCOUNTS 保持一致）
const ACCOUNTS = [
  { id: "easycard", name: "悠遊卡", icon: "🚆", color: "#2A9D8F", keywords: ["悠遊卡"] },
  { id: "jko", name: "街口支付", icon: "🅹", color: "#FF6B6B", keywords: ["街口", "街口支付"] },
  { id: "credit", name: "信用卡", icon: "💳", color: "#6C5CE7", keywords: ["信用卡", "刷卡"] },
  { id: "bank", name: "銀行帳戶", icon: "🏦", color: "#0984E3", keywords: ["銀行", "轉帳", "匯款"] },
  { id: "linepay", name: "LINE Pay", icon: "💬", color: "#00B900", keywords: ["linepay", "line pay", "賴支付"] },
  { id: "cash", name: "現金", icon: "💴", color: "#8D9A9C", keywords: ["現金"] },
];

// 支援的外幣關鍵字 -> 幣別代碼
const CURRENCY_KEYWORDS = [
  { regex: /日幣|日圓|¥|jpy/i, code: "JPY", label: "日圓" },
  { regex: /美金|美元|usd|\$/i, code: "USD", label: "美金" },
];

function pad(n) {
  return String(n).padStart(2, "0");
}
function toDateStr(d) {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

// 安全計算四則運算字串（只允許數字與 + - * /）
function safeCalc(expr) {
  if (!/^[\d.+\-*/\s]+$/.test(expr)) return null;
  try {
    // eslint-disable-next-line no-new-func
    const val = Function(`"use strict"; return (${expr});`)();
    return typeof val === "number" && isFinite(val) ? val : null;
  } catch {
    return null;
  }
}

// 移除看起來像「M/D」「M月D日」的合理日期片段，避免跟金額/運算式搞混
function stripValidDates(text) {
  return text.replace(
    /(?<!\d)(\d{1,2})[月/-](\d{1,2})(?:日)?(?!\d)/g,
    (m, mm, dd) => {
      const mi = parseInt(mm, 10),
        di = parseInt(dd, 10);
      return mi >= 1 && mi <= 12 && di >= 1 && di <= 31 ? " " : m;
    }
  );
}

function extractAmountDetail(text) {
  let clean = stripValidDates(text);
  clean = clean
    .replace(/今天|明天|後天|昨天|前天|台幣|nt|twd|日幣|日圓|美金|美元|usd|元|的/gi, "")
    .trim();
  clean = clean.replace(/,/g, "");

  const exprMatch = clean.match(/\d+(?:\.\d+)?\s*(?:[+\-*/]\s*\d+(?:\.\d+)?\s*)+/);
  if (exprMatch) {
    const val = safeCalc(exprMatch[0]);
    if (val !== null && val > 0) {
      return { value: Math.round(val * 100) / 100, raw: exprMatch[0].trim(), isExpr: true };
    }
  }

  const match = clean.match(/[\d.]+/);
  if (match) return { value: parseFloat(match[0]), raw: match[0], isExpr: false };
  return null;
}

/**
 * 解析一句記帳訊息
 * @param {string} rawInput 使用者傳來的原始文字
 * @param {object} exchangeRates 例如 { JPY: 0.21, USD: 31.5 }，代表 1 單位外幣 = 多少台幣
 */
function parseMessage(rawInput, exchangeRates = { JPY: 0.21, USD: 31.5 }) {
  const text = rawInput.trim().replace(/(\d),(?=\d)/g, "$1");
  // 伺服器預設跑在 UTC，使用者在台灣（UTC+8），這裡統一用台灣時區安全的方式取得「今天」，
  // 避免台灣已經換日、伺服器卻還停在前一天的時差bug
  const realToday = taiwanTodayAsUTCDate();
  let targetDate = toDateStrUTC(realToday);
  let dateInfoText = "";

  if (/今天/.test(text)) {
    dateInfoText = "（今天）";
  } else if (/明天/.test(text)) {
    const d = new Date(realToday);
    d.setUTCDate(d.getUTCDate() + 1);
    targetDate = toDateStrUTC(d);
    dateInfoText = "（明天）";
  } else if (/後天/.test(text)) {
    const d = new Date(realToday);
    d.setUTCDate(d.getUTCDate() + 2);
    targetDate = toDateStrUTC(d);
    dateInfoText = "（後天）";
  } else if (/昨天/.test(text)) {
    const d = new Date(realToday);
    d.setUTCDate(d.getUTCDate() - 1);
    targetDate = toDateStrUTC(d);
    dateInfoText = "（昨天）";
  } else if (/前天/.test(text)) {
    const d = new Date(realToday);
    d.setUTCDate(d.getUTCDate() - 2);
    targetDate = toDateStrUTC(d);
    dateInfoText = "（前天）";
  } else {
    const dateMatch = text.match(/(?<!\d)(\d{1,2})[月/-](\d{1,2})(?!\d)/);
    if (dateMatch) {
      const mNum = parseInt(dateMatch[1], 10),
        dNum = parseInt(dateMatch[2], 10);
      if (mNum >= 1 && mNum <= 12 && dNum >= 1 && dNum <= 31) {
        const year = realToday.getUTCFullYear();
        targetDate = `${year}-${pad(mNum)}-${pad(dNum)}`;
        dateInfoText = `（自動判斷為 ${pad(mNum)}/${pad(dNum)}）`;
      }
    }
  }

  // 判斷幣別：預設台幣，若有關鍵字則視為外幣
  let currency = "TWD";
  let currencyLabel = "台幣";
  for (const c of CURRENCY_KEYWORDS) {
    if (c.regex.test(text)) {
      currency = c.code;
      currencyLabel = c.label;
      break;
    }
  }

  const amountDetail = extractAmountDetail(text);
  if (!amountDetail || amountDetail.value <= 0) {
    return { ok: false, reason: "找不到金額" };
  }
  const rawAmount = amountDetail.value;

  const amountEscaped = amountDetail.raw.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  let note = text
    .replace(/今天|明天|後天|昨天|前天|台幣|nt|twd|日幣|日圓|美金|美元|usd|元|的/gi, "")
    .trim();
  note = stripValidDates(note)
    .replace(new RegExp(amountEscaped, "g"), "")
    .replace(/\s+/g, " ")
    .trim();

  // 關鍵字比對：把所有分類的所有關鍵字攤平，依字串長度由長到短比對，
  // 避免像「早餐」被更短的「餐」或其他分類字詞誤判蓋過。
  let category = null;
  let foundCat = null;
  let matchedKeyword = null;
  const allKeywordPairs = [];
  CATEGORIES.forEach((c) => {
    (c.keywords || [c.name]).forEach((kw) => allKeywordPairs.push({ cat: c, kw }));
  });
  allKeywordPairs.sort((a, b) => b.kw.length - a.kw.length);
  for (const { cat, kw } of allKeywordPairs) {
    if (text.toLowerCase().includes(kw.toLowerCase())) {
      foundCat = cat;
      matchedKeyword = kw;
      break;
    }
  }
  if (foundCat) {
    category = foundCat.id;
    note = note.replace(new RegExp(matchedKeyword, "i"), "").trim();
  }

  // 支付方式關鍵字比對：獨立於分類判斷之外，同一句話可以同時知道「什麼分類」跟「用什麼付款」
  // 例如「悠遊卡 150」會同時判斷出 分類=交通、支付方式=悠遊卡
  let account = null;
  let matchedAccountKeyword = null;
  const allAccountPairs = [];
  ACCOUNTS.forEach((a) => {
    (a.keywords || [a.name]).forEach((kw) => allAccountPairs.push({ acc: a, kw }));
  });
  allAccountPairs.sort((a, b) => b.kw.length - a.kw.length);
  for (const { acc, kw } of allAccountPairs) {
    if (text.toLowerCase().includes(kw.toLowerCase())) {
      account = acc;
      matchedAccountKeyword = kw;
      break;
    }
  }
  if (matchedAccountKeyword) {
    note = note.replace(new RegExp(matchedAccountKeyword, "i"), "").trim();
  }

  const rate = currency === "TWD" ? 1 : exchangeRates[currency] || 1;
  const amountTwd = Math.round(rawAmount * rate);

  return {
    ok: true,
    date: targetDate,
    dateInfoText,
    currency,
    currencyLabel,
    amountOriginal: rawAmount,
    amountTwd,
    isExpr: amountDetail.isExpr,
    exprRaw: amountDetail.raw,
    category,
    categoryInfo: foundCat || null,
    account: account ? account.id : null,
    accountInfo: account,
    note,
  };
}

module.exports = { parseMessage, CATEGORIES, ACCOUNTS };

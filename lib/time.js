// 伺服器（Vercel）執行環境預設是 UTC 時區，但使用者在台灣（UTC+8），兩者差 8 小時。
// 如果直接用 new Date() 的本地 getter 或 toISOString()，台灣這邊已經跨過午夜換日了，
// 伺服器卻還停在「昨天」，要等 UTC 也跨過午夜（也就是台灣時間早上 8 點）日期才會更新。
// 這裡一律用「把目前時間戳位移 8 小時後，再用 UTC accessor 讀值」的方式，
// 不管伺服器實際跑在哪個時區，都能正確算出台灣當下的日期。

function pad(n) {
  return String(n).padStart(2, "0");
}

// 取得台灣當下的年/月(1-indexed)/日
function taiwanNow() {
  const d = new Date(Date.now() + 8 * 60 * 60 * 1000);
  return {
    year: d.getUTCFullYear(),
    month: d.getUTCMonth() + 1,
    day: d.getUTCDate(),
  };
}

function taiwanTodayStr() {
  const t = taiwanNow();
  return `${t.year}-${pad(t.month)}-${pad(t.day)}`;
}

// 回傳一個用 UTC 方式建構、數值對應「台灣當下日期」的 Date 物件。
// 之後要做加減天數，統一用 setUTCDate()，讀值統一用 toDateStrUTC()，
// 這樣不管程式實際跑在哪個時區都不會算錯。
function taiwanTodayAsUTCDate() {
  const t = taiwanNow();
  return new Date(Date.UTC(t.year, t.month - 1, t.day));
}

function toDateStrUTC(d) {
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
}

// 某個台灣年/月的起訖日期字串，以及該月共有幾天
function taiwanMonthRange(year, month) {
  const start = `${year}-${pad(month)}-01`;
  const daysInMonth = new Date(Date.UTC(year, month, 0)).getUTCDate();
  const end = `${year}-${pad(month)}-${pad(daysInMonth)}`; // 含當月最後一天
  const nextMonthStart = new Date(Date.UTC(year, month, 1)).toISOString().slice(0, 10); // 下個月1號，供 .lt() 查詢用
  return { start, end, daysInMonth, nextMonthStart };
}

// 取得台灣當下時間 HH:MM（用來記錄交易的 time 欄位）
function taiwanTimeStr() {
  const d = new Date(Date.now() + 8 * 60 * 60 * 1000);
  return `${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}`;
}

// ───────── 日期區間工具（統計用）─────────
// 一律用 "YYYY-MM-DD" 字串 + UTC 計算，避開伺服器時區問題

function parseDateStr(s) {
  const [y, m, d] = s.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d));
}

function addDays(dateStr, n) {
  const d = parseDateStr(dateStr);
  d.setUTCDate(d.getUTCDate() + n);
  return toDateStrUTC(d);
}

// 兩個日期之間共幾天（含頭尾）
function daysBetweenInclusive(start, end) {
  return Math.round((parseDateStr(end) - parseDateStr(start)) / 86400000) + 1;
}

// 檢查年月日是否真的存在（例如 2/30 會回傳 false）
function isValidYMD(y, m, d) {
  const dt = new Date(Date.UTC(y, m - 1, d));
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d;
}

function isDateStr(s) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s || "")) return false;
  const [y, m, d] = s.split("-").map(Number);
  return isValidYMD(y, m, d);
}

function weekdayZh(dateStr) {
  return "日一二三四五六"[parseDateStr(dateStr).getUTCDay()];
}

// 2026-10-01 → 2026/10/01（四）；showYear=false 時省略年份
function formatDateZh(dateStr, showYear = true) {
  const [y, m, d] = dateStr.split("-");
  return `${showYear ? y + "/" : ""}${m}/${d}（${weekdayZh(dateStr)}）`;
}

// 區間顯示文字，例如「2026/10/01（四）– 10/15（四）」
function formatRangeZh(start, end) {
  if (start === end) return formatDateZh(start);
  const sameYear = start.slice(0, 4) === end.slice(0, 4);
  return `${formatDateZh(start)} – ${formatDateZh(end, !sameYear)}`;
}

// 常用區間的名稱與起訖日（以台灣今天為基準）
const RANGE_PRESETS = {
  week: "本週",
  month: "本月",
  lastmonth: "上個月",
  last30: "近 30 天",
  year: "今年",
  custom: "自訂區間",
};

function presetRange(key) {
  const today = taiwanTodayStr();
  const t = taiwanNow();
  switch (key) {
    case "week": {
      // 週一為一週的開始
      const dow = parseDateStr(today).getUTCDay(); // 0=週日
      const start = addDays(today, dow === 0 ? -6 : 1 - dow);
      return { start, end: addDays(start, 6) };
    }
    case "month": {
      const r = taiwanMonthRange(t.year, t.month);
      return { start: r.start, end: r.end };
    }
    case "lastmonth": {
      const y = t.month === 1 ? t.year - 1 : t.year;
      const m = t.month === 1 ? 12 : t.month - 1;
      const r = taiwanMonthRange(y, m);
      return { start: r.start, end: r.end };
    }
    case "last30":
      return { start: addDays(today, -29), end: today };
    case "year":
      return { start: `${t.year}-01-01`, end: `${t.year}-12-31` };
    default:
      return null;
  }
}

module.exports = {
  pad, taiwanNow, taiwanTodayStr, taiwanTodayAsUTCDate, toDateStrUTC, taiwanMonthRange, taiwanTimeStr,
  addDays, daysBetweenInclusive, isValidYMD, isDateStr, formatDateZh, formatRangeZh, RANGE_PRESETS, presetRange,
};

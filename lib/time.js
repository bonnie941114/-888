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

module.exports = { pad, taiwanNow, taiwanTodayStr, taiwanTodayAsUTCDate, toDateStrUTC, taiwanMonthRange, taiwanTimeStr };

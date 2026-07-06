<!DOCTYPE html>
<html lang="zh-Hant">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no">
<title>日系清爽 · 智慧雙幣對話記帳</title>
<link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.5.2/css/all.min.css">
<style>
  @import url('https://fonts.googleapis.com/css2?family=Manrope:wght@400;600;700;800&family=Noto+Sans+TC:wght@400;500;700&display=swap');
  
  * { box-sizing: border-box; margin: 0; padding: 0; }
  
  :root {
    --bg-page: #FBFBFA;      
    --surface: #FFFFFF;      
    --text-main: #2D3748;    
    --text-muted: #A0AEC0;   
    --border: #EDF2F7; 
    --primary: #9DB4C0;      
    --expense: #C97A7A;      
    
    --line-chat-bg: #F0F2F5;  
    --bot-bubble: #FFFFFF;    
    --user-bubble: #E3F0E5;   
    --user-text: #3B7A57;     
  }
  
  body { font-family: 'Noto Sans TC', sans-serif; color: var(--text-main); background: var(--bg-page); min-height: 100dvh; padding: 24px; }
  .num-font { font-family: 'Manrope', sans-serif; }

  .layout-grid { max-width: 1150px; margin: 0 auto; display: grid; grid-template-columns: 1.3fr 1.1fr; gap: 24px; height: calc(100dvh - 48px); }
  .col { display: flex; flex-direction: column; gap: 20px; height: 100%; }

  .card { background: var(--surface); border-radius: 24px; padding: 24px; border: 1px solid var(--border); box-shadow: 0 10px 30px rgba(0,0,0,0.01); display: flex; flex-direction: column; }
  .card-title { font-size: 16px; font-weight: 700; margin-bottom: 16px; display: flex; align-items: center; justify-content: space-between; flex-shrink: 0; }
  
  .chat-room { flex: 1; background: var(--line-chat-bg); border-radius: 20px; border: 1px solid var(--border); display: flex; flex-direction: column; overflow: hidden; }
  .chat-messages { flex: 1; overflow-y: auto; padding: 16px; display: flex; flex-direction: column; gap: 14px; }
  .chat-messages::-webkit-scrollbar { display: none; }
  
  .msg-row { display: flex; align-items: flex-start; max-width: 85%; }
  .msg-row.bot { align-self: flex-start; gap: 8px; }
  .msg-row.user { align-self: flex-end; flex-direction: row-reverse; }
  
  .bot-avatar { width: 34px; height: 34px; border-radius: 50%; background: var(--primary); color: white; display: flex; align-items: center; justify-content: center; font-size: 14px; flex-shrink: 0; }
  
  .bubble { padding: 10px 14px; border-radius: 16px; font-size: 14px; font-weight: 500; line-height: 1.4; box-shadow: 0 2px 6px rgba(0,0,0,0.02); word-break: break-all; }
  .bot .bubble { background: var(--bot-bubble); color: var(--text-main); border-top-left-radius: 4px; border: 1px solid var(--border); }
  .user .bubble { background: var(--user-bubble); color: var(--user-text); border-top-right-radius: 4px; font-weight: 700; }
  
  .chat-guide-box { display: flex; flex-wrap: wrap; gap: 6px; margin-top: 8px; }
  .guide-btn { background: var(--surface); border: 1px solid var(--border); padding: 7px 14px; border-radius: 12px; font-size: 12px; font-weight: 700; color: var(--text-main); cursor: pointer; }

  .chat-input-bar { background: var(--surface); padding: 12px; border-top: 1px solid var(--border); display: flex; align-items: center; gap: 10px; flex-shrink: 0; }
  .chat-control { flex: 1; border: 1px solid var(--border); border-radius: 20px; padding: 10px 16px; font-size: 14px; background: var(--bg-page); outline: none; font-family: inherit; color: var(--text-main); font-weight: 600; }
  .chat-send-btn { background: none; border: none; color: var(--primary); font-size: 20px; cursor: pointer; padding: 0 4px; }
  .chat-camera-btn { color: var(--text-muted); font-size: 20px; cursor: pointer; }

  .pie-chart-wrapper { display: flex; justify-content: center; align-items: center; min-height: 140px; }
  .log-list { overflow-y: auto; flex: 1; }
  .log-list::-webkit-scrollbar { display: none; }
  .log-item { display: flex; align-items: center; justify-content: space-between; padding: 14px 0; border-bottom: 1px solid var(--border); }
  .log-item:last-child { border-bottom: none; }
  .log-icon-circle { width: 40px; height: 40px; border-radius: 50%; background: #FFF9F3; display: flex; align-items: center; justify-content: center; font-size: 16px; border: 1px solid var(--border); }
  .log-jpy-val { font-size: 15px; font-weight: 800; }
  .log-twd-val { font-size: 11px; color: var(--text-muted); font-weight: 600; }
  .receipt-thumbnail { width: 34px; height: 34px; border-radius: 6px; object-fit: cover; border: 1px solid var(--border); cursor: pointer; }

  #lightbox { display: none; position: fixed; inset: 0; background: rgba(0,0,0,0.8); backdrop-filter: blur(5px); z-index: 100; align-items: center; justify-content: center; }
  #lightbox img { max-width: 90%; max-height: 80vh; border-radius: 12px; }
</style>
</head>
<body>

<div class="layout-grid">
  
  <!-- 左欄：LINE 對話記帳區 -->
  <div class="col">
    <div class="card" style="height: 100%;">
      <div class="card-title">
        <span><i class="fa-regular fa-comment-dots" style="color:var(--primary); font-size:18px; margin-right:6px;"></i> 智慧雙幣偵測聊天室</span>
        <div style="font-size: 12px; color: var(--text-muted);">
          匯率設定：<input type="number" id="rate-setting" value="0.212" step="0.001" style="width:50px; border:none; background:transparent; font-weight:700; color:var(--text-main);" onchange="App.updateRate()">
        </div>
      </div>
      
      <div class="chat-room">
        <div class="chat-messages" id="chat-flow-container">
          <div class="msg-row bot">
            <div class="bot-avatar">🤖</div>
            <div class="bubble">
              嗨！我已升級為<b>智慧雙幣偵測系統</b>模式！<br><br>
              💡 <b>記帳規則：</b><br>
              1. 預設輸入均為 <b>日圓 (¥)</b>。<br>
              2. 語句中若包含「台幣」、「NT」或「twd」，系統會自動識別為 <b>新台幣 (NT$)</b>！<br><br>
              例：<code style="background:#f4f4f4; padding:2px 4px; border-radius:4px;">餐飲 1200 烏龍麵</code> (日幣)<br>
              例：<code style="background:#f4f4f4; padding:2px 4px; border-radius:4px;">購物 150 台幣 貼圖</code> (台幣)
            </div>
          </div>
        </div>
        
        <div class="chat-input-bar">
          <label for="camera-input" class="chat-camera-btn" title="拍攝收據小票">
            <i class="fa-solid fa-camera"></i>
          </label>
          <input type="file" id="camera-input" accept="image/*" capture="environment" style="display:none;" onchange="App.handlePhoto(event)">
          
          <input type="text" id="chat-input-field" class="chat-control" placeholder="傳送訊息記帳..." onkeypress="App.handleKeyPress(event)">
          
          <button class="chat-send-btn" onclick="App.processUserMessage()">
            <i class="fa-solid fa-paper-plane"></i>
          </button>
        </div>
      </div>

    </div>
  </div>

  <!-- 右欄：分析與明細 -->
  <div class="col">
    <div class="card" style="height: 45%;">
      <div class="card-title">
        <span>本月分類統計</span>
        <span class="num-font" style="font-size: 13px; color: var(--expense); font-weight: 700;" id="total-spent-text">總支出：¥ 0</span>
      </div>
      <div class="pie-chart-wrapper">
        <div id="svg-chart-container"></div>
      </div>
    </div>

    <div class="card" style="height: 52%;">
      <div class="card-title">
        <span>本月記帳明細</span>
        <button onclick="App.clearAll()" style="background:none; border:none; color:var(--text-muted); font-size:12px; font-weight:700; cursor:pointer;">清空</button>
      </div>
      <div class="log-list" id="log-container"></div>
    </div>
  </div>

</div>

<div id="lightbox" onclick="this.style.display='none'">
  <img id="lightbox-img" src="">
</div>

<script>
(function () {
  "use strict";

  var CATEGORIES = [
    { id: "food", name: "餐飲", icon: "🍴", color: "#E29578" },
    { id: "transport", name: "交通", icon: "🚗", color: "#84A59D" },
    { id: "stay", name: "住宿", icon: "🛏️", color: "#9D8189" },
    { id: "shopping", name: "購物", icon: "🛍️", color: "#F5CAC3" },
    { id: "fun", name: "娛樂", icon: "🎬", color: "#F6BD60" },
    { id: "medical", name: "醫療", icon: "🏥", color: "#E8AEB2" },
    { id: "education", name: "教育", icon: "📚", color: "#A7BED3" },
    { id: "daily", name: "日用品", icon: "🏠", color: "#D1B394" },
    { id: "pet", name: "寵物", icon: "🐾", color: "#B3C5B1" },
    { id: "utility", name: "水電費", icon: "⚡", color: "#FFE66D" },
    { id: "phone", name: "通訊費", icon: "📱", color: "#A2D2FF" }
  ];

  var ACCOUNTS = [
    { id: "cash", name: "現金" }, { id: "suica", name: "Suica" }, { id: "credit", name: "信用卡" }, 
    { id: "bank", name: "銀行帳戶" }, { id: "linepay", name: "LINE Pay" }
  ];

  var STORAGE_KEY = "line-chat-ledger-v9";
  var state = { txns: [], exchangeRate: 0.212, pendingTxn: null, currentPhoto: null };

  function loadInitial() {
    var val = localStorage.getItem(STORAGE_KEY);
    if (val) {
      try {
        var p = JSON.parse(val);
        if (Array.isArray(p.txns)) state.txns = p.txns;
        if (p.exchangeRate) state.exchangeRate = p.exchangeRate;
      } catch(e){}
    }
    document.getElementById("rate-setting").value = state.exchangeRate;
    renderAll();
  }

  function appendMessage(sender, text, htmlContent) {
    var container = document.getElementById("chat-flow-container");
    var msgRow = document.createElement("div");
    msgRow.className = "msg-row " + sender;
    if (sender === "bot") msgRow.innerHTML = `<div class="bot-avatar">🤖</div><div class="bubble">${text}${htmlContent || ''}</div>`;
    else msgRow.innerHTML = `<div class="bubble">${text}</div>`;
    container.appendChild(msgRow);
    container.scrollTop = container.scrollHeight;
  }

  function renderChart(total) {
    if (total === 0) {
      document.getElementById("svg-chart-container").innerHTML = `<div style="color:var(--text-muted); font-size:13px;">尚無開銷數據</div>`;
      return;
    }
    var catTotals = {};
    state.txns.forEach(t => { catTotals[t.category] = (catTotals[t.category] || 0) + t.amount; });
    var r = 44, c = 2 * Math.PI * r, currentOffset = 0;
    var svgHtml = `<svg width="130" height="130" viewBox="0 0 120 120">`;
    CATEGORIES.forEach(cat => {
      var amt = catTotals[cat.id] || 0;
      if (amt > 0) {
        var pct = amt / total;
        var strokeLength = c * pct;
        var strokeOffset = c - strokeLength + currentOffset;
        svgHtml += `<circle cx="60" cy="60" r="${r}" fill="none" stroke="${cat.color}" stroke-width="12" stroke-dasharray="${c}" stroke-dashoffset="${strokeOffset}" transform="rotate(-90 60 60)"></circle>`;
        currentOffset -= strokeLength;
      }
    });
    svgHtml += `</svg>`;
    document.getElementById("svg-chart-container").innerHTML = svgHtml;
  }

  function renderAll() {
    var totalJpy = state.txns.reduce((s, t) => s + t.amount, 0);
    document.getElementById("total-spent-text").textContent = "總支出：¥ " + totalJpy.toLocaleString();
    renderChart(totalJpy);

    var logHtml = state.txns.map(t => {
      var c = CATEGORIES.find(x => x.id === t.category) || CATEGORIES[7];
      var a = ACCOUNTS.find(x => x.id === t.account) || ACCOUNTS[0];
      var photoHtml = t.photo ? `<img src="${t.photo}" class="receipt-thumbnail" onclick="App.openLightbox('${t.photo}', event)">` : '';
      var payIcon = a.id === 'suica' ? '🐧' : (a.id === 'credit' ? '💳' : (a.id === 'linepay' ? '💬' : '💴'));
      
      return `
        <div class="log-item">
          <div class="log-left">
            <div class="log-icon-circle">${c.icon}</div>
            <div class="log-details">
              <div class="log-title">${t.note ? t.note : c.name}</div>
              <div class="log-subtext">${t.note ? c.name + ' · ' : ''}${payIcon} ${a.name}</div>
            </div>
          </div>
          <div class="log-amount-area">
            ${photoHtml}
            <div>
              <div class="log-jpy-val num-font">¥ ${t.amount.toLocaleString()}</div>
              <div class="log-twd-val num-font">≈ NT$ ${Math.round(t.amount * state.exchangeRate).toLocaleString()}</div>
            </div>
            <button onclick="App.deleteRecord(${t.id})" style="background:none; border:none; color:var(--text-muted); cursor:pointer; font-size:13px; margin-left:4px;"><i class="fa-solid fa-trash-can"></i></button>
          </div>
        </div>
      `;
    }).join("");

    document.getElementById("log-container").innerHTML = logHtml || `<div style="color:var(--text-muted); text-align:center; padding:40px 0; font-size:13px;">本月尚無任何記帳明細</div>`;
  }

  function compressImage(file, callback) {
    var reader = new FileReader();
    reader.onload = e => {
      var img = new Image();
      img.onload = () => {
        var canvas = document.createElement('canvas');
        var ctx = canvas.getContext('2d');
        var MAX_WIDTH = 800;
        var scale = MAX_WIDTH / img.width;
        canvas.width = MAX_WIDTH;
        canvas.height = img.height * scale;
        ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
        callback(canvas.toDataURL('image/jpeg', 0.8));
      };
      img.src = e.target.result;
    };
    reader.readAsDataURL(file);
  }

  window.App = {
    handleKeyPress: e => { if (e.key === "Enter") App.processUserMessage(); },
    updateRate: () => {
      state.exchangeRate = parseFloat(document.getElementById("rate-setting").value) || 0.212;
      localStorage.setItem(STORAGE_KEY, JSON.stringify({ txns: state.txns, exchangeRate: state.exchangeRate }));
      renderAll();
    },
    handlePhoto: e => {
      var file = e.target.files[0];
      if (!file) return;
      compressImage(file, base64 => {
        state.currentPhoto = base64;
        appendMessage("bot", "📸 成功放入明細收據！請輸入金額完成對話。");
      });
    },
    openLightbox: (src, e) => {
      e.stopPropagation();
      document.getElementById("lightbox-img").src = src;
      document.getElementById("lightbox").style.display = "flex";
    },
    processUserMessage: () => {
      var inputEl = document.getElementById("chat-input-field");
      var text = inputEl.value.trim();
      if (!text) return;
      
      appendMessage("user", text);
      inputEl.value = "";

      // 智慧雙幣偵測邏輯
      var isTwd = /台幣|nt|twd/i.test(text);
      
      // 移除台幣關鍵字以利後續數字與分類解析
      var cleanText = text.replace(/台幣|nt|twd/i, "").trim();
      var parts = cleanText.split(/\s+/);
      
      var category = null, rawAmount = null, note = "";

      var foundCat = CATEGORIES.find(c => c.name === parts[0]);
      if (foundCat) {
        category = foundCat.id;
        rawAmount = parseFloat(parts[1]);
        if (parts[2]) note = parts.slice(2).join(" ");
      } else {
        rawAmount = parseFloat(parts[0]);
        if (parts[1]) note = parts.slice(1).join(" ");
      }

      if (isNaN(rawAmount) || rawAmount <= 0) {
        appendMessage("bot", "❌ 辨識失敗。格式請用：`餐飲 1200` 或 `購物 150 台幣`。");
        return;
      }

      // 如果偵測到台幣，自動幫忙除以匯率，反推算回主系統的日幣數值
      var finalJpyAmount = isTwd ? Math.round(rawAmount / state.exchangeRate) : rawAmount;

      state.pendingTxn = { amount: finalJpyAmount, note: note, category: category, account: "cash", photo: state.currentPhoto };
      state.currentPhoto = null;

      if (!category) {
        var guideHtml = `<div class="chat-guide-box">` + CATEGORIES.map(c => `<button class="guide-btn" onclick="App.selectPendingCat('${c.id}')">${c.icon} ${c.name}</button>`).join("") + `</div>`;
        appendMessage("bot", `智慧偵測完成！這筆 <b>${isTwd ? 'NT$' + rawAmount : '¥' + rawAmount}</b> 的消費屬於哪種分類：`, guideHtml);
      } else {
        App.askAccountOrSave();
      }
    },
    selectPendingCat: catId => {
      if (!state.pendingTxn) return;
      state.pendingTxn.category = catId;
      App.askAccountOrSave();
    },
    askAccountOrSave: () => {
      var guideHtml = `<div class="chat-guide-box">` + ACCOUNTS.map(a => `<button class="guide-btn" onclick="App.finalSave('${a.id}')">${a.name}</button>`).join("") + `</div>`;
      appendMessage("bot", `請點選付款帳戶：`, guideHtml);
    },
    finalSave: accountId => {
      if (!state.pendingTxn) return;
      state.pendingTxn.account = accountId;
      var t = state.pendingTxn;
      var c = CATEGORIES.find(x => x.id === t.category);
      
      state.txns.unshift({
        id: Date.now(),
        category: t.category,
        amount: t.amount,
        note: t.note,
        account: t.account,
        photo: t.photo
      });

      localStorage.setItem(STORAGE_KEY, JSON.stringify({ txns: state.txns, exchangeRate: state.exchangeRate }));
      state.pendingTxn = null;

      appendMessage("bot", `✅ 智慧記帳成功！已同步換算雙幣數據並重新更新右欄圖表。`);
      renderAll();
    },
    deleteRecord: id => {
      if (confirm("確定要刪除這筆紀錄嗎？")) {
        state.txns = state.txns.filter(t => t.id !== id);
        localStorage.setItem(STORAGE_KEY, JSON.stringify({ txns: state.txns, exchangeRate: state.exchangeRate }));
        renderAll();
      }
    },
    clearAll: () => {
      if (confirm("確定要格式化清除所有紀錄嗎？")) {
        state.txns = [];
        localStorage.setItem(STORAGE_KEY, JSON.stringify({ txns: [], exchangeRate: state.exchangeRate }));
        renderAll();
      }
    }
  };

  loadInitial();
})();
</script>
</body>
</html>

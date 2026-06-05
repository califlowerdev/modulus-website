/* Modulus Technologies — "Ask Modulus" assistant.
   Self-contained, on every page (injected by site.js). No external services,
   no API keys, no network calls — answers common questions from a local
   knowledge base and hands off to a call/email for anything else.
   Upgradeable later to a real LLM (via a Supabase Edge Function) or Chatbase.
   CSP-safe: same-origin script + an injected <style> (style-src allows inline). */
(function () {
  if (window.__modAsk) return;            // idempotent
  window.__modAsk = true;
  if (document.getElementById("mod-ask")) return;

  var REDUCE = window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  /* ----------------------------- knowledge base ---------------------------- */
  // Prices are kept general on purpose, so the assistant points to the canonical
  // Studio pricing (/studio#pricing) instead of quoting a number.
  var KB = [
    { k: ["what is modulus", "who are you", "what do you do", "what is this", "about modulus", "tell me about"],
      a: "Modulus Technologies builds agentic AI that gives small businesses the leverage big companies have always had. We find the highest-value job in your business, build an AI agent that does it end to end, and keep it improving. Built for operators, not engineers — no setup, no jargon.",
      chips: ["What's Modulus Studio?", "How does it work?", "Book a call"] },

    { k: ["studio", "first product", "repurpose", "repurposing", "content tool", "what product"],
      a: "Modulus Studio is our first product, available now. It turns one talk, sermon, or recording into a month of content — articles, Q&As, key quotes, social posts, and clean transcripts. In your voice, faithful to the source, never fabricated.",
      chips: ["Explore Studio", "See plans", "Is it accurate?"] },

    { k: ["how does it work", "how it works", "process", "steps", "what happens"],
      a: "Three steps: we Consult (find the work agents should do, and the work they shouldn't), Build (a custom agent that fits how you already work), and Run (keep it sharp as you grow). We do the work and hand you the result — it's not another tool to learn.",
      chips: ["What's Modulus Studio?", "Book a call"] },

    { k: ["price", "pricing", "cost", "how much", "plan", "plans", "subscription", "credits", "tier"],
      a: "Modulus Studio runs on simple monthly plans — each gives you a pool of credits you spend generating, repurposing, and transcribing, and they refill every month. You can see the current tiers on the Modulus Studio page. For custom agents or AI strategy, we scope a bespoke engagement on a call.",
      chips: ["See plans", "Book a call"] },

    { k: ["get started", "getting started", "begin", "start", "try", "sign up", "how do i start"],
      a: "Fastest start: book a short call and we'll map one workflow worth automating and show you exactly how it would run — no pitch, just a concrete first move. Or explore Modulus Studio and try it on your own content.",
      chips: ["Book a call", "Explore Studio"] },

    { k: ["api key", "api keys", "openai key", "byok", "bring your own", "managed", "keys"],
      a: "Today, Modulus Studio (the desktop app) works with your own AI key, so you stay in control of cost. A fully managed web version — where you just sign in and use it with no keys at all — is on the way.",
      chips: ["What's Modulus Studio?", "Book a call"] },

    { k: ["accurate", "accuracy", "faithful", "hallucinate", "hallucination", "make up", "fabricate", "trust", "quality"],
      a: "Faithfulness is the whole point. Everything Modulus Studio produces is checked against your source — it won't invent quotes, statistics, or Scripture. What comes out sounds like you and stays true to what you actually said.",
      chips: ["Explore Studio", "Book a call"] },

    { k: ["secure", "security", "privacy", "data", "safe", "gdpr"],
      a: "Your account is protected with industry-standard sign-in, and your content stays yours — we don't sell or train public models on it. The full details are on our Privacy page.",
      chips: ["Privacy", "Book a call"] },

    { k: ["download", "windows", "install", "mac", "app"],
      a: "Modulus Studio is a Windows desktop app (Windows 10/11) that updates itself automatically. Head to the Studio page to get it and sign in with your Modulus account.",
      chips: ["Explore Studio", "Book a call"] },

    { k: ["founder", "james", "who built", "who made", "story", "owner"],
      a: "Modulus is founded by James Denham, building in the open for the businesses everyone else overlooks. There's a first-person story on the About page.",
      chips: ["About", "Book a call"] },

    { k: ["contact", "talk to", "human", "demo", "email", "call", "reach", "support", "help"],
      a: "Happy to connect you with a human. The best move is a quick call, or email jamesdenhamiv@gmail.com and we'll get right back to you.",
      chips: ["Book a call", "Email us"] },

    { k: ["who is it for", "audience", "small business", "smb", "right for me", "fit", "publisher", "podcast", "ministry", "author", "creator"],
      a: "Modulus is built for operators of small and growing businesses — founders, creators, publishers, podcasters, ministries, authors — who have more work than hands and don't want to manage engineers to fix that.",
      chips: ["What's Modulus Studio?", "Book a call"] }
  ];

  var GREET = "Hi — I'm the Modulus assistant. Ask me anything about Modulus or Modulus Studio, or tap a question below.";
  var GREET_CHIPS = ["What is Modulus?", "What's Modulus Studio?", "How much does it cost?", "How do I get started?"];

  // Chips that navigate rather than re-ask.
  var GO = {
    "Book a call": "/contact", "Explore Studio": "/studio", "See plans": "/studio#pricing",
    "About": "/about", "Privacy": "/privacy", "Email us": "mailto:jamesdenhamiv@gmail.com"
  };

  function norm(s) { return (" " + s.toLowerCase().replace(/[^a-z0-9\s]/g, " ") + " ").replace(/\s+/g, " "); }
  function match(text) {
    var t = norm(text), best = null, bestScore = 0;
    for (var i = 0; i < KB.length; i++) {
      var score = 0, keys = KB[i].k;
      for (var j = 0; j < keys.length; j++) {
        if (t.indexOf(" " + keys[j] + " ") !== -1 || t.indexOf(keys[j]) !== -1) score += keys[j].length;
      }
      if (score > bestScore) { bestScore = score; best = KB[i]; }
    }
    if (best) return best;
    return { a: "Good question — I don't have a canned answer for that one yet. The fastest way to a precise answer is a quick call, or email jamesdenhamiv@gmail.com.",
             chips: ["Book a call", "Email us"] };
  }

  /* -------------------------------- styles --------------------------------- */
  var css = '' +
    '#mod-ask,#mod-ask *{box-sizing:border-box}' +
    '#mod-ask{position:fixed;right:20px;bottom:20px;z-index:2147480000;font-family:Inter,system-ui,-apple-system,sans-serif}' +
    '#mod-ask-btn{display:flex;align-items:center;gap:9px;border:0;cursor:pointer;background:#0C1B2E;color:#fff;' +
      'padding:13px 18px;border-radius:999px;box-shadow:0 14px 34px -12px rgba(11,27,46,.55);font-size:14.5px;font-weight:600;' +
      'transition:transform .18s ease,box-shadow .18s ease}' +
    '#mod-ask-btn:hover{transform:translateY(-2px);box-shadow:0 20px 44px -14px rgba(11,27,46,.6)}' +
    '#mod-ask-btn svg{width:20px;height:20px}' +
    '#mod-ask-btn .dot{width:8px;height:8px;border-radius:50%;background:#C8A75B;box-shadow:0 0 0 0 rgba(200,167,91,.6)}' +
    (REDUCE ? '' : '#mod-ask-btn .dot{animation:modPulse 2.4s infinite}@keyframes modPulse{0%{box-shadow:0 0 0 0 rgba(200,167,91,.5)}70%{box-shadow:0 0 0 9px rgba(200,167,91,0)}100%{box-shadow:0 0 0 0 rgba(200,167,91,0)}}') +
    '#mod-ask-panel{position:fixed;right:20px;bottom:20px;width:380px;max-width:calc(100vw - 32px);height:560px;max-height:calc(100vh - 40px);' +
      'background:#fff;border:1px solid #e7e3da;border-radius:20px;box-shadow:0 40px 90px -36px rgba(11,27,46,.5);' +
      'display:none;flex-direction:column;overflow:hidden}' +
    '#mod-ask.open #mod-ask-panel{display:flex}#mod-ask.open #mod-ask-btn{display:none}' +
    (REDUCE ? '' : '#mod-ask.open #mod-ask-panel{animation:modUp .22s ease}@keyframes modUp{from{opacity:0;transform:translateY(12px)}to{opacity:1;transform:none}}') +
    '.mod-hd{display:flex;align-items:center;gap:11px;padding:15px 16px;background:#0C1B2E;color:#fff}' +
    '.mod-hd img{width:30px;height:30px;border-radius:8px}' +
    '.mod-hd .t{font-family:"Playfair Display",Georgia,serif;font-size:17px;font-weight:600;line-height:1.1}' +
    '.mod-hd .s{font-size:11.5px;color:#aab4c0;margin-top:1px}' +
    '.mod-hd .x{margin-left:auto;background:transparent;border:0;color:#aab4c0;cursor:pointer;font-size:22px;line-height:1;padding:4px 6px;border-radius:8px}' +
    '.mod-hd .x:hover{color:#fff;background:rgba(255,255,255,.1)}' +
    '.mod-body{flex:1;overflow-y:auto;padding:16px;background:#faf8f4;display:flex;flex-direction:column;gap:10px}' +
    '.mod-msg{max-width:84%;padding:11px 14px;border-radius:15px;font-size:14px;line-height:1.5;white-space:pre-wrap}' +
    '.mod-msg.bot{background:#fff;border:1px solid #ece8df;color:#1a1d24;align-self:flex-start;border-bottom-left-radius:5px}' +
    '.mod-msg.me{background:#0C1B2E;color:#fff;align-self:flex-end;border-bottom-right-radius:5px}' +
    '.mod-chips{display:flex;flex-wrap:wrap;gap:7px;margin-top:2px}' +
    '.mod-chip{background:#fff;border:1px solid #d9cfb6;color:#7a6020;font-size:12.5px;font-weight:600;padding:7px 12px;border-radius:999px;cursor:pointer;transition:background .15s,border-color .15s}' +
    '.mod-chip:hover{background:#faf4e6;border-color:#C8A75B}' +
    '.mod-foot{display:flex;gap:8px;padding:12px;border-top:1px solid #ece8df;background:#fff}' +
    '.mod-foot input{flex:1;border:1px solid #ddd7cc;border-radius:999px;padding:11px 15px;font:inherit;font-size:14px;outline:none}' +
    '.mod-foot input:focus{border-color:#C8A75B}' +
    '.mod-foot button{border:0;background:#C8A75B;color:#0C1B2E;font-weight:700;border-radius:999px;padding:0 18px;cursor:pointer;font-size:14px}' +
    '.mod-foot button:hover{background:#d4b66e}' +
    '.mod-typing{display:flex;gap:4px;align-self:flex-start;background:#fff;border:1px solid #ece8df;padding:13px 15px;border-radius:15px;border-bottom-left-radius:5px}' +
    '.mod-typing i{width:7px;height:7px;border-radius:50%;background:#b9c2cc;display:block}' +
    (REDUCE ? '' : '.mod-typing i{animation:modBlink 1.2s infinite}.mod-typing i:nth-child(2){animation-delay:.2s}.mod-typing i:nth-child(3){animation-delay:.4s}@keyframes modBlink{0%,60%,100%{opacity:.3}30%{opacity:1}}') +
    '@media (max-width:480px){#mod-ask-panel{right:8px;bottom:8px;width:calc(100vw - 16px);height:calc(100vh - 16px);max-height:none}}';
  var style = document.createElement("style"); style.id = "mod-ask-style"; style.textContent = css;
  document.head.appendChild(style);

  /* --------------------------------- DOM ----------------------------------- */
  var root = document.createElement("div");
  root.id = "mod-ask";
  root.innerHTML =
    '<button id="mod-ask-btn" aria-label="Ask Modulus">' +
      '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M21 11.5a8.38 8.38 0 0 1-8.5 8.5 8.5 8.5 0 0 1-3.8-.9L3 21l1.9-5.7a8.5 8.5 0 0 1 3.1-11.6 8.38 8.38 0 0 1 12 7.8z"/></svg>' +
      '<span>Ask Modulus</span><span class="dot" aria-hidden="true"></span>' +
    '</button>' +
    '<section id="mod-ask-panel" role="dialog" aria-label="Ask Modulus assistant" aria-modal="false">' +
      '<header class="mod-hd">' +
        '<img src="assets/modulus-mark.png" alt="" />' +
        '<div><div class="t">Ask Modulus</div><div class="s">Answers common questions instantly</div></div>' +
        '<button class="x" aria-label="Close">×</button>' +
      '</header>' +
      '<div class="mod-body" id="mod-ask-body"></div>' +
      '<form class="mod-foot" id="mod-ask-form">' +
        '<input id="mod-ask-input" type="text" autocomplete="off" placeholder="Ask a question…" aria-label="Type your question" />' +
        '<button type="submit">Send</button>' +
      '</form>' +
    '</section>';
  document.body.appendChild(root);

  var btn = root.querySelector("#mod-ask-btn");
  var panel = root.querySelector("#mod-ask-panel");
  var body = root.querySelector("#mod-ask-body");
  var form = root.querySelector("#mod-ask-form");
  var input = root.querySelector("#mod-ask-input");
  var greeted = false;

  function esc(s) { var d = document.createElement("div"); d.textContent = s; return d.innerHTML; }
  function scrollDown() { body.scrollTop = body.scrollHeight; }

  function addMsg(text, who) {
    var m = document.createElement("div");
    m.className = "mod-msg " + (who === "me" ? "me" : "bot");
    m.innerHTML = esc(text);
    body.appendChild(m); scrollDown();
  }
  function addChips(list) {
    if (!list || !list.length) return;
    var wrap = document.createElement("div"); wrap.className = "mod-chips";
    list.forEach(function (label) {
      var c = document.createElement("button"); c.type = "button"; c.className = "mod-chip"; c.textContent = label;
      c.addEventListener("click", function () {
        if (GO[label]) {
          if (GO[label].indexOf("mailto:") === 0) window.location.href = GO[label];
          else window.location.assign(GO[label]);
          return;
        }
        send(label);
      });
      wrap.appendChild(c);
    });
    body.appendChild(wrap); scrollDown();
  }
  function typing(on) {
    var ex = body.querySelector(".mod-typing");
    if (on) { if (!ex) { var t = document.createElement("div"); t.className = "mod-typing"; t.innerHTML = "<i></i><i></i><i></i>"; body.appendChild(t); scrollDown(); } }
    else if (ex) { ex.remove(); }
  }
  // Real-AI upgrade: set AI_ENDPOINT to the deployed Supabase "ask" function URL
  // (https://deypezfcawzdcfhnckxp.supabase.co/functions/v1/ask) to answer with a
  // real LLM. On ANY error/timeout it falls back to the local knowledge base, so
  // the widget never breaks. Empty = local KB only (current live behavior).
  var AI_ENDPOINT = "https://deypezfcawzdcfhnckxp.supabase.co/functions/v1/ask";
  var convo = [];

  function fetchAI(text) {
    var ctrl = new AbortController();
    var to = setTimeout(function () { ctrl.abort(); }, 15000);
    return fetch(AI_ENDPOINT, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ q: text, history: convo.slice(-6) }),
      signal: ctrl.signal
    }).then(function (r) { return r.ok ? r.json() : null; })
      .then(function (d) { return d && d.answer ? d.answer : null; })
      .catch(function () { return null; })
      .then(function (ans) { clearTimeout(to); return ans; });
  }
  function showBot(text, chips) { typing(false); addMsg(text, "bot"); addChips(chips); }
  function kbAnswer(text) { var r = match(text); return { a: r.a, chips: r.chips || GREET_CHIPS }; }

  function respond(text) {
    typing(true);
    if (AI_ENDPOINT) {
      fetchAI(text).then(function (ans) {
        if (ans) { convo.push({ role: "assistant", content: ans }); showBot(ans, ["See plans", "Book a call"]); }
        else { var k = kbAnswer(text); showBot(k.a, k.chips); }   // graceful fallback to local KB
      });
    } else {
      setTimeout(function () { var k = kbAnswer(text); showBot(k.a, k.chips); }, REDUCE ? 220 : 560);
    }
  }
  function send(text) {
    text = (text || "").trim(); if (!text) return;
    addMsg(text, "me");
    convo.push({ role: "user", content: text });
    input.value = "";
    respond(text);
  }
  function open() {
    root.classList.add("open");
    if (!greeted) { greeted = true; addMsg(GREET, "bot"); addChips(GREET_CHIPS); }
    setTimeout(function () { input.focus(); }, 60);
  }
  function close() { root.classList.remove("open"); btn.focus(); }

  btn.addEventListener("click", open);
  root.querySelector(".mod-hd .x").addEventListener("click", close);
  form.addEventListener("submit", function (e) { e.preventDefault(); send(input.value); });
  document.addEventListener("keydown", function (e) { if (e.key === "Escape" && root.classList.contains("open")) close(); });
})();

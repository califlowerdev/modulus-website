/* Modulus Technologies — "Ask Modulus" assistant (v2, rebuilt 2026-06-11).
   Self-contained widget injected on every page by site.js.

   How it answers:
   1. If AI_ENDPOINT is set, the question (plus recent turns) goes to our own
      Supabase "ask" Edge Function for a real LLM reply. The endpoint returns
      503 not_configured until the OPENROUTER_API_KEY secret is set — so on
      ANY error/timeout we fall back to the local knowledge base and remember
      the failure for 10 minutes to skip pointless retries.
   2. The local KB answers the common questions itself. Plan prices are read
      LIVE from window.MODULUS_PLANS (site.js — the single source of truth),
      so the assistant can quote real numbers without ever drifting from the
      pricing cards.

   Mobile: ≤640px the launcher is a round FAB and the panel is a full-screen
   sheet (100dvh, safe-area aware, 16px input so iOS never zoom-jumps).
   CSP-safe: same-origin script + injected <style>; the only network call is
   the same-origin-allowed Supabase function. No third-party scripts. */
(function () {
  if (window.__modAsk) return;            // idempotent
  window.__modAsk = true;
  if (document.getElementById("mod-ask")) return;

  var REDUCE = window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  var SECTION = document.body.getAttribute("data-section") || "";
  var IS_STUDIO_WORLD = SECTION === "studio" || SECTION === "app";

  /* ------------------------- live pricing (no drift) ------------------------ */
  function plans() { return window.MODULUS_PLANS || null; }
  function priceLine() {
    var p = plans();
    if (!p || !p.starter) return "Simple monthly plans, each with a pool of credits that refills every month. See the current tiers on the [pricing page](/studio#pricing).";
    return "Three plans, each with a monthly pool of credits that refills:\n" +
      "• Starter: " + p.starter.price + "/mo, " + p.starter.credits + " credits. For the solo creator.\n" +
      "• Pro: " + p.pro.price + "/mo, " + p.pro.credits + " credits. The most popular.\n" +
      "• Studio: " + p.studio.price + "/mo, " + p.studio.credits + " credits. For teams and high volume.\n" +
      "You can cancel anytime. Full details at [Studio pricing](/studio#pricing).";
  }

  /* ----------------------------- knowledge base ---------------------------- */
  // a: answer (supports [label](href) links and \n line breaks)
  // k: match keywords · boost: strong phrases · chips: follow-ups
  var KB = [
    { id: "modulus",
      k: ["what is modulus", "who are you", "about modulus", "what do you do", "company", "tell me about", "what is this site"],
      boost: ["what is modulus"],
      a: "Modulus Technologies builds agentic AI that gives small businesses the leverage big companies have always had. We find the highest-value job in your business, build an AI agent that does it end to end, and keep it improving. Built for operators, not engineers.\n\nOur first product is [Modulus Studio](/studio).",
      chips: ["What's Modulus Studio?", "How much does it cost?", "Book a call"] },

    { id: "studio",
      k: ["studio", "first product", "repurpose", "repurposer", "content tool", "what product", "desktop app", "month of content"],
      boost: ["modulus studio", "what's modulus studio"],
      a: "Modulus Studio turns one talk, sermon, or recording into a month of content: articles, Q&As, key quotes, social posts, and clean transcripts. In your voice, faithful to the source, never fabricated.\n\nIt's a premium Windows desktop app, available now. [Create your free account](/login?mode=create) and you get 25 credits to try everything.",
      chips: ["How much does it cost?", "Is it accurate?", "Download for Windows"] },

    { id: "pricing",
      k: ["price", "pricing", "cost", "how much", "plan", "plans", "subscription", "tier", "pay", "monthly", "cheap", "expensive"],
      boost: ["how much does it cost", "how much is it"],
      a: function () { return priceLine(); },
      chips: ["What's a credit?", "Can I cancel anytime?", "See plans"] },

    { id: "credits",
      k: ["credit", "credits", "what's a credit", "usage", "allowance", "run out", "top up", "refill", "limit"],
      boost: ["what's a credit", "what is a credit"],
      a: "A credit is a unit of usage. Generating, repurposing, and transcribing each spend a few. Your plan gives you a monthly pool that refills automatically, and if you run out you can add a top-up pack or just wait for the refill. No surprise bills.",
      chips: ["How much does it cost?", "See plans"] },

    { id: "accuracy",
      k: ["accurate", "accuracy", "faithful", "hallucinate", "hallucination", "make up", "makes things up", "fabricate", "invent", "trust", "quality", "quote", "quotes", "wrong"],
      boost: ["is it accurate", "does it hallucinate"],
      a: "Faithfulness is the whole point. Studio works only from your source, then a separate verification pass re-reads every draft against it. Quotes have to exist in the source, claims have to trace back, and your voice has to survive. Nothing gets invented.\n\nThe founder wrote up exactly how this works: [why Studio checks every draft](/insights/source-faithful-ai).",
      chips: ["What's Modulus Studio?", "Who is it for?", "Request early access"] },

    { id: "ministry",
      k: ["church", "ministry", "ministries", "sermon", "sermons", "pastor", "scripture", "bible", "doctrine", "doctrinal", "theological", "christian", "faith"],
      boost: ["for churches", "for ministries"],
      a: "Churches and Christian publishers are a core audience. Beyond the standard source checks, theological content gets an additional doctrinal alignment review that checks drafts for consistency with the source material. Misrepresenting what a pastor taught is serious, so for that audience the extra pass isn't optional.\n\nMore on the approach: [why Studio checks every draft](/insights/source-faithful-ai).",
      chips: ["How much does it cost?", "Request early access"] },

    { id: "how",
      k: ["how does it work", "how it works", "process", "steps", "what happens", "workflow"],
      boost: ["how does it work"],
      a: "For Modulus Studio: add your source (audio, PDF, or text) → pick what to make (article, Q&A, quotes, social) → publish with confidence, because every draft is verified against your source.\n\nFor custom work, we Consult (find the right job for an agent), Build (an agent that fits how you already work), and Run (keep it sharp as you grow).",
      chips: ["What's Modulus Studio?", "Do you build custom agents?", "Book a call"] },

    { id: "transcribe",
      k: ["transcribe", "transcript", "transcription", "audio", "recording", "podcast", "captions", "subtitles", "mp3", "hour"],
      boost: ["transcription"],
      a: "Studio includes studio-grade transcription. Hours of audio become clean, accurate, searchable text. It's built to chew through full-length sermons and podcasts, then hand off to the Repurposer in one click.",
      chips: ["What's Modulus Studio?", "How much does it cost?"] },

    { id: "start",
      k: ["get started", "getting started", "begin", "start", "try", "trial", "sign up", "signup", "how do i start", "early access", "access", "waitlist", "join"],
      boost: ["how do i get started", "request early access"],
      a: "Easy: [create your free account](/login?mode=create), and 25 credits come with it so you can genuinely try everything. Then [download Modulus Studio for Windows](/download), sign in, and you're making content in minutes. Upgrade to a monthly plan whenever the trial credits run low.\n\nWant something custom for your business instead? [Book a short call](/contact) and we'll map one workflow worth automating. No pitch, just a concrete first move.",
      chips: ["Download for Windows", "How much does it cost?", "See plans"] },

    { id: "download",
      k: ["download", "install", "windows", "mac", "apple", "linux", "app store", "where do i get"],
      boost: ["download for windows"],
      a: "Modulus Studio runs on Windows 10/11 and updates itself automatically, with Mac on the roadmap. [Download it here](/download), sign in with your Modulus account, and you're set. Heads up: on the very first install Windows may ask you to confirm; click More info, then Run anyway.",
      chips: ["Download for Windows", "How much does it cost?"] },

    { id: "cancel",
      k: ["cancel", "cancellation", "refund", "month to month", "commit", "contract", "lock in"],
      boost: ["can i cancel"],
      a: "Yes. Plans are month to month and you can cancel anytime. No contracts, no lock-in.",
      chips: ["How much does it cost?", "See plans"] },

    { id: "custom",
      k: ["custom", "agent", "agents", "automation", "automate", "consult", "consulting", "services", "strategy", "build for me", "bespoke", "enterprise"],
      boost: ["custom agents", "do you build custom"],
      a: "Yes. Beyond Studio, we build custom agents for small and growing businesses: AI strategy, agentic automation, and bespoke agents pointed at growth, operations, content, or support. We do the work and hand you the result.\n\nIt starts with a [short call](/contact). We come back with one concrete idea worth automating, not a pitch.",
      chips: ["Book a call", "What do you offer?"] },

    { id: "services",
      k: ["what do you offer", "offerings", "service", "help with", "use case", "use cases", "operations", "growth", "support"],
      a: "Two paths:\n• [Modulus Studio](/studio): the content product you can use today.\n• [Working with us directly](/services): AI strategy, agentic automation, and custom agents for growth, operations, content, and support.",
      chips: ["What's Modulus Studio?", "Do you build custom agents?", "Book a call"] },

    { id: "security",
      k: ["secure", "security", "privacy", "data", "safe", "gdpr", "train", "training", "my content"],
      boost: ["is my data safe"],
      a: "Your account is protected with industry-standard sign-in (email or Google), and your content stays yours. The full details, including the AI sub-processors we use, are on the [Privacy page](/privacy).",
      chips: ["Privacy", "Book a call"] },

    { id: "account",
      k: ["login", "log in", "sign in", "account", "dashboard", "password", "forgot"],
      boost: ["can't log in"],
      a: "You can [sign in here](/login) with email or Google. Your [dashboard](/account) shows your plan, credits, and downloads. Forgot your password? There's a reset link on the sign-in page.",
      chips: ["Sign in", "See plans"] },

    { id: "founder",
      k: ["founder", "james", "denham", "who built", "who made", "story", "owner", "team", "behind"],
      boost: ["who is the founder"],
      a: "Modulus is founded by James Denham, building in the open for the businesses everyone else overlooks. His first-person story is on the [About page](/about), and he writes about the product on [Insights](/insights).",
      chips: ["About", "Read the latest insight"] },

    { id: "insights",
      k: ["insight", "insights", "blog", "article", "articles", "read", "writing", "post"],
      a: "The [Insights page](/insights) carries practical, no-hype writing on agentic AI for real businesses. The latest one: [why Studio checks every draft against your source](/insights/source-faithful-ai).",
      chips: ["Read the latest insight", "What's Modulus Studio?"] },

    { id: "audience",
      k: ["who is it for", "audience", "small business", "smb", "right for me", "fit", "publisher", "publishers", "author", "creator", "creators", "solo", "agency", "team"],
      boost: ["who is it for"],
      a: "Modulus is built for operators of small and growing businesses: founders, creators, publishers, podcasters, ministries, authors. People who have more work than hands and don't want to manage engineers to fix that.",
      chips: ["What's Modulus Studio?", "Do you build custom agents?"] },

    { id: "contact",
      k: ["contact", "talk to", "human", "person", "demo", "email", "call", "reach", "support", "help me", "question"],
      boost: ["talk to a human"],
      a: "Happy to connect you with a real person. The best move is a [quick call](/contact), or email [james@modulustech.ai](mailto:james@modulustech.ai) and we'll get right back to you, usually within a day.",
      chips: ["Book a call", "Email us"] },

    { id: "keys",
      k: ["api key", "api keys", "openai key", "openrouter", "byok", "bring your own", "managed", "keys"],
      a: "No keys, no setup. You just sign in with your Modulus account and Studio handles all the AI behind the scenes. Your plan's credits cover everything, so there is nothing to configure and no separate AI bill.",
      chips: ["What's Modulus Studio?", "How much does it cost?"] }
  ];

  var GREET = IS_STUDIO_WORLD
    ? "Hi! I'm the Modulus assistant. Ask me anything about Modulus Studio: plans, credits, accuracy, early access."
    : "Hi! I'm the Modulus assistant. Ask me anything about Modulus, Modulus Studio, or working with us.";
  var GREET_CHIPS = IS_STUDIO_WORLD
    ? ["How much does it cost?", "Is it accurate?", "Request early access"]
    : ["What is Modulus?", "What's Modulus Studio?", "How much does it cost?"];

  // Chips that navigate rather than re-ask.
  var GO = {
    "Book a call": "/contact",
    "Explore Studio": "/studio",
    "See plans": "/studio#pricing",
    "About": "/about",
    "Privacy": "/privacy",
    "Sign in": "/login",
    "Read the latest insight": "/insights/source-faithful-ai",
    "Request early access": "/studio#download",
    "Download for Windows": "/download",
    "Start free": "/login?mode=create",
    "Email us": "mailto:james@modulustech.ai"
  };

  /* ------------------------------- matching -------------------------------- */
  function norm(s) { return " " + String(s || "").toLowerCase().replace(/[''`]/g, "'").replace(/[^a-z0-9'\s]/g, " ").replace(/\s+/g, " ").trim() + " "; }
  function match(text) {
    var t = norm(text), best = null, bestScore = 0;
    for (var i = 0; i < KB.length; i++) {
      var e = KB[i], score = 0, j;
      for (j = 0; j < e.k.length; j++) {
        var kw = " " + e.k[j] + " ";
        if (t.indexOf(kw) !== -1) score += e.k[j].length + (e.k[j].indexOf(" ") !== -1 ? 6 : 0);
      }
      if (e.boost) for (j = 0; j < e.boost.length; j++) {
        if (t.indexOf(e.boost[j]) !== -1) score += 30;
      }
      if (score > bestScore) { bestScore = score; best = e; }
    }
    return bestScore >= 4 ? best : null;
  }
  function answerOf(e) { return typeof e.a === "function" ? e.a() : e.a; }
  function kbAnswer(text) {
    var hit = match(text);
    if (hit) return { a: answerOf(hit), chips: hit.chips || GREET_CHIPS };
    return {
      a: "Good question. I don't have a precise answer for that one yet, but a real person does: [book a quick call](/contact) or email [james@modulustech.ai](mailto:james@modulustech.ai).\n\nI can also help with any of these:",
      chips: ["How much does it cost?", "Is it accurate?", "Do you build custom agents?", "Book a call"]
    };
  }

  /* -------------------------------- styles --------------------------------- */
  var css = '' +
    '#mod-ask,#mod-ask *{box-sizing:border-box;-webkit-tap-highlight-color:transparent}' +
    '#mod-ask{position:fixed;right:20px;bottom:20px;z-index:2147480000;font-family:Inter,system-ui,-apple-system,sans-serif}' +

    /* launcher */
    '#mod-ask-btn{display:flex;align-items:center;gap:9px;border:0;cursor:pointer;background:#0C1B2E;color:#fff;' +
      'padding:13px 18px;border-radius:999px;box-shadow:0 14px 34px -12px rgba(11,27,46,.55);font-size:14.5px;font-weight:600;' +
      'transition:transform .18s ease,box-shadow .18s ease;touch-action:manipulation}' +
    '#mod-ask-btn:hover{transform:translateY(-2px);box-shadow:0 20px 44px -14px rgba(11,27,46,.6)}' +
    '#mod-ask-btn svg{width:20px;height:20px;flex:none}' +
    '#mod-ask-btn .dot{width:8px;height:8px;border-radius:50%;background:#C8A75B;box-shadow:0 0 0 0 rgba(200,167,91,.6);flex:none}' +
    (REDUCE ? '' : '#mod-ask-btn .dot{animation:modPulse 2.4s infinite}@keyframes modPulse{0%{box-shadow:0 0 0 0 rgba(200,167,91,.5)}70%{box-shadow:0 0 0 9px rgba(200,167,91,0)}100%{box-shadow:0 0 0 0 rgba(200,167,91,0)}}') +

    /* panel (desktop card) */
    /* padding:0 is load-bearing: the panel is a <section>, and the site's global
       `section { padding: clamp(88px,13vh,160px) 0 }` otherwise injects ~115px
       of dead space inside the chat (header shoved to the middle — the exact
       bug in James's 2026-06-11 screenshot). */
    '#mod-ask-panel{position:fixed;right:20px;bottom:20px;width:392px;max-width:calc(100vw - 32px);height:600px;max-height:calc(100vh - 40px);padding:0!important;' +
      'background:#fff;border:1px solid #e7e3da;border-radius:20px;box-shadow:0 40px 90px -36px rgba(11,27,46,.5);' +
      'display:none;flex-direction:column;overflow:hidden}' +
    '#mod-ask.open #mod-ask-panel{display:flex}#mod-ask.open #mod-ask-btn{display:none}' +
    /* entrance is opacity-only on purpose: a transform here would displace the
       fixed panel in throttled/background contexts (frozen first frame) */
    (REDUCE ? '' : '#mod-ask.open #mod-ask-panel{animation:modUp .22s ease}@keyframes modUp{from{opacity:0}to{opacity:1}}') +

    /* header */
    '.mod-hd{display:flex;align-items:center;gap:11px;padding:14px 16px;background:#0C1B2E;color:#fff;flex:none}' +
    '.mod-hd img{width:30px;height:30px;border-radius:8px}' +
    '.mod-hd .t{font-family:"Playfair Display",Georgia,serif;font-size:17px;font-weight:600;line-height:1.1}' +
    '.mod-hd .s{display:flex;align-items:center;gap:6px;font-size:11.5px;color:#aab4c0;margin-top:2px}' +
    '.mod-hd .s i{width:6px;height:6px;border-radius:50%;background:#C8A75B;display:inline-block}' +
    '.mod-hd .hbtn{background:transparent;border:0;color:#aab4c0;cursor:pointer;line-height:1;padding:6px;border-radius:8px;touch-action:manipulation}' +
    '.mod-hd .hbtn:hover{color:#fff;background:rgba(255,255,255,.1)}' +
    '.mod-hd .hbtn svg{width:17px;height:17px;display:block}' +
    '.mod-hd .x{margin-left:auto;font-size:22px;padding:2px 8px}' +

    /* messages */
    '.mod-body{flex:1;overflow-y:auto;padding:16px;background:#faf8f4;display:flex;flex-direction:column;gap:10px;overscroll-behavior:contain;-webkit-overflow-scrolling:touch}' +
    '.mod-msg{max-width:86%;padding:11px 14px;border-radius:15px;font-size:14px;line-height:1.55;white-space:pre-wrap;word-wrap:break-word}' +
    '.mod-msg.bot{background:#fff;border:1px solid #ece8df;color:#1a1d24;align-self:flex-start;border-bottom-left-radius:5px}' +
    '.mod-msg.me{background:#0C1B2E;color:#fff;align-self:flex-end;border-bottom-right-radius:5px}' +
    '.mod-msg a{color:#9C7D3C;font-weight:600;text-decoration:underline;text-underline-offset:2px}' +
    '.mod-msg.me a{color:#E4C77D}' +
    (REDUCE ? '' : '.mod-msg{animation:modMsg .25s ease}@keyframes modMsg{from{opacity:0;transform:translateY(6px)}to{opacity:1;transform:none}}') +

    /* chips */
    '.mod-chips{display:flex;flex-wrap:wrap;gap:7px;margin-top:2px}' +
    '.mod-chip{background:#fff;border:1px solid #d9cfb6;color:#7a6020;font-size:12.5px;font-weight:600;padding:8px 13px;border-radius:999px;cursor:pointer;' +
      'transition:background .15s,border-color .15s,transform .15s;touch-action:manipulation;flex:none}' +
    '.mod-chip:hover{background:#faf4e6;border-color:#C8A75B;transform:translateY(-1px)}' +

    /* composer */
    '.mod-foot{display:flex;gap:8px;padding:12px;border-top:1px solid #ece8df;background:#fff;flex:none}' +
    '.mod-foot input{flex:1;min-width:0;border:1px solid #ddd7cc;border-radius:999px;padding:11px 16px;font:inherit;font-size:16px;outline:none;background:#fff;color:#1a1d24}' +
    '.mod-foot input:focus{border-color:#C8A75B;box-shadow:0 0 0 3px rgba(200,167,91,.18)}' +
    '.mod-foot button{border:0;background:#C8A75B;color:#0C1B2E;font-weight:700;border-radius:999px;padding:0 18px;cursor:pointer;font-size:14px;touch-action:manipulation;transition:background .15s}' +
    '.mod-foot button:hover{background:#d4b66e}' +

    /* typing */
    '.mod-typing{display:flex;gap:4px;align-self:flex-start;background:#fff;border:1px solid #ece8df;padding:13px 15px;border-radius:15px;border-bottom-left-radius:5px}' +
    '.mod-typing i{width:7px;height:7px;border-radius:50%;background:#b9c2cc;display:block}' +
    (REDUCE ? '' : '.mod-typing i{animation:modBlink 1.2s infinite}.mod-typing i:nth-child(2){animation-delay:.2s}.mod-typing i:nth-child(3){animation-delay:.4s}@keyframes modBlink{0%,60%,100%{opacity:.3}30%{opacity:1}}') +

    /* phones: round FAB + full-screen sheet */
    '@media (max-width:640px){' +
      '#mod-ask{right:16px;bottom:calc(16px + env(safe-area-inset-bottom,0px))}' +
      '#mod-ask-btn{width:56px;height:56px;padding:0;justify-content:center}' +
      '#mod-ask-btn .lbl,#mod-ask-btn .dot{display:none}' +
      '#mod-ask-btn svg{width:24px;height:24px}' +
      '#mod-ask-panel{left:0;right:0;top:0;bottom:0;width:100%;height:100dvh;max-width:none;max-height:none;border-radius:0;border:0}' +
      (REDUCE ? '' : '#mod-ask.open #mod-ask-panel{animation:modSheet .24s ease}@keyframes modSheet{from{opacity:0}to{opacity:1}}') +
      '.mod-hd{padding-top:calc(14px + env(safe-area-inset-top,0px))}' +
      '.mod-foot{padding-bottom:calc(12px + env(safe-area-inset-bottom,0px))}' +
    '}';
  var style = document.createElement("style"); style.id = "mod-ask-style"; style.textContent = css;
  document.head.appendChild(style);

  /* --------------------------------- DOM ----------------------------------- */
  var root = document.createElement("div");
  root.id = "mod-ask";
  root.innerHTML =
    '<button id="mod-ask-btn" aria-label="Open the Ask Modulus assistant">' +
      '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M21 11.5a8.38 8.38 0 0 1-8.5 8.5 8.5 8.5 0 0 1-3.8-.9L3 21l1.9-5.7a8.5 8.5 0 0 1 3.1-11.6 8.38 8.38 0 0 1 12 7.8z"/></svg>' +
      '<span class="lbl">Ask Modulus</span><span class="dot" aria-hidden="true"></span>' +
    '</button>' +
    '<section id="mod-ask-panel" role="dialog" aria-modal="true" aria-label="Ask Modulus assistant">' +
      '<header class="mod-hd">' +
        '<img src="/assets/modulus-mark.png" alt="" />' +
        '<div><div class="t">Ask Modulus</div><div class="s"><i aria-hidden="true"></i>AI assistant, answers may be imperfect</div></div>' +
        '<button class="hbtn x" aria-label="Close">&times;</button>' +
      '</header>' +
      '<div class="mod-body" id="mod-ask-body" aria-live="polite"></div>' +
      '<form class="mod-foot" id="mod-ask-form">' +
        '<input id="mod-ask-input" type="text" autocomplete="off" enterkeyhint="send" placeholder="Ask a question…" aria-label="Type your question" />' +
        '<button type="submit">Send</button>' +
      '</form>' +
    '</section>';
  document.body.appendChild(root);

  var btn = root.querySelector("#mod-ask-btn");
  var body = root.querySelector("#mod-ask-body");
  var form = root.querySelector("#mod-ask-form");
  var input = root.querySelector("#mod-ask-input");

  /* ------------------------------ rendering -------------------------------- */
  function esc(s) { var d = document.createElement("div"); d.textContent = s; return d.innerHTML; }
  // escape first, then turn [label](href) into safe anchors (internal/mailto only)
  function rich(s) {
    return esc(s).replace(/\[([^\]]+)\]\((\/[^)\s]*|mailto:[^)\s]+)\)/g, function (_m, label, href) {
      return '<a href="' + href + '">' + label + "</a>";
    });
  }
  function scrollDown() { body.scrollTop = body.scrollHeight; }

  function addMsg(text, who, skipSave) {
    var m = document.createElement("div");
    m.className = "mod-msg " + (who === "me" ? "me" : "bot");
    m.innerHTML = rich(text);
    body.appendChild(m); scrollDown();
    if (!skipSave) remember({ t: text, w: who });
  }
  function addChips(list, skipSave) {
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
    if (!skipSave) remember({ c: list });
  }
  function typing(on) {
    var ex = body.querySelector(".mod-typing");
    if (on) { if (!ex) { var t = document.createElement("div"); t.className = "mod-typing"; t.setAttribute("aria-label", "Assistant is typing"); t.innerHTML = "<i></i><i></i><i></i>"; body.appendChild(t); scrollDown(); } }
    else if (ex) { ex.remove(); }
  }

  /* --------------------- conversation memory (per tab) --------------------- */
  var MEMKEY = "mod-ask-v2";
  function history() {
    try { return JSON.parse(sessionStorage.getItem(MEMKEY) || "[]"); } catch (e) { return []; }
  }
  function remember(entry) {
    try {
      var h = history(); h.push(entry);
      if (h.length > 40) h = h.slice(-40);
      sessionStorage.setItem(MEMKEY, JSON.stringify(h));
    } catch (e) { /* storage blocked — chat just won't persist */ }
  }
  function restore() {
    var h = history();
    if (!h.length) return false;
    h.forEach(function (e) {
      if (e.c) addChips(e.c, true);
      else addMsg(e.t, e.w, true);
    });
    return true;
  }

  /* ------------------------------- AI bridge ------------------------------- */
  // Set to "" to disable. Returns 503 until the OPENROUTER_API_KEY secret is
  // set on the Supabase "ask" function; the widget then uses the local KB.
  // Canonical .supabase.co host on purpose — the site CSP only allows
  // connect-src *.supabase.co (custom-domain fetches are blocked by CSP).
  var AI_ENDPOINT = "https://deypezfcawzdcfhnckxp.supabase.co/functions/v1/ask";
  var AI_FAIL_KEY = "mod-ask-aifail";
  var convo = [];

  function aiRecentlyFailed() {
    try { var ts = +sessionStorage.getItem(AI_FAIL_KEY) || 0; return (Date.now() - ts) < 10 * 60 * 1000; }
    catch (e) { return false; }
  }
  function noteAiFailure() { try { sessionStorage.setItem(AI_FAIL_KEY, String(Date.now())); } catch (e) {} }

  function fetchAI(text) {
    var ctrl = new AbortController();
    var to = setTimeout(function () { ctrl.abort(); }, 12000);
    // Supabase's gateway requires the apikey header even for a public edge function;
    // without it the request is rejected 401 before it ever reaches /ask.
    var headers = { "content-type": "application/json" };
    if (window.modulusAuth && window.modulusAuth.anonKey) {
      headers["apikey"] = window.modulusAuth.anonKey;
      headers["Authorization"] = "Bearer " + window.modulusAuth.anonKey;
    }
    return fetch(AI_ENDPOINT, {
      method: "POST",
      headers: headers,
      body: JSON.stringify({ q: text, history: convo.slice(-6) }),
      signal: ctrl.signal
    }).then(function (r) { return r.ok ? r.json() : null; })
      .then(function (d) { return d && d.answer ? d.answer : null; })
      .catch(function () { return null; })
      .then(function (ans) { clearTimeout(to); return ans; });
  }

  function showBot(text, chips) { typing(false); addMsg(text, "bot"); addChips(chips); }

  function respond(text) {
    typing(true);
    if (AI_ENDPOINT && !aiRecentlyFailed()) {
      fetchAI(text).then(function (ans) {
        if (ans) {
          convo.push({ role: "assistant", content: ans });
          showBot(ans, ["See plans", "Book a call"]);
        } else {
          noteAiFailure();                       // skip AI for 10 min — no per-message latency
          var k = kbAnswer(text); showBot(k.a, k.chips);
        }
      });
    } else {
      setTimeout(function () { var k = kbAnswer(text); showBot(k.a, k.chips); }, REDUCE ? 160 : 480);
    }
  }
  function send(text) {
    text = (text || "").trim(); if (!text) return;
    addMsg(text, "me");
    convo.push({ role: "user", content: text });
    input.value = "";
    respond(text);
  }

  /* ------------------------------ open / close ----------------------------- */
  var booted = false;
  function open() {
    root.classList.add("open");
    if (!booted) {
      booted = true;
      if (!restore()) { addMsg(GREET, "bot"); addChips(GREET_CHIPS); }
    }
    // focus the input (skip on touch devices so the keyboard doesn't jump up uninvited)
    if (!(window.matchMedia && window.matchMedia("(pointer: coarse)").matches)) {
      setTimeout(function () { input.focus(); }, 80);
    }
    scrollDown();
  }
  function close() { root.classList.remove("open"); btn.focus(); }

  btn.addEventListener("click", open);
  root.querySelector(".mod-hd .x").addEventListener("click", close);
  form.addEventListener("submit", function (e) { e.preventDefault(); send(input.value); });
  document.addEventListener("keydown", function (e) { if (e.key === "Escape" && root.classList.contains("open")) close(); });
})();

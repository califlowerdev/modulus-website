/* ============================================================================
   Modulus — backend foundation: Auth (Supabase) + Assistant (Chatbase) + Checkout (Stripe)
   ----------------------------------------------------------------------------
   This file is INERT until you fill in CONFIG below. With the fields blank the
   site behaves exactly as it does today (login shows the "coming soon" note,
   pricing buttons link to the download). Fill the fields and real auth,
   the AI assistant, and checkout all turn on. Full instructions: BACKEND-SETUP.md

   SAFE TO COMMIT: the Supabase anon key, Chatbase id, and Stripe Payment Link
   URLs below are all meant to live in the browser. NEVER put a Supabase
   service_role key or a Stripe secret key (sk_...) in this file.
   ========================================================================== */
(function () {
  // ======================= PASTE YOUR KEYS HERE =============================
  var CONFIG = {
    SUPABASE_URL: "https://deypezfcawzdcfhnckxp.supabase.co",
    SUPABASE_ANON_KEY: "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImRleXBlemZjYXd6ZGNmaG5ja3hwIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODA0MzE4MjcsImV4cCI6MjA5NjAwNzgyN30.AxvDKCh5NIvzdBHy9BbP3NlV18yt4JuWVrpHho1SNic",
    CHATBASE_ID: "",           // your Chatbase chatbot id
    STRIPE_LINKS: {            // Stripe Payment Link URLs, one per plan
      starter: "",             // $19 / month
      pro: "",                 // $39 / month
      studio: ""               // $99 / month
    },
    STRIPE_PORTAL: ""          // Stripe customer-portal link ("Manage billing")
  };
  // ==========================================================================

  var hasAuth = !!(CONFIG.SUPABASE_URL && CONFIG.SUPABASE_ANON_KEY);

  function loadScript(src) {
    return new Promise(function (resolve, reject) {
      var s = document.createElement("script");
      s.src = src; s.async = true; s.onload = resolve; s.onerror = reject;
      document.head.appendChild(s);
    });
  }

  /* ---------------------------- AUTH (Supabase) --------------------------- */
  var sb = null;
  function ensureClient() {
    if (sb) return Promise.resolve(sb);
    return loadScript("https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2").then(function () {
      sb = window.supabase.createClient(CONFIG.SUPABASE_URL, CONFIG.SUPABASE_ANON_KEY);
      return sb;
    });
  }

  // When signed in, swap the nav "Login" link for the account name + sign out.
  function reflectUser(user) {
    if (!user) return;
    // Update every real login link (desktop header + mobile drawer) to the
    // signed-in account name. Marked [data-auth-login] so we never touch the
    // Studio header's "back to Modulus" link (which also carries .login).
    var links = document.querySelectorAll("[data-auth-login]");
    for (var i = 0; i < links.length; i++) {
      links[i].textContent = user.email ? user.email.split("@")[0] : "Account";
      links[i].setAttribute("href", "/account");
      links[i].title = "Your account";
    }
  }

  var api = {
    configured: hasAuth,
    signInGoogle: function () {
      return ensureClient().then(function (c) {
        return c.auth.signInWithOAuth({
          provider: "google",
          options: { redirectTo: location.origin + "/account" }
        });
      });
    },
    signInEmail: function (email, pw) {
      return ensureClient().then(function (c) { return c.auth.signInWithPassword({ email: email, password: pw }); });
    },
    signUp: function (email, pw) {
      return ensureClient().then(function (c) { return c.auth.signUp({ email: email, password: pw }); });
    },
    signOut: function () {
      return ensureClient().then(function (c) { return c.auth.signOut(); }).then(function () { location.reload(); });
    },
    resetPassword: function (email) {
      return ensureClient().then(function (c) { return c.auth.resetPasswordForEmail(email, { redirectTo: location.origin + "/login" }); });
    }
  };
  window.modulusAuth = api;

  if (hasAuth) {
    ensureClient().then(function (c) {
      c.auth.getSession().then(function (r) { if (r.data && r.data.session) reflectUser(r.data.session.user); });
      c.auth.onAuthStateChange(function (_evt, session) { reflectUser(session && session.user); });
    });
  }

  /* ------------------------- LOGIN PAGE WIRING ---------------------------- */
  function wireLogin() {
    var form = document.getElementById("authForm");
    var gbtn = document.querySelector('[data-auth="google"]');
    var foundation = document.getElementById("foundation");
    if (!form && !gbtn) return; // not the login page

    // If already signed in (or just returned from a Google OAuth redirect),
    // leave the login form and go to the dashboard. Without this, OAuth lands
    // the user right back on the login page and looks like nothing happened.
    if (hasAuth) {
      ensureClient().then(function (c) {
        c.auth.getSession().then(function (r) { if (r.data && r.data.session) location.replace("/account"); });
        c.auth.onAuthStateChange(function (_e, session) { if (session) location.replace("/account"); });
      });
    }

    function note(msg) {
      if (!foundation) return;
      foundation.style.display = "block";
      if (msg) foundation.textContent = msg;
    }
    if (gbtn) {
      gbtn.addEventListener("click", function () {
        if (!hasAuth) return note();
        api.signInGoogle().catch(function (err) { note("Could not start Google sign-in. " + (err && err.message ? err.message : err)); });
      });
    }
    var forgot = document.querySelector('[data-auth="forgot"]');
    if (forgot) {
      forgot.addEventListener("click", function (e) {
        e.preventDefault();
        if (!hasAuth) return note();
        var email = (document.getElementById("a-email") || {}).value;
        if (!email) return note("Enter your email above first, then click “Forgot password?”");
        api.resetPassword(email).then(function (r) {
          note(r && r.error ? r.error.message : "Password reset link sent. Check your email.");
        }).catch(function (err) { note(String(err)); });
      });
    }
    if (form) {
      form.addEventListener("submit", function (e) {
        e.preventDefault();
        if (!hasAuth) return note();
        var email = (document.getElementById("a-email") || {}).value;
        var pw = (document.getElementById("a-pass") || {}).value;
        var creating = document.body.getAttribute("data-mode") === "create";
        (creating ? api.signUp(email, pw) : api.signInEmail(email, pw)).then(function (r) {
          if (r && r.error) return note(r.error.message);
          if (creating) note("Almost there — check your email to confirm your account.");
          else location.href = "/account";
        }).catch(function (err) { note(String(err)); });
      });
    }
  }

  /* ------------------------ CHECKOUT (Stripe links) ----------------------- */
  function wireCheckout() {
    var links = CONFIG.STRIPE_LINKS || {};
    var els = document.querySelectorAll("[data-checkout]");
    for (var i = 0; i < els.length; i++) {
      var tier = els[i].getAttribute("data-checkout");
      if (links[tier]) els[i].setAttribute("href", links[tier]);
    }
  }

  /* ------------------------- ASSISTANT (Chatbase) ------------------------- */
  function loadAssistant() {
    if (!CONFIG.CHATBASE_ID) return;
    // Standard Chatbase embed. If Chatbase gives you a different snippet, paste
    // theirs here instead (see BACKEND-SETUP.md).
    window.chatbaseConfig = { chatbotId: CONFIG.CHATBASE_ID };
    var s = document.createElement("script");
    s.src = "https://www.chatbase.co/embed.min.js";
    s.id = CONFIG.CHATBASE_ID;
    s.setAttribute("domain", "www.chatbase.co");
    s.defer = true;
    document.body.appendChild(s);
  }

  /* ------------------------- ACCOUNT DASHBOARD ---------------------------- */
  var PLAN_PRICE = { starter: "$19 / mo", pro: "$39 / mo", studio: "$99 / mo" };
  var PLAN_LIMIT = { starter: 600, pro: 1500, studio: 4000 };
  function cap(s) { return s ? s.charAt(0).toUpperCase() + s.slice(1) : s; }
  function setText(id, v) { var el = document.getElementById(id); if (el) el.textContent = v; }
  function fmtDate(s) {
    if (!s) return "—";
    try { return new Date(s).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" }); }
    catch (e) { return "—"; }
  }

  function renderPlan(row) {
    var plan = row && row.plan;
    var limit = (row && row.credits_limit) || (plan && PLAN_LIMIT[plan]) || 0;
    var used = (row && row.credits_used) || 0;
    var pct = limit ? Math.min(100, Math.round(used / limit * 100)) : 0;
    setText("acctPlanBadge", plan ? (cap(plan) + " plan") : "No active plan");
    setText("usageUsed", used.toLocaleString());
    setText("usageLimit", limit ? limit.toLocaleString() : "—");
    setText("usagePct", pct + "%");
    var bar = document.getElementById("usageBar"); if (bar) bar.style.width = pct + "%";
    setText("usageRefill", fmtDate(row && row.current_period_end));
    setText("billPlan", plan ? cap(plan) : "No active plan");
    setText("billPrice", plan ? (PLAN_PRICE[plan] || "—") : "—");
    setText("billStatus", (row && row.status) ? cap(row.status) : "—");
    setText("billRenew", fmtDate(row && row.current_period_end));
    var noPlan = document.getElementById("noPlanHint"); if (noPlan) noPlan.style.display = plan ? "none" : "";
  }

  function wireAccount() {
    var card = document.getElementById("accountCard");
    if (!card) return; // not the dashboard
    var inEl = document.getElementById("acctSignedIn");
    var outEl = document.getElementById("acctSignedOut");
    var signOut = document.getElementById("signOutBtn");
    var manage = document.getElementById("manageBillingBtn");
    if (signOut) signOut.addEventListener("click", function (e) { e.preventDefault(); api.signOut(); });
    if (manage) { if (CONFIG.STRIPE_PORTAL) manage.setAttribute("href", CONFIG.STRIPE_PORTAL); else manage.style.display = "none"; }
    function show(signedIn) {
      if (inEl) inEl.style.display = signedIn ? "" : "none";
      if (outEl) outEl.style.display = signedIn ? "none" : "";
    }
    // Preview the populated dashboard without a backend: account.html?preview=1
    if (/[?&]preview=1/.test(location.search)) {
      show(true);
      setText("acctHello", "Welcome back, James.");
      setText("acctEmail", "you@modulustech.ai");
      renderPlan({ plan: "pro", status: "active", credits_used: 920, credits_limit: 1500, current_period_end: "2026-07-01" });
      return;
    }
    if (!hasAuth) { show(false); return; }
    ensureClient().then(function (c) {
      c.auth.getUser().then(function (r) {
        var user = r && r.data && r.data.user;
        if (!user) { show(false); return; }
        show(true);
        var meta = user.user_metadata || {};
        var name = meta.full_name || meta.name || (user.email ? user.email.split("@")[0] : "there");
        setText("acctHello", "Welcome back, " + name + ".");
        setText("acctEmail", user.email || "");
        // NOTE: billing/plan data is intentionally NOT read here yet. The
        // Supabase project's billing tables (accounts / subscriptions /
        // credits / licenses) belong to the Modulus Studio desktop app's
        // licensing system. The website stays decoupled from them until the
        // shared-account integration is built deliberately. Until then the
        // dashboard shows a clean "no active plan" state for signed-in users.
        renderPlan(null);
      });
    });
  }

  function boot() { wireLogin(); wireCheckout(); wireAccount(); loadAssistant(); }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", boot);
  else boot();
})();

/* ============================================================================
   Modulus — backend foundation: Auth (Supabase) + Checkout (Stripe) + Dashboard
   ----------------------------------------------------------------------------
   Auth is live (Supabase). Billing connects to the deployed Supabase Edge
   Functions: `create-checkout` (start a subscription) and `entitlement` (read
   the signed-in user's plan + credits). The webhook grants credits server-side.

   GO-LIVE SWITCH: set CONFIG.BILLING_LIVE = true once the server secrets are in
   place (STRIPE_SECRET_KEY, the webhook secret) and you've tested with a Stripe
   test card. Until then the pricing buttons keep their "request early access"
   behavior, so the public never hits a half-configured checkout.

   SAFE TO COMMIT: the Supabase anon key below is meant to live in the browser.
   NEVER put a Supabase service_role key or a Stripe secret key (sk_...) here.
   ========================================================================== */
(function () {
  // ======================= CONFIG ===========================================
  var CONFIG = {
    SUPABASE_URL: "https://deypezfcawzdcfhnckxp.supabase.co",
    SUPABASE_ANON_KEY: "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImRleXBlemZjYXd6ZGNmaG5ja3hwIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODA0MzE4MjcsImV4cCI6MjA5NjAwNzgyN30.AxvDKCh5NIvzdBHy9BbP3NlV18yt4JuWVrpHho1SNic",
    BILLING_LIVE: false,       // flip to true at go-live (see header)
    STRIPE_PORTAL: "",         // Stripe customer-portal link ("Manage billing"); optional
    CHATBASE_ID: ""            // unused (we ship our own assistant.js); left for compatibility
  };
  // ==========================================================================

  var hasAuth = !!(CONFIG.SUPABASE_URL && CONFIG.SUPABASE_ANON_KEY);
  function fnUrl(name) { return CONFIG.SUPABASE_URL.replace(/\/$/, "") + "/functions/v1/" + name; }

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

  // The signed-in user's Supabase access token (for authed function calls).
  function accessToken() {
    return ensureClient()
      .then(function (c) { return c.auth.getSession(); })
      .then(function (r) { return (r && r.data && r.data.session) ? r.data.session.access_token : null; })
      .catch(function () { return null; });
  }

  // When signed in, swap the nav "Login" link for the account name + sign out.
  function reflectUser(user) {
    if (!user) return;
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
    // leave the login form and go to the dashboard.
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

  /* --------------------- CHECKOUT (create-checkout fn) -------------------- */
  // Each [data-checkout] button (the pricing tiers) starts a real Stripe
  // Checkout for that plan_key, tied to the signed-in account server-side.
  // Gated on BILLING_LIVE so the public sees "early access" until we're ready.
  function wireCheckout() {
    var els = document.querySelectorAll("[data-checkout]");
    if (!els.length || !CONFIG.BILLING_LIVE || !hasAuth) return; // leave buttons as-is
    for (var i = 0; i < els.length; i++) {
      (function (el) {
        var tier = el.getAttribute("data-checkout");
        el.addEventListener("click", function (e) {
          e.preventDefault();
          if (el.getAttribute("data-busy")) return;
          var label = el.textContent;
          el.setAttribute("data-busy", "1");
          el.textContent = "Starting checkout…";
          function fail(msg) { el.textContent = label; el.removeAttribute("data-busy"); if (msg) alert(msg); }
          accessToken().then(function (token) {
            if (!token) { window.location.assign("/login"); return; } // sign in, then pick a plan
            return fetch(fnUrl("create-checkout"), {
              method: "POST",
              headers: { "content-type": "application/json", "Authorization": "Bearer " + token },
              body: JSON.stringify({ plan_key: tier, return_url: location.origin + "/account" })
            }).then(function (r) { return r.json().then(function (d) { return { ok: r.ok, d: d }; }); })
              .then(function (res) {
                if (res.ok && res.d && res.d.url) { window.location.assign(res.d.url); }
                else { fail((res.d && res.d.error) || "Couldn't start checkout. Please try again."); }
              });
          }).catch(function () { fail("Couldn't start checkout. Please try again."); });
        });
      })(els[i]);
    }
  }

  /* ------------------------- ASSISTANT (Chatbase) ------------------------- */
  function loadAssistant() {
    if (!CONFIG.CHATBASE_ID) return; // we ship assistant.js instead
    window.chatbaseConfig = { chatbotId: CONFIG.CHATBASE_ID };
    var s = document.createElement("script");
    s.src = "https://www.chatbase.co/embed.min.js";
    s.id = CONFIG.CHATBASE_ID;
    s.setAttribute("domain", "www.chatbase.co");
    s.defer = true;
    document.body.appendChild(s);
  }

  /* ------------------------- ACCOUNT DASHBOARD ---------------------------- */
  var PLAN_PRICE = { starter: "$19 / mo", pro: "$39 / mo", studio: "$99 / mo", monthly: "—" };
  var PLAN_LIMIT = { starter: 600, pro: 1500, studio: 4000 };
  function cap(s) { return s ? s.charAt(0).toUpperCase() + s.slice(1) : s; }
  function setText(id, v) { var el = document.getElementById(id); if (el) el.textContent = v; }
  function fmtDate(s) {
    if (!s) return "—";
    try { return new Date(s).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" }); }
    catch (e) { return "—"; }
  }

  // Render the credits gauge as REMAINING balance out of the monthly grant.
  function renderPlan(row) {
    var plan = row && row.plan;
    var name = (row && row.display_name) ? row.display_name : (plan ? cap(plan) : null);
    var limit = (row && row.limit) || (plan && PLAN_LIMIT[plan]) || 0;
    var balance = (row && typeof row.balance === "number") ? row.balance : 0;
    var pctLeft = limit ? Math.max(0, Math.min(100, Math.round(balance / limit * 100))) : 0;
    setText("acctPlanBadge", name ? (name + " plan") : "No active plan");
    setText("usageUsed", plan ? balance.toLocaleString() : "0");
    setText("usageLimit", limit ? limit.toLocaleString() : "—");
    setText("usagePct", pctLeft + "%");
    var bar = document.getElementById("usageBar"); if (bar) bar.style.width = pctLeft + "%";
    setText("usageRefill", fmtDate(row && row.current_period_end));
    setText("billPlan", name ? name : "No active plan");
    setText("billPrice", plan ? (PLAN_PRICE[plan] || "—") : "—");
    setText("billStatus", (row && row.status) ? cap(row.status) : "—");
    setText("billRenew", fmtDate(row && row.current_period_end));
    var noPlan = document.getElementById("noPlanHint"); if (noPlan) noPlan.style.display = plan ? "none" : "";
  }

  function renderEntitlement(d) {
    if (!d || !d.plan) { renderPlan(null); return; }
    renderPlan({
      plan: d.plan.key,
      display_name: d.plan.display_name,
      status: d.subscription ? d.subscription.status : null,
      balance: typeof d.balance === "number" ? d.balance : 0,
      limit: d.plan.monthly_credits || 0,
      current_period_end: d.subscription ? d.subscription.current_period_end : null
    });
  }

  // Read the signed-in user's real plan + credits from the entitlement function.
  function loadEntitlement() {
    accessToken().then(function (token) {
      if (!token) { renderPlan(null); return; }
      fetch(fnUrl("entitlement"), { method: "GET", headers: { "Authorization": "Bearer " + token } })
        .then(function (r) { return r.ok ? r.json() : null; })
        .then(function (d) { renderEntitlement(d); })
        .catch(function () { renderPlan(null); });
    });
  }

  // After a Stripe checkout the webhook grants credits asynchronously; poll a
  // few times so the dashboard fills in within a few seconds.
  function pollEntitlement(n) {
    if (n > 6) return;
    loadEntitlement();
    setTimeout(function () { pollEntitlement(n + 1); }, 5000);
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
      renderPlan({ plan: "pro", display_name: "Pro", status: "active", balance: 1280, limit: 1500, current_period_end: "2026-07-01" });
      return;
    }
    if (!hasAuth) { show(false); return; }

    var justSubscribed = /[?&]checkout=success/.test(location.search);

    ensureClient().then(function (c) {
      c.auth.getUser().then(function (r) {
        var user = r && r.data && r.data.user;
        if (!user) { show(false); return; }
        show(true);
        var meta = user.user_metadata || {};
        var name = meta.full_name || meta.name || (user.email ? user.email.split("@")[0] : "there");
        setText("acctHello", "Welcome back, " + name + ".");
        setText("acctEmail", user.email || "");
        if (justSubscribed) {
          setText("acctPlanBadge", "Activating…");
          var hint = document.getElementById("noPlanHint");
          if (hint) { hint.textContent = "Finishing your subscription — your plan and credits will appear here in a moment."; hint.style.display = ""; }
          pollEntitlement(0);
          // Clean the URL so a refresh doesn't re-trigger.
          try { history.replaceState({}, "", "/account"); } catch (e) {}
        } else {
          loadEntitlement();
        }
      });
    });
  }

  function boot() { wireLogin(); wireCheckout(); wireAccount(); loadAssistant(); }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", boot);
  else boot();
})();

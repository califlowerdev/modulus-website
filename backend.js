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
    // API base for the supabase-js client. MUST be the canonical .supabase.co host.
    // Browsers CANNOT make XHR/fetch calls to the custom domain auth.modulustech.ai
    // (its Cloudflare custom-hostname edge fails in-browser fetch — "Failed to fetch" —
    // even though curl + top-level navigation work fine). Pointing the client here
    // broke EVERY browser API call: token validation (getUser), refresh, REST, edge
    // functions — which is why Google/email login stopped landing. (2026-06-10 incident.)
    SUPABASE_URL: "https://deypezfcawzdcfhnckxp.supabase.co",
    // Branded auth origin — used ONLY for the Google OAuth redirect, which is a
    // top-level navigation (that DOES work on the custom domain) so the Google consent
    // screen reads "to continue to modulustech.ai" instead of the raw project URL.
    // See signInGoogle(). The session comes back as a #fragment that the canonical
    // client (SUPABASE_URL above) consumes on /account.
    AUTH_ORIGIN: "https://auth.modulustech.ai",
    SUPABASE_ANON_KEY: "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImRleXBlemZjYXd6ZGNmaG5ja3hwIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODA0MzE4MjcsImV4cCI6MjA5NjAwNzgyN30.AxvDKCh5NIvzdBHy9BbP3NlV18yt4JuWVrpHho1SNic",
    BILLING_LIVE: true,        // flipped 2026-06-11: checkout runs against the Stripe sandbox until the live-mode key swap
    STRIPE_PORTAL: ""          // Stripe customer-portal link ("Manage billing"); optional
  };
  // ==========================================================================

  var hasAuth = !!(CONFIG.SUPABASE_URL && CONFIG.SUPABASE_ANON_KEY);
  function fnUrl(name) { return CONFIG.SUPABASE_URL.replace(/\/$/, "") + "/functions/v1/" + name; }

  function loadScript(src, integrity) {
    return new Promise(function (resolve, reject) {
      var s = document.createElement("script");
      s.src = src;
      // Subresource Integrity (audit A03): pin the supabase-js bundle to an
      // exact hash so a poisoned CDN file is refused by the browser. crossOrigin
      // is required for SRI to be enforced on a cross-origin script.
      if (integrity) { s.integrity = integrity; s.crossOrigin = "anonymous"; }
      s.async = true; s.onload = resolve; s.onerror = reject;
      document.head.appendChild(s);
    });
  }

  // Pinned supabase-js: exact version + SRI hash. To bump, fetch the new
  // version's /dist/umd/supabase.js and recompute:
  //   openssl dgst -sha384 -binary supabase.js | openssl base64 -A
  var SUPABASE_JS_URL = "https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.108.1/dist/umd/supabase.js";
  var SUPABASE_JS_SRI = "sha384-EjUdIVmzWliPzdzhxZ9ZoO0etXLKWuUPUftAGxP6qH6Lm4oLwoLaJR0Ba4pIDiDL";

  /* ---------------------------- AUTH (Supabase) --------------------------- */
  var sb = null;
  function ensureClient() {
    if (sb) return Promise.resolve(sb);
    return loadScript(SUPABASE_JS_URL, SUPABASE_JS_SRI).then(function () {
      sb = window.supabase.createClient(CONFIG.SUPABASE_URL, CONFIG.SUPABASE_ANON_KEY, {
        auth: {
          persistSession: true,
          autoRefreshToken: true,
          // Google sign-in returns the session in the URL #fragment (implicit grant);
          // detectSessionInUrl consumes it on /account. flowType is pinned to
          // 'implicit' because signInGoogle drives the OAuth redirect manually with no
          // PKCE challenge — if a future supabase-js defaulted to 'pkce' it would stop
          // recognizing the #access_token fragment and login would silently break.
          detectSessionInUrl: true,
          flowType: "implicit"
        }
      });
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
      // Send the user to the BRANDED auth origin for Google's consent screen so it
      // reads "to continue to modulustech.ai". This is a deliberate manual redirect
      // (NOT supabase-js signInWithOAuth) because the client base is the canonical
      // .supabase.co host — signInWithOAuth would build the consent URL from that and
      // show the raw project domain. GoTrue returns the session as a #fragment to
      // redirect_to (/account), where the canonical client picks it up via
      // detectSessionInUrl. redirect_to must stay allow-listed in Supabase Auth →
      // URL Configuration. (2026-06-10.)
      var redirectTo = location.origin + "/account";
      window.location.href = CONFIG.AUTH_ORIGIN +
        "/auth/v1/authorize?provider=google&redirect_to=" +
        encodeURIComponent(redirectTo);
      return Promise.resolve();
    },
    signInEmail: function (email, pw) {
      return ensureClient().then(function (c) { return c.auth.signInWithPassword({ email: email, password: pw }); });
    },
    signUp: function (email, pw, name) {
      // emailRedirectTo: the confirmation link should land on /account (an
      // app page that loads the SDK and consumes the session fragment), not
      // the homepage where supabase-js never loads and the token hash would
      // just sit in the URL. /account is already in the Supabase redirect
      // allowlist (the Google flow uses it). full_name goes into
      // user_metadata so the dashboard greeting uses their actual name,
      // same as Google-provider accounts.
      return ensureClient().then(function (c) {
        var opts = { emailRedirectTo: location.origin + "/account" };
        if (name) opts.data = { full_name: name };
        return c.auth.signUp({ email: email, password: pw, options: opts });
      });
    },
    signOut: function () {
      return ensureClient().then(function (c) { return c.auth.signOut(); }).then(function () { location.reload(); });
    },
    resetPassword: function (email) {
      return ensureClient().then(function (c) { return c.auth.resetPasswordForEmail(email, { redirectTo: location.origin + "/login" }); });
    }
  };
  window.modulusAuth = api;

  // Load the Supabase SDK eagerly ONLY where it can matter: on the app pages
  // (login/dashboard) and for visitors who already have a stored session whose
  // name should appear in the nav. Anonymous visitors on marketing pages skip
  // the ~100KB supabase-js download entirely (page-experience/latency win);
  // any auth action (sign-in click, etc.) still lazy-loads it on demand via
  // ensureClient().
  var isAppPage = document.body.getAttribute("data-section") === "app";
  var hasStoredSession = false;
  try {
    var ref = (CONFIG.SUPABASE_URL.match(/^https:\/\/([a-z0-9-]+)\.supabase\.co/) || [])[1];
    hasStoredSession = !!(ref && localStorage.getItem("sb-" + ref + "-auth-token"));
  } catch (e) { /* storage blocked — treat as signed out */ }
  if (hasAuth && (isAppPage || hasStoredSession)) {
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

    // Password-recovery landing (the reset-password email links back here with
    // type=recovery in the hash). Read the hash BEFORE ensureClient() runs —
    // createClient's detectSessionInUrl consumes it. Without this branch the
    // reset link just signs the user in and bounces to /account with the old
    // (forgotten) password still in place, which locks desktop-app users out
    // for good. Instead we show a set-new-password card.
    var isRecovery = /type=recovery/.test(location.hash);
    function enterRecovery() {
      document.body.setAttribute("data-mode", "recovery");
      function hide(el) { if (el) el.style.display = "none"; }
      hide(document.querySelector(".authtabs"));
      hide(document.getElementById("nameField"));
      var emailInput = document.getElementById("a-email");
      if (emailInput) {
        // A hidden required field would silently block form submission.
        emailInput.removeAttribute("required");
        if (emailInput.closest) hide(emailInput.closest(".field"));
      }
      hide(document.querySelector(".forgot"));
      hide(document.querySelector(".divider"));
      hide(gbtn);
      hide(document.querySelector(".authnote"));
      var t = document.getElementById("authTitle"); if (t) t.textContent = "Choose a new password.";
      var l = document.getElementById("authLead"); if (l) l.textContent = "Your reset link signed you in. Now set the new password for your account.";
      var s = document.getElementById("authSubmit"); if (s) s.textContent = "Update password";
      var p = document.getElementById("a-pass");
      if (p) { p.setAttribute("autocomplete", "new-password"); p.value = ""; try { p.focus(); } catch (e) {} }
    }

    // If already signed in (or just returned from a Google OAuth redirect),
    // leave the login form and go to the dashboard. While a stored session is
    // validating, login.html shows the branded loader (html[data-session]);
    // if the token turns out to be stale, reveal the form.
    function revealForm() {
      try { document.documentElement.removeAttribute("data-session"); } catch (e) {}
      var loading = document.getElementById("authLoading");
      if (loading) loading.style.display = "none";
    }
    // Create-account deep link (the desktop app sends new users to
    // /login?mode=create). A visitor with a live session would normally be
    // bounced straight to /account, which silently swallows their clicked
    // intent — so the auto-redirect is suppressed when the create tab was
    // explicitly requested.
    var isCreateIntent = false;
    try { isCreateIntent = new URLSearchParams(location.search).get("mode") === "create"; } catch (e) {}
    // A plan chosen before sign-in (pricing button or deep link) rides along
    // in localStorage; the dashboard resumes that checkout after auth.
    try {
      var planParam = new URLSearchParams(location.search).get("plan");
      if (planParam) localStorage.setItem("modulus-pending-plan", planParam);
    } catch (e) {}

    if (hasAuth) {
      ensureClient().then(function (c) {
        c.auth.getSession().then(function (r) {
          var session = r.data && r.data.session;
          if (session && !isRecovery && !isCreateIntent) { location.replace("/account"); return; }
          revealForm();
          if (session && isCreateIntent) {
            var who = session.user && session.user.email ? session.user.email : "an existing account";
            note("You're already signed in as " + who + ". That account works in the desktop app too, or create a different one below.");
          }
        });
        c.auth.onAuthStateChange(function (evt, session) {
          if (evt === "PASSWORD_RECOVERY") { isRecovery = true; enterRecovery(); revealForm(); return; }
          if (session && !isRecovery && !isCreateIntent) location.replace("/account");
        });
      });
    } else { revealForm(); }
    if (isRecovery) enterRecovery();

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
        // Recovery mode: the only field on screen is the new password.
        if (document.body.getAttribute("data-mode") === "recovery") {
          var npw = (document.getElementById("a-pass") || {}).value;
          if (!npw || npw.length < 8) return note("Pick a password with at least 8 characters.");
          ensureClient().then(function (c) { return c.auth.updateUser({ password: npw }); }).then(function (r) {
            if (r && r.error) return note(r.error.message);
            note("Password updated. Taking you to your account…");
            setTimeout(function () { location.replace("/account"); }, 900);
          }).catch(function (err) { note(String(err)); });
          return;
        }
        var email = (document.getElementById("a-email") || {}).value;
        var pw = (document.getElementById("a-pass") || {}).value;
        var name = (document.getElementById("a-name") || {}).value;
        var creating = document.body.getAttribute("data-mode") === "create";
        (creating ? api.signUp(email, pw, name) : api.signInEmail(email, pw)).then(function (r) {
          if (r && r.error) return note(r.error.message);
          if (creating) {
            // With email confirmation on, signUp for an ALREADY-registered
            // address returns an obfuscated success (identities: []) and no
            // email is sent — without this check the user waits forever for
            // a confirmation that never comes.
            var u = r && r.data && r.data.user;
            if (u && Object.prototype.toString.call(u.identities) === "[object Array]" && u.identities.length === 0) {
              return note("Looks like you already have an account with this email. Sign in instead, or use Forgot password.");
            }
            note("Almost there. Check your email to confirm your account.");
          }
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
          // Dashboard v2: the active plan's button is an indicator, not a buy.
          if (el.getAttribute("data-current")) return;
          if (el.getAttribute("data-busy")) return;
          var label = el.textContent;
          el.setAttribute("data-label", label);
          el.setAttribute("data-busy", "1");
          el.textContent = "Starting checkout…";
          function fail(msg) { el.textContent = label; el.removeAttribute("data-busy"); if (msg) alert(msg); }
          accessToken().then(function (token) {
            if (!token) {
              // Carry the chosen plan through the sign-in detour so the
              // dashboard can resume checkout instead of dropping intent.
              try { localStorage.setItem("modulus-pending-plan", tier); } catch (e2) {}
              window.location.assign("/login?plan=" + encodeURIComponent(tier));
              return;
            }
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
    // Back-button resilience: leaving for Stripe and pressing Back restores
    // the page from the back-forward cache with scripts NOT re-run, which
    // would leave the clicked button stuck on "Starting checkout…" and dead
    // (the data-busy guard). Restore any busy button to its saved label.
    window.addEventListener("pageshow", function (e) {
      if (!e.persisted) return;
      var busy = document.querySelectorAll("[data-checkout][data-busy]");
      for (var j = 0; j < busy.length; j++) {
        busy[j].textContent = busy[j].getAttribute("data-label") || "Upgrade";
        busy[j].removeAttribute("data-busy");
      }
    });
  }

  /* ------------------------- ACCOUNT DASHBOARD ---------------------------- */
  // Plan price + monthly credit grant read from the single source of truth in
  // site.js (window.MODULUS_PLANS) so the account page can't drift from the
  // /studio pricing cards. planInfo() is null for unknown / non-tier plans
  // (e.g. "monthly"), which render as "—" / 0 exactly as the old maps did.
  function planInfo(plan) {
    return (window.MODULUS_PLANS && plan && window.MODULUS_PLANS[plan]) || null;
  }
  function planPriceLabel(plan) { var p = planInfo(plan); return p ? (p.price + " / mo") : "—"; }
  function planLimit(plan) { var p = planInfo(plan); return p ? p.limit : 0; }
  function cap(s) { return s ? s.charAt(0).toUpperCase() + s.slice(1) : s; }
  function setText(id, v) { var el = document.getElementById(id); if (el) el.textContent = v; }
  function reducedMotion() {
    try { return window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches; }
    catch (e) { return false; }
  }
  // Animate a number from its last shown value to `to` (~800ms ease-out).
  // data-val remembers the landing value so re-renders don't replay from 0.
  function countUp(id, to) {
    var el = document.getElementById(id);
    if (el == null) return;
    var from = parseFloat(el.getAttribute("data-val") || "0") || 0;
    el.setAttribute("data-val", String(to));
    if (reducedMotion() || from === to) { el.textContent = to.toLocaleString(); return; }
    var start = null, dur = 800;
    function step(ts) {
      if (start === null) start = ts;
      var p = Math.min(1, (ts - start) / dur);
      p = 1 - Math.pow(1 - p, 3);
      el.textContent = Math.round(from + (to - from) * p).toLocaleString();
      if (p < 1) requestAnimationFrame(step);
    }
    requestAnimationFrame(step);
  }
  function fmtDate(s) {
    if (!s) return "—";
    try { return new Date(s).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" }); }
    catch (e) { return "—"; }
  }

  // Human labels for Stripe's subscription status enum. Raw values like
  // "past_due" must never reach the screen.
  var STATUS_LABELS = {
    active: "Active",
    trialing: "Trial",
    past_due: "Payment past due",
    canceled: "Canceled",
    unpaid: "Payment needed",
    incomplete: "Incomplete",
    incomplete_expired: "Incomplete",
    paused: "Paused"
  };
  function statusLabel(s) {
    return STATUS_LABELS[s] || cap(String(s).replace(/_/g, " "));
  }

  // Render the credits gauge as REMAINING balance out of the monthly grant.
  function renderPlan(row) {
    var plan = row && row.plan;
    var name = (row && row.display_name) ? row.display_name : (plan ? cap(plan) : null);
    var limit = (row && row.limit) || planLimit(plan) || 0;
    var balance = (row && typeof row.balance === "number") ? row.balance : 0;
    var pctLeft = limit ? Math.max(0, Math.min(100, Math.round(balance / limit * 100))) : 0;
    var status = row && row.status;
    var canceled = status === "canceled";
    setText("acctPlanBadge", name ? (name + " plan") : "No active plan");
    // Tier color on the header badge (CSS keys off data-plan).
    var badge = document.getElementById("acctPlanBadge");
    if (badge) badge.setAttribute("data-plan", plan || "none");
    countUp("usageUsed", balance);
    setText("usageLimit", limit ? limit.toLocaleString() : "");
    setText("usagePct", pctLeft + "%");
    // Set the gauge width a beat after render so the CSS transition plays
    // once the dashboard is actually visible (it renders behind the loader).
    var bar = document.getElementById("usageBar");
    if (bar) setTimeout(function () { bar.style.width = pctLeft + "%"; }, 90);
    // Gauge color tracks how much is left: ok = green, mid = gold, low = red.
    var hero = document.getElementById("creditsCard");
    if (hero) hero.setAttribute("data-level", pctLeft > 50 ? "ok" : pctLeft > 20 ? "mid" : "low");
    // Dashboard v2: the refill line reads honestly per plan type and status.
    // A trial's grant is one-time; only live subscriptions refill; a canceled
    // plan ENDS on the period end instead of renewing.
    var periodEnd = row && row.current_period_end;
    var refillRow = document.getElementById("usageRefillRow");
    if (refillRow) {
      if (!plan) refillRow.textContent = "";
      else if (!periodEnd) refillRow.textContent = "One-time trial credits";
      else if (canceled) refillRow.innerHTML = "Usable until <b>" + fmtDate(periodEnd) + "</b>";
      else refillRow.innerHTML = "Refills <b>" + fmtDate(periodEnd) + "</b>";
    } else {
      setText("usageRefill", fmtDate(periodEnd));
    }
    setText("billPlan", name ? name : "No active plan");
    var priceLabel = plan === "free" ? "$0" : planPriceLabel(plan);
    setText("billPrice", priceLabel);
    var pw = document.getElementById("billPriceWrap");
    if (pw) pw.style.display = priceLabel === "—" ? "none" : "";
    setText("billStatus", status ? statusLabel(status) : "");
    setText("billRenew", fmtDate(periodEnd));
    var renewLabel = document.getElementById("billRenewLabel");
    if (renewLabel) renewLabel.textContent = canceled ? "Ends" : "Renews";
    // Dashboard v2: hide empty detail rows instead of printing placeholder
    // dashes. Old markup (no row wrappers) keeps the previous behavior.
    var sRow = document.getElementById("billStatusRow");
    if (sRow) sRow.style.display = status ? "" : "none";
    var rRow = document.getElementById("billRenewRow");
    if (rRow) rRow.style.display = periodEnd ? "" : "none";
    // Low-credit nudge (dashboard v3): only when a real plan is low, with
    // honest copy per situation. The button deep-links to the Plan tab.
    var nudge = document.getElementById("lowCreditNudge");
    if (nudge) {
      var low = !!plan && limit > 0 && pctLeft <= 20;
      nudge.style.display = low ? "" : "none";
      if (low) {
        var lowMsg = plan === "free"
          ? "Your trial credits are almost used up. Pick a plan to keep creating."
          : canceled
            ? "Running low, and your plan ends " + fmtDate(periodEnd) + ". Restart a plan to keep your credits coming."
            : "Running low for this cycle. Credits refill " + fmtDate(periodEnd) + ", or upgrade for more headroom.";
        setText("lowCreditMsg", lowMsg);
      }
    }
    // Overview tab's plan-at-a-glance card (tabs, 2026-06-11): name plus one
    // honest status line; the full detail lives on the Plan & billing tab.
    setText("ovPlanName", name ? name : "no plan yet");
    var ovHint = document.getElementById("ovPlanHint");
    if (ovHint) {
      if (!plan) ovHint.textContent = "Pick a plan to get monthly credits.";
      else if (!periodEnd) ovHint.textContent = "One-time trial credits. Every tool unlocked.";
      else if (canceled) ovHint.textContent = "Ends " + fmtDate(periodEnd) + ".";
      else ovHint.textContent = "Renews " + fmtDate(periodEnd) + ".";
    }
    var noPlan = document.getElementById("noPlanHint");
    if (noPlan) {
      if (plan) { noPlan.style.display = "none"; }
      else {
        noPlan.textContent = "We couldn't load your plan just now. Refresh in a moment, or pick a plan below.";
        noPlan.style.display = "";
      }
    }
    markCurrentPlan(plan);
  }

  // Dashboard v2: the tier button matching the active plan flips to a quiet
  // "Current plan" state, and the other buttons label honestly relative to
  // the current tier (a Studio subscriber sees "Switch" on Starter, not
  // "Upgrade"). Free/null plans keep plain "Upgrade" everywhere.
  var TIER_ORDER = { starter: 1, pro: 2, studio: 3 };
  function markCurrentPlan(planKey) {
    // Highlight the whole card for the active plan (Free Trial included, so
    // a trial user sees where they stand in the lineup).
    var cards = document.querySelectorAll(".tier3[data-plan]");
    for (var c = 0; c < cards.length; c++) {
      var isCard = !!planKey && cards[c].getAttribute("data-plan") === planKey;
      cards[c].classList.toggle("is-current", isCard);
    }
    var freeState = document.getElementById("freePlanState");
    if (freeState) freeState.textContent = planKey === "free" ? "Your current plan" : "Where everyone starts";
    var btns = document.querySelectorAll("[data-checkout]");
    var curRank = TIER_ORDER[planKey] || 0;
    for (var i = 0; i < btns.length; i++) {
      var b = btns[i];
      // Only relabel buttons that opted in (the dashboard tier cards); the
      // /studio pricing cards keep their own labels.
      if (!b.hasAttribute("data-plan-btn")) continue;
      var key = b.getAttribute("data-checkout");
      if (planKey && key === planKey) {
        b.setAttribute("data-current", "1");
        b.classList.add("is-current");
        b.textContent = "Current plan";
      } else {
        b.removeAttribute("data-current");
        b.classList.remove("is-current");
        b.textContent = curRank && TIER_ORDER[key] < curRank ? "Switch" : "Upgrade";
      }
    }
  }

  function renderEntitlement(d) {
    renderActivity(d && d.recent);
    renderUsage(d && d.usage, d && typeof d.balance === "number" ? d.balance : 0);
    renderTeam(d && d.team);
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

  /* --------------------- USAGE INSIGHTS (dashboard v3) -------------------- */
  // Renders the Overview usage card from entitlement v8's `usage` aggregates:
  // a 14-day daily bar chart, a 30-day per-feature breakdown, and an honest
  // pace/runway sentence. Hidden entirely while the API doesn't send `usage`
  // (v7 and earlier), so the dashboard degrades cleanly.
  var FEATURE_COLORS = {
    "Generation": "#E4C77D",
    "Source check": "#4FD1A5",
    "Transcription": "#9D8CFF",
    "Indexing": "#9FB3CC"
  };
  function fmtCredits(c) {
    if (c >= 1) return (Math.round(c * 10) / 10).toLocaleString();
    return c > 0 ? "under 1" : "0";
  }
  function renderUsage(usage, balance) {
    var card = document.getElementById("usageCard");
    if (!card) return;
    if (!usage) { card.style.display = "none"; return; }
    card.style.display = "";
    var byDay = {};
    var daily = usage.daily || [];
    for (var i = 0; i < daily.length; i++) byDay[daily[i].d] = daily[i].credits;
    // Last 14 days, zero-filled, oldest first. Day keys are UTC to match the
    // server's bucketing.
    var days = [], max = 0;
    for (var k = 13; k >= 0; k--) {
      var dt = new Date(Date.now() - k * 86400000);
      var cr = byDay[dt.toISOString().slice(0, 10)] || 0;
      if (cr > max) max = cr;
      days.push({ label: dt.getUTCDate(), credits: cr, dt: dt });
    }
    var chart = document.getElementById("usageChart");
    if (chart) {
      var html = "";
      for (var j = 0; j < days.length; j++) {
        var d = days[j];
        var pct = max ? Math.max(4, Math.round(d.credits / max * 100)) : 0;
        var title = d.dt.toLocaleDateString(undefined, { month: "short", day: "numeric" }) +
          " · " + fmtCredits(d.credits) + (d.credits === 1 ? " credit" : " credits");
        html += '<span class="ubar' + (d.credits ? "" : " zero") + '" title="' + esc(title) + '">' +
          '<i data-h="' + pct + '"></i><b>' + d.label + "</b></span>";
      }
      chart.innerHTML = html;
      // Heights land a beat later so the grow-in transition plays on screen.
      setTimeout(function () {
        var bars = chart.querySelectorAll("i[data-h]");
        for (var b = 0; b < bars.length; b++) bars[b].style.height = bars[b].getAttribute("data-h") + "%";
      }, reducedMotion() ? 0 : 140);
    }
    var brk = document.getElementById("usageBreak");
    if (brk) {
      var feats = (usage.by_feature || []).slice(0, 4);
      if (!feats.length) {
        brk.innerHTML = '<p class="hint" style="margin:0">No usage yet. Open Modulus Studio and run your first generation; your numbers show up here.</p>';
      } else {
        var fmax = feats[0].credits || 1;
        var fh = "";
        for (var f = 0; f < feats.length; f++) {
          var fe = feats[f];
          var color = FEATURE_COLORS[fe.feature] || "#E4C77D";
          fh += '<div class="ubrow"><span class="f">' + esc(fe.feature) + '</span>' +
            '<span class="bar"><i style="--fc:' + color + '" data-w="' + Math.max(3, Math.round(fe.credits / fmax * 100)) + '"></i></span>' +
            '<span class="v">' + fmtCredits(fe.credits) + " credits</span></div>";
        }
        brk.innerHTML = fh;
        setTimeout(function () {
          var ws = brk.querySelectorAll("i[data-w]");
          for (var w = 0; w < ws.length; w++) ws[w].style.width = ws[w].getAttribute("data-w") + "%";
        }, reducedMotion() ? 0 : 140);
      }
    }
    // Pace and runway, computed from the last 7 days. Never alarmist: round
    // up to a floor of 1 day and switch to "months" past 90 days.
    var pace = document.getElementById("usagePace");
    if (pace) {
      var sum7 = 0;
      for (var p = days.length - 7; p < days.length; p++) sum7 += days[p].credits;
      var avg = sum7 / 7;
      if (avg <= 0) {
        pace.textContent = "No usage this week. Your balance isn't going anywhere.";
      } else {
        var daysLeft = balance / avg;
        var avgLabel = avg >= 1 ? String(Math.round(avg * 10) / 10) : "under 1";
        pace.textContent = daysLeft > 90
          ? "You're averaging " + avgLabel + " credits a day this week. At that pace you have months of headroom."
          : "You're averaging " + avgLabel + " credits a day this week. Your balance covers about " +
            Math.max(1, Math.round(daysLeft)) + " more " + (Math.max(1, Math.round(daysLeft)) === 1 ? "day" : "days") + " at that pace.";
      }
    }
  }

  /* ------------------------ TEAM SEATS (v9, 2026-06-11) ------------------- */
  // The owner of a Pro (3 seats) or Studio (5 seats) plan invites teammates
  // by share-link; everyone shares the plan's credit pool. The `team` edge
  // function manages the roster; entitlement v9 reports it.
  function teamReq(action, payload) {
    return accessToken().then(function (token) {
      if (!token) return { ok: false, status: 401, d: { error: "not_authenticated" } };
      var body = payload || {};
      body.action = action;
      return fetch(fnUrl("team"), {
        method: "POST",
        headers: { "content-type": "application/json", "Authorization": "Bearer " + token },
        body: JSON.stringify(body)
      }).then(function (r) { return r.json().then(function (d) { return { ok: r.ok, status: r.status, d: d }; }); });
    }).catch(function () { return { ok: false, status: 0, d: { error: "network", message: "Network hiccup. Try again." } }; });
  }
  function copyText(text) {
    if (navigator.clipboard && navigator.clipboard.writeText) return navigator.clipboard.writeText(text);
    return new Promise(function (resolve, reject) {
      var ta = document.createElement("textarea");
      ta.value = text; ta.style.position = "fixed"; ta.style.opacity = "0";
      document.body.appendChild(ta); ta.select();
      var ok = false;
      try { ok = document.execCommand("copy"); } catch (e) { ok = false; }
      document.body.removeChild(ta);
      if (ok) resolve(); else reject(new Error("copy"));
    });
  }
  function joinUrl(token) { return "https://modulustech.ai/join?token=" + token; }
  function renderTeam(team) {
    var body = document.getElementById("teamBody");
    var note = document.getElementById("teamSeatNote");
    if (!body) return;
    if (!team) {
      if (note) note.textContent = "";
      body.innerHTML = '<p class="hint" style="margin:0">Team info didn\'t load just now. Refresh in a moment.</p>';
      return;
    }
    if (team.role === "member") {
      if (note) note.textContent = "Shared plan";
      body.innerHTML =
        '<p class="muted" style="margin:0 0 6px">You\'re on <b style="color:var(--s-ink)">' + esc(team.owner_email || "your team owner") + "</b>'s team.</p>" +
        '<p class="hint" style="margin:0 0 14px">You share their plan and credits; anything you create spends from the team balance.</p>' +
        '<button class="t-link danger" type="button" data-team-leave>Leave team</button>' +
        '<p class="tnote" id="teamNote"></p>';
      return;
    }
    var seats = team.seats || 1;
    var members = team.members || [];
    var invites = team.invites || [];
    var used = 1 + members.length;
    if (note) note.textContent = used + " of " + seats + (seats === 1 ? " seat" : " seats") + " used";
    if (seats <= 1) {
      body.innerHTML =
        '<p class="muted" style="margin:0 0 6px">Bring your team.</p>' +
        '<p class="hint" style="margin:0 0 14px">Pro includes 3 seats and Studio includes 5. Teammates sign in with their own account and share one pool of credits, so a whole ministry or content team runs on one plan.</p>' +
        '<button class="s-btn gold sm" type="button" data-goto-tab="plan">See plans</button>';
      return;
    }
    var html = '<div class="seatdots" aria-hidden="true">';
    for (var s = 0; s < seats; s++) {
      html += '<i class="' + (s < used ? "on" : s < used + invites.length ? "pend" : "") + '"></i>';
    }
    html += "</div>";
    html += '<div class="trow"><span class="t-who">You</span><span class="t-pill">Owner</span></div>';
    for (var i = 0; i < members.length; i++) {
      var m = members[i];
      html += '<div class="trow"><span class="t-who">' + esc(m.email || "Teammate") +
        '</span><span class="t-act"><span class="t-meta">Joined ' + esc(fmtDate(m.added_at)) +
        '</span><button class="t-link danger" type="button" data-team-remove="' + esc(m.id) + '">Remove</button></span></div>';
    }
    for (var v = 0; v < invites.length; v++) {
      var inv = invites[v];
      html += '<div class="trow"><span class="t-who">' + esc(inv.email) +
        '</span><span class="t-act"><span class="t-meta">Invited &middot; expires ' + esc(fmtDate(inv.expires_at)) +
        '</span><button class="t-link" type="button" data-team-copy="' + esc(inv.token) + '">Copy link</button>' +
        '<button class="t-link danger" type="button" data-team-revoke="' + esc(inv.token) + '">Revoke</button></span></div>';
    }
    if (used + invites.length < seats) {
      html += '<form class="tinvite" id="teamInviteForm" autocomplete="off">' +
        '<input id="teamInviteEmail" type="email" required placeholder="teammate@company.com" aria-label="Teammate email" />' +
        '<button class="s-btn gold sm" type="submit" id="teamInviteBtn">Create invite link</button></form>';
    }
    html += '<p class="hint" style="margin-top:12px">Each teammate creates their own free account, then your link moves them onto this plan. Everyone shares this plan\'s credits, and the activity feed shows who spent what.</p>';
    html += '<p class="tnote" id="teamNote"></p>';
    body.innerHTML = html;
  }
  function teamNote(msg, ok) {
    var n = document.getElementById("teamNote");
    if (n) { n.textContent = msg; n.className = "tnote " + (ok ? "ok" : "err"); }
  }
  function wireTeamActions() {
    var body = document.getElementById("teamBody");
    if (!body || body.getAttribute("data-wired")) return;
    body.setAttribute("data-wired", "1");
    body.addEventListener("click", function (ev) {
      var t = ev.target;
      var el = t && t.closest ? t.closest("[data-team-copy],[data-team-revoke],[data-team-remove],[data-team-leave]") : null;
      if (!el) return;
      ev.preventDefault();
      if (el.hasAttribute("data-team-copy")) {
        var url = joinUrl(el.getAttribute("data-team-copy"));
        copyText(url)
          .then(function () { teamNote("Invite link copied. Send it to your teammate however you like.", true); })
          .catch(function () { teamNote("Couldn't copy automatically. The link: " + url, false); });
        return;
      }
      var action = el.hasAttribute("data-team-revoke") ? "revoke" : el.hasAttribute("data-team-remove") ? "remove" : "leave";
      if (action === "remove" && !window.confirm("Remove this teammate? They keep their own account but lose access to this plan's credits.")) return;
      if (action === "leave" && !window.confirm("Leave this team? You'll go back to your own plan.")) return;
      var payload = action === "revoke" ? { token: el.getAttribute("data-team-revoke") }
        : action === "remove" ? { member_id: el.getAttribute("data-team-remove") } : {};
      el.setAttribute("disabled", "1");
      teamReq(action, payload).then(function (res) {
        if (!res.ok) {
          el.removeAttribute("disabled");
          teamNote((res.d && res.d.message) || "That didn't work. Try again in a moment.", false);
          return;
        }
        if (action === "leave") { window.location.reload(); return; }
        loadEntitlement().then(function () {
          teamNote(action === "revoke" ? "Invite revoked. The seat is free again." : "Teammate removed.", true);
        });
      });
    });
    body.addEventListener("submit", function (ev) {
      var form = ev.target;
      if (!form || form.id !== "teamInviteForm") return;
      ev.preventDefault();
      var input = document.getElementById("teamInviteEmail");
      var btn = document.getElementById("teamInviteBtn");
      var email = (input && input.value || "").trim();
      if (!email) return;
      if (btn) { btn.setAttribute("disabled", "1"); btn.textContent = "Creating…"; }
      teamReq("invite", { email: email }).then(function (res) {
        if (!res.ok) {
          if (btn) { btn.removeAttribute("disabled"); btn.textContent = "Create invite link"; }
          teamNote((res.d && res.d.message) || "Couldn't create the invite.", false);
          return;
        }
        var url = res.d && res.d.url;
        loadEntitlement().then(function () {
          if (url) {
            copyText(url)
              .then(function () { teamNote("Invite created and the link is on your clipboard. Send it to " + email + ".", true); })
              .catch(function () { teamNote("Invite created. Use Copy link above to grab it.", true); });
          } else { teamNote("Invite created.", true); }
        });
      });
    });
  }
  // /join page: accept an invite link. Signed out -> stash the token, send
  // them to sign in; the dashboard finishes the join when they land back.
  function wireJoin() {
    var card = document.getElementById("joinCard");
    if (!card) return;
    var status = document.getElementById("joinStatus");
    var signIn = document.getElementById("joinSignIn");
    var go = document.getElementById("joinGo");
    function say(msg) { if (status) status.textContent = msg; }
    var m = location.search.match(/[?&]token=([0-9a-fA-F-]{16,})/);
    var token = m ? m[1] : null;
    if (!token) { try { token = localStorage.getItem("modulus-pending-join"); } catch (e) {} }
    if (!token) { say("This invite link is missing its code. Ask your team owner for a fresh one."); return; }
    try { localStorage.setItem("modulus-pending-join", token); } catch (e) {}
    if (!hasAuth) { say("Sign in, or create a free account with the invited email, to take your seat."); if (signIn) signIn.style.display = ""; return; }
    accessToken().then(function (tok) {
      if (!tok) {
        say("Sign in, or create a free account with the invited email, to take your seat.");
        if (signIn) signIn.style.display = "";
        return;
      }
      say("Accepting your invite…");
      teamReq("accept", { token: token }).then(function (res) {
        try { localStorage.removeItem("modulus-pending-join"); } catch (e) {}
        if (res.ok) {
          say("You're in. You now share " + ((res.d && res.d.owner_email) || "your team owner") + "'s plan and credits.");
          if (go) go.style.display = "";
        } else {
          say((res.d && res.d.message) || "Couldn't accept this invite.");
          if (res.d && res.d.error === "wrong_email" && signIn) {
            signIn.textContent = "Sign in with the invited email";
            signIn.style.display = "";
          } else if (go) { go.style.display = ""; }
        }
      });
    });
  }

  // Relative time for the activity card: "just now", "5m ago", "3h ago",
  // then fall back to the date.
  function relTime(iso) {
    if (!iso) return "";
    var then = new Date(iso).getTime();
    if (isNaN(then)) return "";
    var diff = Math.max(0, (new Date().getTime() - then) / 1000);
    if (diff < 60) return "just now";
    if (diff < 3600) return Math.floor(diff / 60) + "m ago";
    if (diff < 86400) return Math.floor(diff / 3600) + "h ago";
    if (diff < 604800) return Math.floor(diff / 86400) + "d ago";
    return fmtDate(iso);
  }

  // Render the last few credit charges. credits are whole-credit decimals
  // (e.g. 0.49); show "<1 credit" rather than a confusing 0.
  function renderActivity(recent) {
    var list = document.getElementById("activityList");
    if (!list) return;
    if (!recent || !recent.length) {
      list.innerHTML = '<div class="act-empty">No activity yet. When you generate, repurpose, or transcribe, your credit charges show up here.</div>';
      return;
    }
    var html = "";
    for (var i = 0; i < recent.length; i++) {
      var e = recent[i];
      var c = typeof e.credits === "number" ? e.credits : 0;
      var cost = c >= 1 ? (Math.round(c * 10) / 10).toLocaleString() + " credits"
        : c > 0 ? "<1 credit" : "free";
      // v9: on a team, each charge names who spent it ("You" or their email).
      var by = e.by ? ' <i class="a-by">&middot; ' + esc(e.by) + "</i>" : "";
      html += '<div class="actrow"><span class="a-feat">' + esc(e.feature || "Activity") + by +
        '</span><span class="a-when">' + esc(relTime(e.at)) + '</span>' +
        '<span class="a-cost">' + cost + '</span></div>';
    }
    list.innerHTML = html;
  }

  function esc(s) {
    return String(s == null ? "" : s).replace(/[&<>"]/g, function (ch) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[ch];
    });
  }

  // Read the signed-in user's real plan + credits from the entitlement
  // function. Returns a promise resolving to the entitlement payload (or
  // null) so callers can sequence on the FIRST render (loader handoff,
  // post-checkout activation polling).
  function loadEntitlement(opts) {
    var skipRender = opts && opts.skipRender;
    return accessToken().then(function (token) {
      if (!token) { if (!skipRender) renderPlan(null); return null; }
      return fetch(fnUrl("entitlement"), { method: "GET", headers: { "Authorization": "Bearer " + token } })
        .then(function (r) { return r.ok ? r.json() : null; })
        .then(function (d) { if (!skipRender) renderEntitlement(d); return d; })
        .catch(function () { if (!skipRender) renderPlan(null); return null; });
    });
  }

  // After a Stripe checkout the webhook grants credits asynchronously. Poll,
  // but do NOT render entitlements that predate the purchase (the account
  // still reads "Free Trial" until the webhook lands, and painting that
  // would look like the payment failed). Keep "Activating..." up until a
  // paid plan arrives; after the poll budget, level with the user.
  function pollEntitlement(n) {
    if (n > 6) {
      var hint = document.getElementById("noPlanHint");
      if (hint) {
        hint.textContent = "This is taking a little longer than usual. Your payment is safe; refresh in a minute and your plan will be here.";
        hint.style.display = "";
      }
      return;
    }
    loadEntitlement({ skipRender: true }).then(function (d) {
      var paid = d && d.plan && d.plan.key && d.plan.key !== "free" && d.subscription;
      if (paid) { renderEntitlement(d); return; }
      setTimeout(function () { pollEntitlement(n + 1); }, 5000);
    });
  }

  function wireAccount() {
    var card = document.getElementById("accountCard");
    if (!card) return; // not the dashboard
    var inEl = document.getElementById("acctSignedIn");
    var outEl = document.getElementById("acctSignedOut");
    var signOut = document.getElementById("signOutBtn");
    var manage = document.getElementById("manageBillingBtn");
    if (signOut) signOut.addEventListener("click", function (e) { e.preventDefault(); api.signOut(); });
    // Manage billing opens the Stripe Customer Portal (invoices, receipts,
    // update card, cancel, switch plans). The billing-portal function creates
    // a one-time session for the signed-in customer. A user with no paid plan
    // yet (no Stripe customer) is sent to pricing with a friendly note.
    if (manage) {
      manage.setAttribute("href", "#");
      manage.addEventListener("click", function (e) {
        e.preventDefault();
        if (manage.getAttribute("data-busy")) return;
        var label = manage.textContent;
        manage.setAttribute("data-busy", "1");
        manage.textContent = "Opening…";
        function done() { manage.textContent = label; manage.removeAttribute("data-busy"); }
        accessToken().then(function (token) {
          if (!token) { window.location.assign("/login"); return; }
          return fetch(fnUrl("billing-portal"), {
            method: "POST",
            headers: { "content-type": "application/json", "Authorization": "Bearer " + token }
          }).then(function (r) { return r.json().then(function (d) { return { ok: r.ok, status: r.status, d: d }; }); })
            .then(function (res) {
              if (res.ok && res.d && res.d.url) { window.location.assign(res.d.url); return; }
              done();
              if (res.status === 409) { alert((res.d && res.d.message) || "Choose a plan first."); window.location.assign("/studio#pricing"); }
              else { alert((res.d && res.d.error) || "Couldn't open billing. Try again in a moment."); }
            });
        }).catch(function () { done(); alert("Couldn't open billing. Try again in a moment."); });
      });
    }

    // Profile: populate the name, show the right credential control (password
    // for email accounts, a "signed in with Google" chip for OAuth), and save.
    function wireProfile(user) {
      var form = document.getElementById("profileForm");
      if (!form) return;
      var meta = user.user_metadata || {};
      var nameInput = document.getElementById("pf-name");
      if (nameInput) nameInput.value = meta.full_name || meta.name || "";
      // provider lives in app_metadata.provider / providers.
      var app = user.app_metadata || {};
      var providers = app.providers || (app.provider ? [app.provider] : []);
      var isEmail = providers.indexOf("email") !== -1 || providers.length === 0;
      var passWrap = document.getElementById("pf-pass-wrap");
      var chip = document.getElementById("pf-provider");
      if (passWrap) passWrap.style.display = isEmail ? "" : "none";
      if (chip) chip.style.display = isEmail ? "none" : "";
      form.addEventListener("submit", function (e) {
        e.preventDefault();
        var note = document.getElementById("pf-note");
        function setNote(msg, ok) { if (note) { note.textContent = msg; note.className = "pnote " + (ok ? "ok" : "err"); } }
        var btn = document.getElementById("pf-save");
        if (btn && btn.getAttribute("data-busy")) return;
        var newName = (nameInput && nameInput.value || "").trim();
        var newPass = isEmail ? (document.getElementById("pf-pass") || {}).value : "";
        if (newPass && newPass.length < 8) { setNote("Password needs at least 8 characters.", false); return; }
        var update = { data: { full_name: newName } };
        if (newPass) update.password = newPass;
        if (btn) { btn.setAttribute("data-busy", "1"); btn.textContent = "Saving…"; }
        ensureClient().then(function (c) { return c.auth.updateUser(update); }).then(function (r) {
          if (btn) { btn.removeAttribute("data-busy"); btn.textContent = "Save changes"; }
          if (r && r.error) { setNote(r.error.message, false); return; }
          var pf = document.getElementById("pf-pass"); if (pf) pf.value = "";
          setText("acctHello", "Welcome back, " + (newName || "there") + ".");
          setNote(newPass ? "Saved. Your name and password are updated." : "Saved.", true);
        }).catch(function (err) {
          if (btn) { btn.removeAttribute("data-busy"); btn.textContent = "Save changes"; }
          setNote(String(err), false);
        });
      });
    }
    function show(signedIn) {
      // Session resolved: drop the pre-paint loader state (html[data-session])
      // and let inline styles decide what's visible.
      try { document.documentElement.removeAttribute("data-session"); } catch (e) {}
      var loading = document.getElementById("acctLoading");
      if (loading) loading.style.display = "none";
      if (inEl) inEl.style.display = signedIn ? "" : "none";
      if (outEl) outEl.style.display = signedIn ? "none" : "block";
      // First reveal: replay the card entrance on whichever tab is visible
      // (the tab script handles subsequent switches).
      if (signedIn) {
        var vis = document.querySelector(".dpanel:not([hidden])");
        if (vis) { vis.classList.remove("panel-in"); void vis.offsetWidth; vis.classList.add("panel-in"); }
      }
    }

    wireTeamActions();

    // Preview the populated dashboard without a backend: account.html?preview=1
    // (add &low=1 for the low-credit nudge, &member=1 / &solo=1 for team states)
    if (/[?&]preview=1/.test(location.search)) {
      show(true);
      setText("acctHello", "Welcome back, James.");
      setText("acctEmail", "you@modulustech.ai");
      var lowDemo = /[?&]low=1/.test(location.search);
      renderPlan({ plan: "pro", display_name: "Pro", status: "active", balance: lowDemo ? 140 : 1280, limit: 1500, current_period_end: "2026-07-01" });
      renderActivity([
        { feature: "Source check", credits: 2.4, at: new Date(Date.now() - 6e4).toISOString() },
        { feature: "Generation", credits: 0.9, at: new Date(Date.now() - 36e5).toISOString() },
        { feature: "Indexing", credits: 0.36, at: new Date(Date.now() - 72e5).toISOString() }
      ]);
      var demoDaily = [];
      var demoSpend = [3.2, 0, 5.1, 7.8, 2.4, 0, 1.2, 9.6, 4.3, 6.1, 0, 2.8, 5.5, 3.9];
      for (var di = 0; di < 14; di++) {
        demoDaily.push({ d: new Date(Date.now() - (13 - di) * 86400000).toISOString().slice(0, 10), credits: demoSpend[di] });
      }
      renderUsage({
        window_days: 30,
        total_credits: 86.4,
        by_feature: [
          { feature: "Generation", credits: 41.2 },
          { feature: "Source check", credits: 28.7 },
          { feature: "Transcription", credits: 12.1 },
          { feature: "Indexing", credits: 4.4 }
        ],
        daily: demoDaily,
        capped: false
      }, lowDemo ? 140 : 1280);
      if (/[?&]member=1/.test(location.search)) {
        renderTeam({ role: "member", owner_email: "owner@ministry.org" });
      } else if (/[?&]solo=1/.test(location.search)) {
        renderTeam({ role: "owner", seats: 1, members: [], invites: [] });
      } else {
        renderTeam({
          role: "owner", seats: 3,
          members: [{ id: "m1", email: "editor@ministry.org", added_at: "2026-06-01T00:00:00Z" }],
          invites: [{ token: "demo-token-1234", email: "writer@ministry.org", created_at: "2026-06-10T00:00:00Z", expires_at: "2026-06-24T00:00:00Z" }]
        });
      }
      return;
    }
    if (!hasAuth) { show(false); return; }

    var justSubscribed = /[?&]checkout=success/.test(location.search);

    ensureClient().then(function (c) {
      c.auth.getUser().then(function (r) {
        var user = r && r.data && r.data.user;
        if (!user) { show(false); return; }
        var meta = user.user_metadata || {};
        var name = meta.full_name || meta.name || (user.email ? user.email.split("@")[0] : "there");
        setText("acctHello", "Welcome back, " + name + ".");
        setText("acctEmail", user.email || "");
        wireProfile(user);
        if (justSubscribed) {
          // Post-checkout: reveal immediately with the Activating state; the
          // poll holds it until the webhook's paid plan actually arrives.
          show(true);
          setText("acctPlanBadge", "Activating…");
          var hint = document.getElementById("noPlanHint");
          if (hint) { hint.textContent = "Finishing your subscription. Your plan and credits will appear here in a moment."; hint.style.display = ""; }
          pollEntitlement(0);
          // Clean the URL so a refresh doesn't re-trigger.
          try { history.replaceState({}, "", "/account"); } catch (e) {}
        } else {
          // Finish a join that started on /join while signed out: accept the
          // stashed invite first so the very first render shows the team.
          var pendingJoin = null;
          try { pendingJoin = localStorage.getItem("modulus-pending-join"); } catch (e) {}
          if (pendingJoin) { try { localStorage.removeItem("modulus-pending-join"); } catch (e) {} }
          var preStep = pendingJoin
            ? teamReq("accept", { token: pendingJoin }).then(function (res) {
                if (res.ok) { try { window.location.hash = "#team"; } catch (e) {} }
                else if (res.d && res.d.message) { window.alert(res.d.message); }
              })
            : Promise.resolve();
          // Normal load: keep the branded loader up until the first
          // entitlement render so the dashboard never paints placeholder
          // values. The promise resolves (never rejects) even on failure.
          preStep.then(function () { return loadEntitlement(); }).then(function (d) {
            show(true);
            // Resume a checkout the visitor started before signing in. Only
            // when they are not already on a paid plan, and only once.
            var pending = null;
            try { pending = localStorage.getItem("modulus-pending-plan"); } catch (e) {}
            if (!pending) return;
            try { localStorage.removeItem("modulus-pending-plan"); } catch (e) {}
            var paid = d && d.plan && d.plan.key && d.plan.key !== "free" && d.subscription;
            if (paid) return;
            var btn = document.querySelector('[data-checkout="' + pending + '"]');
            if (btn && !btn.getAttribute("data-current")) btn.click();
          });
        }
      });
    });
  }

  function boot() { wireLogin(); wireCheckout(); wireAccount(); wireJoin(); }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", boot);
  else boot();
})();

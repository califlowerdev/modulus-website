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
    setText("usageUsed", balance.toLocaleString());
    setText("usageLimit", limit ? limit.toLocaleString() : "");
    setText("usagePct", pctLeft + "%");
    var bar = document.getElementById("usageBar"); if (bar) bar.style.width = pctLeft + "%";
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
    // Manage billing always has a destination: the Stripe customer portal
    // once configured, a plain email to the founder until then. Hiding it
    // while the page promises "cancel anytime" would leave no cancel path.
    if (manage) {
      manage.setAttribute(
        "href",
        CONFIG.STRIPE_PORTAL ||
          "mailto:james@modulustech.ai?subject=Manage%20my%20Modulus%20billing",
      );
    }
    function show(signedIn) {
      // Session resolved: drop the pre-paint loader state (html[data-session])
      // and let inline styles decide what's visible.
      try { document.documentElement.removeAttribute("data-session"); } catch (e) {}
      var loading = document.getElementById("acctLoading");
      if (loading) loading.style.display = "none";
      if (inEl) inEl.style.display = signedIn ? "" : "none";
      if (outEl) outEl.style.display = signedIn ? "none" : "block";
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
        var meta = user.user_metadata || {};
        var name = meta.full_name || meta.name || (user.email ? user.email.split("@")[0] : "there");
        setText("acctHello", "Welcome back, " + name + ".");
        setText("acctEmail", user.email || "");
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
          // Normal load: keep the branded loader up until the first
          // entitlement render so the dashboard never paints placeholder
          // values. The promise resolves (never rejects) even on failure.
          loadEntitlement().then(function () { show(true); });
        }
      });
    });
  }

  function boot() { wireLogin(); wireCheckout(); wireAccount(); }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", boot);
  else boot();
})();

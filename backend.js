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

  // The Modulus admin account. NOT a secret: this only reveals the owner-only
  // Marketing tab in the UI. The data behind it is gated server-side in the
  // admin-analytics edge function, which 403s any token whose user id != this.
  var OWNER_UID = "0e83d99f-9140-425a-acb5-52779d1e09aa";

  // Cloudflare Turnstile (bot protection on email/password auth). The widget on
  // the login page produces a single-use token; we pass it to Supabase, which
  // verifies it server-side. Safe to send even before captcha is enabled in
  // Supabase (it's ignored then), so the frontend can ship ahead of the toggle.
  function captchaToken() {
    try { return (window.turnstile && window.turnstile.getResponse) ? (window.turnstile.getResponse() || "") : ""; }
    catch (e) { return ""; }
  }
  function captchaReset() {
    try { if (window.turnstile && window.turnstile.reset) window.turnstile.reset(); } catch (e) { /* noop */ }
  }

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
          // B1 hardening (Anti pre-launch): keep the Supabase session token in
          // sessionStorage, NOT the default localStorage — it doesn't persist across
          // browser restarts and has a smaller XSS exposure window. Matches the #143
          // invite stash + the runbook B1 rule.
          storage: window.sessionStorage,
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
    var ICON = '<svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="8.4" r="3.6"/><path d="M5.2 20c1.1-3.5 3.9-5.2 6.8-5.2s5.7 1.7 6.8 5.2"/></svg>';
    for (var i = 0; i < links.length; i++) {
      links[i].setAttribute("href", "/account");
      links[i].title = "Your account";
      // Header: a compact account icon in place of the name. Footer: a clear text link.
      if (links[i].closest && links[i].closest(".nav")) {
        links[i].innerHTML = ICON;
        links[i].setAttribute("aria-label", "Your account");
        links[i].classList.add("auth-ava-link");
      } else {
        links[i].textContent = "Your account";
      }
    }
  }

  var api = {
    configured: hasAuth,
    anonKey: CONFIG.SUPABASE_ANON_KEY, // public anon key; the assistant widget reads it to authenticate its /ask call
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
      return ensureClient().then(function (c) { return c.auth.signInWithPassword({ email: email, password: pw, options: { captchaToken: captchaToken() } }); });
    },
    signUp: function (email, pw, name, marketing, birthday) {
      // emailRedirectTo: the confirmation link should land on /account (an
      // app page that loads the SDK and consumes the session fragment), not
      // the homepage where supabase-js never loads and the token hash would
      // just sit in the URL. /account is already in the Supabase redirect
      // allowlist (the Google flow uses it). full_name goes into
      // user_metadata so the dashboard greeting uses their actual name,
      // same as Google-provider accounts.
      return ensureClient().then(function (c) {
        var opts = { emailRedirectTo: location.origin + "/account" };
        var data = {};
        if (name) data.full_name = name;
        // Optional. Stored in user_metadata only; never required to sign up.
        // Flag it in the privacy policy as data we collect (date of birth).
        if (birthday) data.birthday = birthday;
        // Capture marketing consent + provenance at the moment of signup. This
        // lives in user_metadata (durable, immediate — no accounts row exists
        // yet) and is copied to public.accounts.marketing_opt_in when the email
        // system goes live. ALWAYS recorded (true or false) so an explicit
        // decline is on record, not just an absence.
        data.marketing_opt_in = !!marketing;
        data.marketing_consent = {
          opt_in: !!marketing,
          at: new Date().toISOString(),
          source: "signup_form",
          text: "Send me product updates and occasional tips. No spam, unsubscribe anytime."
        };
        opts.data = data;
        opts.captchaToken = captchaToken();
        return c.auth.signUp({ email: email, password: pw, options: opts });
      });
    },
    signOut: function () {
      return ensureClient().then(function (c) { return c.auth.signOut(); }).then(function () {
        // Clear tab-scoped state on sign-out: the page reload preserves sessionStorage,
        // so the assistant chat history ("mod-ask-v2") and any pending invite/plan stash
        // would otherwise be visible to the NEXT user who signs in on a shared machine.
        try { sessionStorage.clear(); } catch (e) {}
        location.reload();
      });
    },
    resetPassword: function (email) {
      return ensureClient().then(function (c) { return c.auth.resetPasswordForEmail(email, { redirectTo: location.origin + "/login", captchaToken: captchaToken() }); });
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
    hasStoredSession = !!(ref && sessionStorage.getItem("sb-" + ref + "-auth-token"));
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
      // The recovery (set-new-password) submit is an authenticated updateUser call
      // that never uses a captcha, so hide the widget on this card.
      hide(document.querySelector(".cf-turnstile"));
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
      if (planParam) sessionStorage.setItem("modulus-pending-plan", planParam);
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
    // Turn a raw GoTrue captcha error into copy a human can act on. Once Supabase
    // enforces Turnstile, a not-yet-ready or already-used token returns a captcha
    // error; point the user at the visible check instead of echoing the raw string.
    function friendlyAuthError(msg) {
      if (msg && /captcha/i.test(msg)) return "Please complete the “verify you are human” check above, then try again.";
      return msg;
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
          note(r && r.error ? friendlyAuthError(r.error.message) : "Password reset link sent. Check your email.");
        }).catch(function (err) { note(String(err)); }).then(captchaReset);
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
        var optinEl = document.getElementById("a-marketing");
        var marketing = !!(optinEl && optinEl.checked);
        var creating = document.body.getAttribute("data-mode") === "create";
        var dob = (document.getElementById("a-dob") || {}).value; // optional
        if (creating) {
          var confirm = (document.getElementById("a-confirm") || {}).value;
          if (!pw || pw.length < 8) return note("Pick a password with at least 8 characters.");
          if (pw !== confirm) return note("Those passwords don’t match. Try again.");
        }
        (creating ? api.signUp(email, pw, name, marketing, dob) : api.signInEmail(email, pw)).then(function (r) {
          if (r && r.error) return note(friendlyAuthError(r.error.message));
          if (creating) {
            // Show the SAME message whether or not the address is already
            // registered. Supabase obfuscates an existing-account signup
            // (identities: []) and sends no email; branching on that here
            // would leak which emails have accounts (enumeration). The
            // combined wording keeps an existing user from waiting on a
            // confirmation that never comes.
            note("Almost there. Check your email to confirm your account. If you already have an account with this address, sign in instead or use “Forgot password?”.");
          }
          else location.href = "/account";
        }).catch(function (err) { note(String(err)); }).then(captchaReset);
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
          // A team member shares the owner's plan; the server rejects their
          // checkout, but never start one (the button is hidden anyway).
          if (dashIsMember) { alert("You're on a team plan and share its credits. To buy your own plan, leave the team first from the Team tab."); return; }
          var label = el.textContent;
          el.setAttribute("data-label", label);
          el.setAttribute("data-busy", "1");
          el.textContent = "Starting checkout…";
          function fail(msg) { el.textContent = label; el.removeAttribute("data-busy"); if (msg) alert(msg); }
          accessToken().then(function (token) {
            if (!token) {
              // Carry the chosen plan through the sign-in detour so the
              // dashboard can resume checkout instead of dropping intent.
              try { sessionStorage.setItem("modulus-pending-plan", tier); } catch (e2) {}
              window.location.assign("/login?plan=" + encodeURIComponent(tier));
              return;
            }
            return fetch(fnUrl("create-checkout"), {
              method: "POST",
              headers: { "content-type": "application/json", "Authorization": "Bearer " + token },
              body: JSON.stringify({ plan_key: tier, return_url: location.origin + "/account" })
            }).then(function (r) { return r.json().then(function (d) { return { ok: r.ok, d: d }; }); })
              .then(function (res) {
                if (res.ok && res.d && res.d.url) { window.location.assign(res.d.url); return; }
                // Existing subscribers switch plans in the Stripe portal
                // (prorated) instead of stacking a second subscription.
                if (res.d && res.d.error === "use_portal") {
                  fail();
                  var mb = document.getElementById("manageBillingBtn");
                  if (mb) { mb.click(); }
                  else {
                    alert(res.d.message || "You already have a plan. Switch it from Manage billing on your dashboard.");
                    window.location.assign("/account#plan");
                  }
                  return;
                }
                fail((res.d && (res.d.message || res.d.error)) || "Couldn't start checkout. Please try again.");
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
      var nudgeBtn = nudge.querySelector("[data-goto-tab]");
      if (low) {
        var lowMsg;
        if (dashIsMember) {
          // A member can't buy; point them at the owner, not a checkout.
          lowMsg = "Your team's shared credits are running low. Ask " + (dashOwnerEmail || "your team owner") + " about topping up or upgrading.";
          if (nudgeBtn) { nudgeBtn.textContent = "View team"; nudgeBtn.setAttribute("data-goto-tab", "team"); }
        } else {
          lowMsg = plan === "free"
            ? "Your trial credits are almost used up. Pick a plan to keep creating."
            : canceled
              ? "Running low, and your plan ends " + fmtDate(periodEnd) + ". Restart a plan to keep your credits coming."
              : "Running low for this cycle. Credits refill " + fmtDate(periodEnd) + ", or upgrade for more headroom.";
          if (nudgeBtn) { nudgeBtn.textContent = "See plans"; nudgeBtn.setAttribute("data-goto-tab", "plan"); }
        }
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

  // Team role for the signed-in user, set on every entitlement render so the
  // billing UI (Plan tab, low-credit nudge, checkout) can stay team-aware.
  var dashIsMember = false;
  var dashOwnerEmail = null;

  // A team member shares the owner's plan, so they never buy their own. Swap
  // the tier grid + Manage billing for a short "your owner handles billing"
  // notice, and neuter any checkout button that might still be in the DOM.
  function applyMemberBilling() {
    var memberBox = document.getElementById("memberBilling");
    var ownerBox = document.getElementById("ownerBilling");
    if (memberBox) memberBox.style.display = dashIsMember ? "" : "none";
    if (ownerBox) ownerBox.style.display = dashIsMember ? "none" : "";
    if (dashIsMember) {
      setText("memberOwnerEmail", dashOwnerEmail || "your team owner");
      setText("billPlan", "Shared team plan");
      var pw = document.getElementById("billPriceWrap");
      if (pw) pw.style.display = "none";
    }
  }

  function renderEntitlement(d) {
    dashIsMember = !!(d && d.team && d.team.role === "member");
    dashOwnerEmail = dashIsMember ? d.team.owner_email : null;
    renderActivity(d && d.recent);
    renderUsage(d && d.usage, d && typeof d.balance === "number" ? d.balance : 0, d && d.team);
    renderTeam(d && d.team);
    applyMemberBilling();
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
  function renderUsage(usage, balance, team) {
    var onTeamMember = !!(team && team.role === "member");
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
      var avgLabel = avg >= 1 ? String(Math.round(avg * 10) / 10) : "under 1";
      // A member's usage is their own slice, but the balance is the shared
      // pool, so projecting a runway off one person's pace would be wrong.
      // Show their pace and name the shared pool instead of a day count.
      if (onTeamMember) {
        pace.textContent = avg <= 0
          ? "No usage from you this week. Teammates spend from the same shared balance."
          : "You're averaging " + avgLabel + " credits a day this week. That's your pace alone; teammates spend from the same shared balance.";
      } else if (avg <= 0) {
        pace.textContent = "No usage this week. Your balance isn't going anywhere.";
      } else {
        var daysLeft = balance / avg;
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
      if (!token) return { ok: false, status: 401, d: { error: "not_authenticated", message: "Your session expired. Sign in again to manage your team." } };
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
    // The #teamNote live region lives outside #teamBody so it survives these
    // innerHTML writes; clear any stale outcome message on each re-render.
    var stale = document.getElementById("teamNote");
    if (stale) { stale.textContent = ""; stale.className = "tnote"; }
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
        '<button class="t-link danger" type="button" data-team-leave>Leave team</button>';
      return;
    }
    var seats = team.seats || 1;
    var members = team.members || [];
    var invites = team.invites || [];
    var used = 1 + members.length;
    // Genuinely solo (no teammates, no invites, 1-seat plan): show the upsell
    // and a blank seat note, not a contradictory "1 of 1 seat used".
    if (seats <= 1 && !members.length && !invites.length) {
      if (note) note.textContent = "";
      body.innerHTML =
        '<p class="muted" style="margin:0 0 6px">Your plan doesn\'t include team seats.</p>' +
        '<p class="hint" style="margin:0 0 14px">Team seats come with Pro (3 seats) and Studio (5 seats). Upgrade to invite your team, and everyone signs in with their own account and shares one pool of credits, so a whole ministry or content team runs on one plan.</p>' +
        '<button class="s-btn gold sm" type="button" data-goto-tab="plan">Upgrade your plan</button>';
      return;
    }
    // Over capacity (e.g. the plan was downgraded below the roster size): keep
    // the roster and Remove buttons visible so the owner can get back in range.
    var overCapacity = used > seats;
    if (note) note.textContent = used + " of " + seats + (seats === 1 ? " seat" : " seats") + " used";
    var cap = Math.max(seats, used + invites.length);
    var html = '<div class="seatdots" aria-hidden="true">';
    for (var s = 0; s < cap; s++) {
      html += '<i class="' + (s < used ? "on" : s < used + invites.length ? "pend" : "") + '"></i>';
    }
    html += "</div>";
    if (overCapacity) {
      html += '<p class="hint" style="margin:0 0 12px;color:#E2606B">Your current plan includes ' + seats + (seats === 1 ? " seat" : " seats") +
        '. Remove teammates below, or upgrade to keep the whole team.</p>';
    }
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
      if (action === "leave" && !window.confirm("Leave this team? You'll lose access to its shared credits and go back to your own account.")) return;
      var payload = action === "revoke" ? { token: el.getAttribute("data-team-revoke") }
        : action === "remove" ? { member_id: el.getAttribute("data-team-remove") } : {};
      el.setAttribute("disabled", "1");
      teamReq(action, payload).then(function (res) {
        if (!res.ok) {
          el.removeAttribute("disabled");
          if (res.status === 401) { teamNote("Your session expired. Sign in again to manage your team.", false); return; }
          teamNote((res.d && res.d.message) || "That didn't work. Try again in a moment.", false);
          return;
        }
        if (action === "leave") { window.location.reload(); return; }
        loadEntitlement().then(function () {
          // The re-render replaced the button that had focus; move focus to the
          // team region so keyboard users aren't dumped back to <body>.
          var tb = document.getElementById("teamBody"); if (tb) tb.focus();
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
          if (res.status === 401) { teamNote("Your session expired. Sign in again to manage your team.", false); return; }
          teamNote((res.d && res.d.message) || "Couldn't create the invite.", false);
          return;
        }
        var url = res.d && res.d.url;
        loadEntitlement().then(function () {
          // Re-render dropped focus; land it on the fresh invite input if a
          // seat remains, else the team region.
          var inp = document.getElementById("teamInviteEmail");
          if (inp) { inp.focus(); } else { var tb = document.getElementById("teamBody"); if (tb) tb.focus(); }
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
    if (!token) { try { token = sessionStorage.getItem("modulus-pending-join"); } catch (e) {} }
    if (!token) { say("This invite link is missing its code. Ask your team owner for a fresh one."); return; }
    try { sessionStorage.setItem("modulus-pending-join", token); } catch (e) {}
    if (!hasAuth) { say("Sign in, or create a free account with the invited email, to take your seat."); if (signIn) signIn.style.display = ""; return; }
    accessToken().then(function (tok) {
      if (!tok) {
        say("Sign in, or create a free account with the invited email, to take your seat.");
        if (signIn) signIn.style.display = "";
        return;
      }
      say("Accepting your invite…");
      teamReq("accept", { token: token }).then(function (res) {
        var err = res.d && res.d.error;
        // Keep the stashed token only when retrying could still work: a
        // wrong-account session (sign out, sign in right) or a network blip.
        // Terminal failures (used/expired/revoked) clear it.
        var keepStash = !res.ok && (err === "wrong_email" || err === "network");
        if (!keepStash) { try { sessionStorage.removeItem("modulus-pending-join"); } catch (e) {} }
        if (res.ok) {
          say("You're in. You now share " + ((res.d && res.d.owner_email) || "your team owner") + "'s plan and credits.");
          if (go) go.style.display = "";
        } else {
          say((res.d && res.d.message) || "Couldn't accept this invite.");
          if (err === "wrong_email" && signIn) {
            // Bare /login would bounce a live (wrong-account) session straight
            // back to the dashboard. Sign them out first so the form shows;
            // the kept stash lets /account finish the join after they sign in.
            signIn.textContent = "Sign out and sign in with the invited email";
            signIn.style.display = "";
            signIn.addEventListener("click", function (ev) {
              ev.preventDefault();
              ensureClient().then(function (c) { return c.auth.signOut(); })
                .then(function () { location.href = "/login"; })
                .catch(function () { location.href = "/login"; });
            });
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
      // + when credits were added (a grant or refund, i.e. negative cost), - when spent.
      var added = c < 0, amt = Math.abs(c);
      var cost = c === 0 ? "free" : (added ? "+" : "−") + (Math.round(amt * 10) / 10).toLocaleString();
      var costCls = c === 0 ? "" : (added ? " added" : " used");
      // v9: on a team, each charge names who spent it ("You" or their email).
      var by = e.by ? ' <i class="a-by">&middot; ' + esc(e.by) + "</i>" : "";
      html += '<div class="actrow"><span class="a-feat">' + esc(e.feature || "Activity") + by +
        '</span><span class="a-when">' + esc(relTime(e.at)) + '</span>' +
        '<span class="a-cost' + costCls + '">' + cost + '</span></div>';
    }
    list.innerHTML = html;
  }

  function esc(s) {
    return String(s == null ? "" : s).replace(/[&<>"']/g, function (ch) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[ch];
    });
  }

  /* --------------------------- MARKETING TAB ------------------------------ */
  // Owner-only analytics. Calls the admin-analytics edge function (which 403s
  // anyone but the owner) and paints the funnel, sources, top pages, and recent
  // signups. The email address is the ONLY PII shown, and only to the owner.
  var mktLoadedDays = null;
  // Owner-only admin portal (/portal). This is a SEPARATE page from the user
  // account dashboard — customers never see analytics. Reveals the data for the
  // admin UID and bounces everyone else to their own dashboard; the
  // admin-analytics edge function 403s non-owners regardless, so the gate is
  // defense in depth, not the only protection.
  function wirePortal() {
    var root = document.getElementById("portalAnalytics");
    if (!root) return; // not the portal page
    var checking = document.getElementById("portalChecking");
    var so = document.getElementById("portalSignOut");
    if (so) so.addEventListener("click", function (e) { e.preventDefault(); api.signOut(); });
    if (!hasAuth) { window.location.assign("/login"); return; }
    ensureClient().then(function (c) { return c.auth.getUser(); }).then(function (r) {
      var user = r && r.data && r.data.user;
      if (!user) { window.location.assign("/login"); return; }          // signed out
      if (user.id !== OWNER_UID) { window.location.assign("/account"); return; } // not admin
      if (checking) checking.style.display = "none";
      root.hidden = false;
      var seg = document.getElementById("mktRange");
      if (seg && !seg.dataset.wired) {
        seg.dataset.wired = "1";
        seg.addEventListener("click", function (e) {
          var b = e.target.closest(".segbtn"); if (!b) return;
          var btns = seg.querySelectorAll(".segbtn");
          for (var i = 0; i < btns.length; i++) btns[i].classList.toggle("on", btns[i] === b);
          loadMarketing(parseInt(b.getAttribute("data-days"), 10) || 7);
        });
      }
      loadMarketing(7);
      var ex = document.getElementById("exportContactsBtn");
      if (ex && !ex.dataset.wired) {
        ex.dataset.wired = "1";
        ex.addEventListener("click", function () { exportContacts(ex); });
      }
    }).catch(function () { window.location.assign("/login"); });
  }

  // Owner-only: pull opted-in contacts from the admin-contacts function and hand
  // the admin a CSV to import into their email tool (Kit). Everything is gated
  // server-side; this just formats and downloads.
  function exportContacts(btn) {
    var note = document.getElementById("exportNote");
    var label = btn.textContent;
    btn.disabled = true; btn.textContent = "Preparing…";
    if (note) note.textContent = "";
    accessToken().then(function (token) {
      if (!token) { window.location.assign("/login"); return; }
      return fetch(fnUrl("admin-contacts"), { method: "GET", headers: { "Authorization": "Bearer " + token } })
        .then(function (r) { return r.ok ? r.json() : null; })
        .then(function (res) {
          btn.disabled = false; btn.textContent = label;
          if (!res || !res.ok) { if (note) note.textContent = "Couldn't load contacts just now. Try again in a moment."; return; }
          var rows = res.contacts || [];
          if (!rows.length) { if (note) note.textContent = "No opted-in contacts yet. They'll appear here as people tick the box at signup."; return; }
          downloadCsv(contactsToCsv(rows), "modulus-opted-in-contacts.csv");
          if (note) note.textContent = "Exported " + rows.length + " contact" + (rows.length === 1 ? "" : "s") + ". Import this file into Kit to send your campaign.";
        });
    }).catch(function () { btn.disabled = false; btn.textContent = label; if (note) note.textContent = "Network hiccup. Try again."; });
  }
  function contactsToCsv(rows) {
    // Quote every field and double internal quotes (RFC 4180). Prefix any value
    // that starts with a formula character so a spreadsheet can't execute it
    // (CSV-injection guard), without mangling normal names/emails.
    var cell = function (v) {
      v = (v == null ? "" : String(v));
      // Strip ALL non-printable control chars first (null, \x01-\x1F, \x7F). A
      // spreadsheet can silently drop these on load, so a value like "\x00=cmd"
      // would otherwise dodge the formula check below and then execute. Removing
      // them also keeps stray control bytes from corrupting CSV rows.
      v = v.replace(/[\x00-\x1F\x7F]/g, "");
      // Prefix any value that starts with a formula char (even behind leading
      // spaces a spreadsheet might trim) so it can't execute as a formula.
      if (/^\s*[=+\-@]/.test(v)) v = "'" + v;
      return '"' + v.replace(/"/g, '""') + '"';
    };
    var lines = ["email,name,opted_in_at,plan"];
    for (var i = 0; i < rows.length; i++) {
      lines.push([cell(rows[i].email), cell(rows[i].name), cell(rows[i].opted_in_at), cell(rows[i].plan)].join(","));
    }
    return lines.join("\r\n");
  }
  function downloadCsv(text, filename) {
    var blob = new Blob([text], { type: "text/csv;charset=utf-8" });
    var url = URL.createObjectURL(blob);
    var a = document.createElement("a");
    a.href = url; a.download = filename;
    document.body.appendChild(a); a.click(); document.body.removeChild(a);
    setTimeout(function () { URL.revokeObjectURL(url); }, 1000);
  }

  function fmtNum(n) {
    n = Number(n) || 0;
    return n >= 1000 ? n.toLocaleString("en-US") : String(n);
  }
  function relTime(iso) {
    if (!iso) return "";
    var then = new Date(iso).getTime();
    if (isNaN(then)) return "";
    var s = Math.max(0, (Date.now() - then) / 1000);
    if (s < 3600) return Math.floor(s / 60) + "m ago";
    if (s < 86400) return Math.floor(s / 3600) + "h ago";
    if (s < 86400 * 30) return Math.floor(s / 86400) + "d ago";
    try { return new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric" }); }
    catch (e) { return ""; }
  }

  function loadMarketing(days) {
    if (mktLoadedDays === days) return; // avoid a redundant refetch on tab re-click
    accessToken().then(function (token) {
      if (!token) return;
      return fetch(fnUrl("admin-analytics") + "?days=" + days, {
        method: "GET", headers: { "Authorization": "Bearer " + token }
      }).then(function (r) { return r.ok ? r.json() : null; })
        .then(function (res) {
          if (!res || !res.ok || !res.dashboard) { renderMarketingError(); return; }
          mktLoadedDays = days;
          renderMarketing(res.dashboard);
        })
        .catch(function () { renderMarketingError(); });
    });
  }

  function renderMarketingError() {
    var box = document.getElementById("mRecent");
    if (box) box.innerHTML = '<p class="muted" style="margin:0">Analytics didn\'t load just now. Refresh in a moment.</p>';
  }

  function rankList(id, rows, labelKey, valKey, emptyMsg) {
    var el = document.getElementById(id);
    if (!el) return;
    if (!rows || !rows.length) { el.innerHTML = '<p class="muted" style="margin:0">' + esc(emptyMsg) + "</p>"; return; }
    var html = "";
    for (var i = 0; i < rows.length && i < 8; i++) {
      var label = rows[i][labelKey];
      html += '<div class="rankrow"><span class="rk-label">' + esc(label || "direct / none") +
        '</span><span class="rk-val">' + fmtNum(rows[i][valKey]) + "</span></div>";
    }
    el.innerHTML = html;
  }

  function renderMarketing(d) {
    var pv = d.pageviews || 0, uv = d.unique_visitors || 0;
    var signups = d.signups_window || 0, paid = d.paid_active || 0;
    setText("mPageviews", fmtNum(pv));
    setText("mVisitors", fmtNum(uv));
    setText("mSignups", fmtNum(signups));
    setText("mPaid", fmtNum(paid));

    // Visitor -> signup conversion for the window (guard divide-by-zero).
    var conv = uv > 0 ? (signups / uv * 100) : 0;
    var fill = document.getElementById("mFunnelFill");
    if (fill) fill.style.width = Math.max(2, Math.min(100, conv)).toFixed(1) + "%";
    setText("mConv", uv > 0
      ? conv.toFixed(1) + "% of visitors signed up in this window."
      : "No visitor data yet — pageviews start flowing once the analytics Worker is live.");

    setText("mOptedIn", fmtNum(d.opted_in || 0));
    rankList("mSources", d.top_sources, "source", "visits", "No traffic sources yet.");
    rankList("mPages", d.top_pages, "path", "visits", "No pageviews yet.");

    var recent = document.getElementById("mRecent");
    if (recent) {
      var rs = d.recent_signups || [];
      if (!rs.length) { recent.innerHTML = '<p class="muted" style="margin:0">No signups yet.</p>'; }
      else {
        var html = "";
        for (var i = 0; i < rs.length; i++) {
          var r = rs[i];
          var tag = r.plan && r.plan !== "free"
            ? '<span class="em-tag paid">' + esc(r.plan) + "</span>"
            : (r.marketing_opt_in ? '<span class="em-tag in">opted in</span>' : '<span class="em-tag out">no email</span>');
          html += '<div class="emailrow"><span class="em-addr">' + esc(r.email) +
            '</span><span class="em-when">' + esc(relTime(r.created_at)) + "</span>" + tag + "</div>";
        }
        recent.innerHTML = html;
      }
    }
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

    // Delete account: a two-step danger action. The first click arms it and
    // reveals a "type DELETE" confirm; the second click (with DELETE typed)
    // calls the delete-account function, which cancels any Stripe subscription
    // and erases the account, then signs out and goes home.
    var delBtn = document.getElementById("deleteAcctBtn");
    if (delBtn) {
      var delArmed = false;
      delBtn.addEventListener("click", function () {
        var box = document.getElementById("deleteConfirm");
        var typed = document.getElementById("deleteType");
        var note = document.getElementById("deleteNote");
        function err(m) { if (note) { note.textContent = m; note.className = "pnote err"; } }
        if (!delArmed) {
          delArmed = true;
          if (box) box.style.display = "block";
          var em0 = ((document.getElementById("acctEmail") || {}).textContent || "").trim();
          if (typed && em0.indexOf("@") !== -1) typed.placeholder = em0;
          delBtn.textContent = "Confirm permanent deletion";
          if (typed) typed.focus();
          return;
        }
        var acctEmail = ((document.getElementById("acctEmail") || {}).textContent || "").trim().toLowerCase();
        if (acctEmail.indexOf("@") === -1) acctEmail = "";
        var typedVal = (((typed && typed.value) || "").trim().toLowerCase());
        if (acctEmail ? (typedVal !== acctEmail) : (typedVal !== "delete")) { err(acctEmail ? "Type your account email exactly to confirm." : "Type DELETE to confirm."); return; }
        if (delBtn.getAttribute("data-busy")) return;
        delBtn.setAttribute("data-busy", "1"); delBtn.textContent = "Deleting…"; if (note) note.textContent = "";
        accessToken().then(function (token) {
          if (!token) { window.location.assign("/login"); return; }
          return fetch(fnUrl("delete-account"), {
            method: "POST",
            headers: { "content-type": "application/json", "Authorization": "Bearer " + token }
          }).then(function (r) { return r.json().then(function (d) { return { ok: r.ok, d: d }; }); })
            .then(function (res) {
              if (!res.ok) { delBtn.removeAttribute("data-busy"); delBtn.textContent = "Confirm permanent deletion"; err((res.d && res.d.error) || "Could not delete the account. Try again in a moment."); return; }
              return ensureClient().then(function (c) { return c.auth.signOut(); })
                .then(function () { try { localStorage.clear(); sessionStorage.clear(); } catch (e) {} window.location.assign("/?deleted=1"); });
            });
        }).catch(function () { delBtn.removeAttribute("data-busy"); delBtn.textContent = "Confirm permanent deletion"; err("Could not delete the account. Try again in a moment."); });
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
      var memberDemo = /[?&]member=1/.test(location.search);
      dashIsMember = memberDemo;
      dashOwnerEmail = memberDemo ? "owner@ministry.org" : null;
      renderPlan({ plan: "pro", display_name: "Pro", status: "active", balance: lowDemo ? 280 : 2560, limit: 3000, current_period_end: "2026-07-01" });
      applyMemberBilling();
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
      }, lowDemo ? 140 : 1280, memberDemo ? { role: "member", owner_email: "owner@ministry.org" } : null);
      if (memberDemo) {
        renderTeam({ role: "member", owner_email: "owner@ministry.org" });
      } else if (/[?&]solo=1/.test(location.search)) {
        renderTeam({ role: "owner", seats: 1, members: [], invites: [] });
      } else if (/[?&]over=1/.test(location.search)) {
        // Downgraded below the roster: 2 members on a now-1-seat plan.
        renderTeam({ role: "owner", seats: 1, members: [
          { id: "m1", email: "editor@ministry.org", added_at: "2026-06-01T00:00:00Z" },
          { id: "m2", email: "writer@ministry.org", added_at: "2026-06-03T00:00:00Z" }
        ], invites: [] });
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
          // They just bought their own plan, so any stale invite would only
          // ever fail (has_own_plan). Discard it instead of firing a confusing
          // alert on this load.
          try { sessionStorage.removeItem("modulus-pending-join"); } catch (e) {}
          pollEntitlement(0);
          // Clean the URL so a refresh doesn't re-trigger.
          try { history.replaceState({}, "", "/account"); } catch (e) {}
        } else {
          // Finish a join that started on /join while signed out: accept the
          // stashed invite first so the very first render shows the team. Keep
          // the stash on a network error so the next load can retry.
          var pendingJoin = null;
          try { pendingJoin = sessionStorage.getItem("modulus-pending-join"); } catch (e) {}
          var preStep = pendingJoin
            ? teamReq("accept", { token: pendingJoin }).then(function (res) {
                var keep = !res.ok && res.d && res.d.error === "network";
                if (!keep) { try { sessionStorage.removeItem("modulus-pending-join"); } catch (e) {} }
                if (res.ok) { try { window.location.hash = "#team"; } catch (e) {} }
                else if (!keep && res.d && res.d.message) { window.alert(res.d.message); }
              })
            : Promise.resolve();
          // Normal load: keep the branded loader up until the first
          // entitlement render so the dashboard never paints placeholder
          // values. The promise resolves (never rejects) even on failure.
          preStep.then(function () { return loadEntitlement(); }).then(function (d) {
            show(true);
            // Resume a checkout the visitor started before signing in. Only
            // when entitlement actually loaded (d may be null on a transient
            // failure; treating null as "not paid" could double-bill), they
            // are not already on a paid plan, and not on a team.
            var pending = null;
            try { pending = sessionStorage.getItem("modulus-pending-plan"); } catch (e) {}
            if (!pending) return;
            // 2026-06-26 audit: validate the stashed plan against the known keys
            // before using it in a selector — a crafted value could otherwise break
            // document.querySelector and throw (client-side DoS for the session).
            if (["starter", "pro", "studio"].indexOf(pending) === -1) {
              try { sessionStorage.removeItem("modulus-pending-plan"); } catch (e) {}
              return;
            }
            if (!d) return; // entitlement failed to load; leave intent for next time
            try { sessionStorage.removeItem("modulus-pending-plan"); } catch (e) {}
            var paid = d.plan && d.plan.key && d.plan.key !== "free" && d.subscription;
            if (paid || dashIsMember) return;
            var btn = document.querySelector('[data-checkout="' + pending + '"]');
            if (btn && !btn.getAttribute("data-current")) btn.click();
          });
        }
      });
    });
  }

  function boot() { wireLogin(); wireCheckout(); wireAccount(); wireJoin(); wirePortal(); }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", boot);
  else boot();
})();

/* Modulus Technologies — shared light chrome (redo).
   Injects a consistent nav + footer on every page, gives each page's hero a
   constellation background, and runs scroll reveal.
   Above-the-fold uses CSS .fade-up (no JS); below-fold uses .reveal here.
   URLs are clean (extensionless); Netlify serves /services from services.html. */
(function () {
  // Root-absolute paths so injected chrome works on subfolder pages too
  // (e.g. /insights/<article>) — every asset/script lives at the site root.
  var MARK = '<img class="brand-img" src="/assets/modulus-mark.png" alt="Modulus" width="28" height="28" />';

  // ---- Single source of truth for Modulus Studio plan pricing -------------
  // Edit prices, credits, and limits HERE. The /studio pricing cards and the
  // logged-in account page (backend.js) both read from this object, so the
  // two can never drift apart. The numbers written into studio.html's cards
  // are a no-JS / SEO fallback that syncPlanCards() overwrites from this
  // object on load. Exposed on window so the injected backend.js can read it.
  window.MODULUS_PLANS = {
    starter: { name: "Starter", price: "$19", period: "/ month", credits: "600",   limit: 600,  seats: 1 },
    pro:     { name: "Pro",     price: "$39", period: "/ month", credits: "1,500", limit: 1500, seats: 3 },
    studio:  { name: "Studio",  price: "$99", period: "/ month", credits: "4,000", limit: 4000, seats: 5 }
  };
  var LINKS = [
    ["Services", "/services"],
    ["Studio", "/studio"],
    ["Products", "/products"],
    ["Insights", "/insights"],
    ["About", "/about"]
  ];
  // Current path, normalized to clean form so aria-current matches LINKS.
  var here = location.pathname.replace(/\.html$/, "");
  if (here === "" || here === "/index") here = "/";

  function nav() {
    var links = LINKS.map(function (l) {
      return '<a href="' + l[1] + '"' + (l[1] === here ? ' aria-current="page"' : '') + '>' + l[0] + '</a>';
    }).join("");
    var drawer = LINKS.map(function (l) { return '<a href="' + l[1] + '">' + l[0] + '</a>'; }).join("") +
      '<a class="login" data-auth-login href="/login">Login</a><a href="/contact">Book a call</a>';

    // Studio pages get their own header (own tabs + a clear link back to the main site)
    if (document.body.getAttribute("data-section") === "studio") {
      var sdrawer = '<a href="/studio#features">Features</a><a href="/studio#tools">Tools</a><a href="/studio#pricing">Pricing</a><a href="/studio#download">Get access</a><a class="login" data-auth-login href="/login">Sign in</a><a href="/">⌂ Home · Modulus Technologies</a>';
      return '<header class="nav"><div class="wrap nav-inner">' +
          '<a class="brand" href="/studio" aria-label="Modulus Studio">' + MARK + '<b>Modulus</b> <span class="sub">Studio</span></a>' +
          '<nav class="nav-links" aria-label="Modulus Studio">' +
            '<a href="/studio#features">Features</a><a href="/studio#tools">Tools</a><a href="/studio#pricing">Pricing</a>' +
          '</nav>' +
          '<div class="nav-right">' +
            '<a class="s-home" href="/" aria-label="Modulus Technologies home" title="Home | Modulus Technologies"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M3 11l9-8 9 8M5 10v10h5v-6h4v6h5V10"/></svg></a>' +
            '<a class="login" data-auth-login href="/login">Sign in</a>' +
            '<a class="btn btn-gold" href="/studio#download" style="padding:10px 20px;font-size:14px;">Get access</a>' +
            '<button class="nav-toggle" aria-label="Menu" aria-expanded="false"><svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><path d="M4 7h16M4 12h16M4 17h16"/></svg></button>' +
          '</div>' +
        '</div><div class="wrap"><div class="nav-drawer" id="navDrawer">' + sdrawer + '</div></div></header>';
    }

    // Signed-in app pages (login + dashboard) get a minimal dark app header.
    if (document.body.getAttribute("data-section") === "app") {
      return '<header class="nav app-nav"><div class="wrap nav-inner">' +
          '<a class="brand" href="/studio" aria-label="Modulus Studio">' + MARK + '<b>Modulus</b> <span class="sub">Studio</span></a>' +
          '<div class="nav-right">' +
            '<a class="login" href="/" aria-label="Back to Modulus Technologies home" style="display:inline-flex;align-items:center;gap:7px"><svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 10.6 12 3l9 7.6"/><path d="M5.5 9.4V20a1 1 0 0 0 1 1h11a1 1 0 0 0 1-1V9.4"/><path d="M9.8 21v-6h4.4v6"/></svg> Modulus Technologies</a>' +
          '</div>' +
        '</div></header>';
    }

    return '<header class="nav"><div class="wrap nav-inner">' +
        '<a class="brand" href="/" aria-label="Modulus Technologies home">' + MARK + '<b>Modulus</b> <span class="sub">Technologies</span></a>' +
        '<nav class="nav-links" aria-label="Primary">' + links + '</nav>' +
        '<div class="nav-right">' +
          '<a class="login" data-auth-login href="/login">Login</a>' +
          '<a class="btn btn-gold" href="/contact" style="padding:10px 20px;font-size:14px;">Book a call</a>' +
          '<button class="nav-toggle" aria-label="Menu" aria-expanded="false"><svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><path d="M4 7h16M4 12h16M4 17h16"/></svg></button>' +
        '</div>' +
      '</div><div class="wrap"><div class="nav-drawer" id="navDrawer">' + drawer + '</div></div></header>';
  }

  function footer() {
    // Studio gets its own dark, self-contained footer: in-world links + a clear path back to the company.
    if (document.body.getAttribute("data-section") === "studio") {
      return '<footer class="footer"><div class="wrap">' +
          '<div class="footer-top">' +
            '<div><a class="brand" href="/studio" aria-label="Modulus Studio">' + MARK + '<b>Modulus</b> <span class="sub">Studio</span></a>' +
              '<p class="footer-tag">Turn one talk into a month of content.</p></div>' +
            '<div class="footer-cols">' +
              '<div class="footer-col"><h5>Studio</h5><a href="/studio#features">Features</a><a href="/studio#tools">Tools</a><a href="/studio#pricing">Pricing</a><a href="/studio#download">Get access</a></div>' +
              '<div class="footer-col"><h5>Company</h5><a href="/">Modulus Technologies</a><a href="/about">About</a><a href="/contact">Contact</a></div>' +
              '<div class="footer-col"><h5>Account</h5><a class="login" data-auth-login href="/login">Sign in</a></div>' +
            '</div>' +
          '</div>' +
          '<div class="footer-bottom"><span>&copy; 2026 Modulus Technologies. All rights reserved.</span><span class="footer-legal"><a href="/privacy">Privacy</a> &middot; <a href="/terms">Terms</a> &middot; <a href="/subprocessors">Sub-processors</a> &middot; <a href="/trust">Trust</a></span></div>' +
        '</div></footer>';
    }
    // App pages get a slim dark footer.
    if (document.body.getAttribute("data-section") === "app") {
      return '<footer class="footer app-footer"><div class="wrap">' +
          '<div class="footer-bottom"><span>&copy; 2026 Modulus Technologies. All rights reserved.</span>' +
          '<span class="footer-legal"><a href="/studio">Modulus Studio</a> &middot; <a href="/privacy">Privacy</a> &middot; <a href="/terms">Terms</a> &middot; <a href="/subprocessors">Sub-processors</a> &middot; <a href="/trust">Trust</a></span></div>' +
        '</div></footer>';
    }

    return '<footer class="footer"><div class="wrap">' +
        '<div class="footer-top">' +
          '<div><a class="brand" href="/">' + MARK + '<b>Modulus</b></a>' +
            '<p class="footer-tag">AI leverage, built for the rest of us.</p>' +
            '<div class="footer-social">' +
              '<a href="https://www.instagram.com/modulustech.ai/" target="_blank" rel="noopener" aria-label="Modulus on Instagram"><svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true"><rect x="3" y="3" width="18" height="18" rx="5" fill="none" stroke="currentColor" stroke-width="1.8"/><circle cx="12" cy="12" r="4" fill="none" stroke="currentColor" stroke-width="1.8"/><circle cx="17.2" cy="6.8" r="1.2" fill="currentColor"/></svg></a>' +
              '<a href="https://www.tiktok.com/@modulustech.ai" target="_blank" rel="noopener" aria-label="Modulus on TikTok"><svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true"><path fill="currentColor" d="M16.6 3c.3 2 1.5 3.6 3.6 3.9v2.4c-1.3 0-2.6-.4-3.7-1.1v5.8a5.5 5.5 0 1 1-5.5-5.5c.3 0 .6 0 .9.1v2.5a3 3 0 1 0 2.1 2.9V3h2.6z"/></svg></a>' +
              '<a href="https://www.linkedin.com/in/james-denham-2b2332329" target="_blank" rel="noopener" aria-label="Modulus on LinkedIn"><svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true"><path fill="currentColor" d="M4.98 3.5a2.5 2.5 0 1 0 0 5 2.5 2.5 0 0 0 0-5zM3.2 9h3.6v12H3.2zM9 9h3.5v1.6h.05c.5-.93 1.7-1.9 3.5-1.9 3.7 0 4.4 2 4.4 5.1V21h-3.7v-5.4c0-1.3 0-3-1.9-3s-2.1 1.4-2.1 2.9V21H9z"/></svg></a>' +
            '</div></div>' +
          '<div class="footer-cols">' +
            '<div class="footer-col"><h5>Products</h5><a href="/studio">Modulus Studio</a><a href="/for-churches">For churches</a><a href="/for-agencies">For agencies</a><a href="/for-publishers">For publishers</a><a href="/studio#pricing">Pricing</a></div>' +
            '<div class="footer-col"><h5>Company</h5><a href="/about">About</a><a href="/insights">Insights</a><a href="/changelog">Changelog</a><a href="/contact">Contact</a></div>' +
            '<div class="footer-col"><h5>Use cases</h5><a href="/services#growth">Growth</a><a href="/services#operations">Operations</a><a href="/services#content">Content</a><a href="/services#support">Support</a></div>' +
            '<div class="footer-col"><h5>Get started</h5><a href="/contact">Book a call</a><a href="/login">Login</a></div>' +
          '</div>' +
        '</div>' +
        '<div class="footer-bottom"><span>&copy; 2026 Modulus Technologies. All rights reserved.</span><span class="footer-legal"><a href="/privacy">Privacy</a> &middot; <a href="/terms">Terms</a> &middot; <a href="/subprocessors">Sub-processors</a> &middot; <a href="/trust">Trust</a> &middot; Agentic AI for SMBs.</span></div>' +
      '</div></footer>';
  }

  function el(html) { var d = document.createElement("div"); d.innerHTML = html.trim(); return d.firstChild; }

  // Fill any [data-plan] pricing card from MODULUS_PLANS so the visible
  // numbers always match the single source of truth. No-op on pages with no
  // such cards (every page but /studio).
  function syncPlanCards() {
    var plans = window.MODULUS_PLANS || {};
    document.querySelectorAll("[data-plan]").forEach(function (card) {
      var p = plans[card.getAttribute("data-plan")];
      if (!p) return;
      var amt = card.querySelector(".amt"); if (amt) amt.textContent = p.price;
      var per = card.querySelector(".per"); if (per) per.textContent = p.period;
      var cr = card.querySelector(".s-credits"); if (cr) cr.textContent = p.credits + " credits / month";
      // Dashboard tier cards carry the credit count inline (.t-cr) so the
      // perk copy around it survives the sync.
      var tcr = card.querySelector(".t-cr"); if (tcr) tcr.textContent = p.credits;
    });
  }

  // Give the page's hero a constellation field if it doesn't already have one,
  // then load the animation once. The homepage hand-authors a larger field
  // spanning several sections; every other page gets a hero-scoped field here.
  function constellation() {
    var hero = document.querySelector(".hero");
    if (hero && !hero.closest(".bg-field")) {
      var fld = document.createElement("div");
      fld.className = "bg-field";
      hero.parentNode.insertBefore(fld, hero);
      var cv = document.createElement("canvas");
      cv.className = "field-canvas";
      cv.setAttribute("aria-hidden", "true");
      fld.appendChild(cv);
      fld.appendChild(hero);
    }
    if (document.querySelector(".field-canvas") && !document.querySelector('script[src*="hero-anim"]')) {
      var s = document.createElement("script");
      s.src = "/hero-anim.js";
      document.body.appendChild(s);
    }
  }

  function boot() {
    if (!document.querySelector('link[rel="icon"]')) {
      document.head.insertAdjacentHTML("beforeend", '<link rel="icon" type="image/png" href="/assets/favicon-32.png">');
    }
    document.head.insertAdjacentHTML("beforeend", '<link rel="apple-touch-icon" href="/assets/modulus-mark.png">');
    if (!document.querySelector('meta[name="theme-color"]')) {
      document.head.insertAdjacentHTML("beforeend", '<meta name="theme-color" content="#0C1B2E">');
    }
    document.body.insertAdjacentElement("afterbegin", el(nav()));
    document.body.insertAdjacentHTML("afterbegin", '<a class="skip" href="#main">Skip to content</a>');
    document.body.insertAdjacentElement("beforeend", el(footer()));
    constellation();
    syncPlanCards();

    // backend foundation (auth + assistant + checkout); inert until keys set in backend.js
    if (!document.querySelector('script[src*="backend.js"]')) {
      var bjs = document.createElement("script"); bjs.src = "/backend.js"; document.body.appendChild(bjs);
    }

    // "Ask Modulus" assistant widget (self-contained; no external services or keys)
    if (!document.querySelector('script[src*="assistant.js"]')) {
      var ajs = document.createElement("script"); ajs.src = "/assistant.js"; ajs.defer = true; document.body.appendChild(ajs);
    }

    // First-party analytics beacon. Cookieless: the Worker hashes the visitor at
    // the edge, so nothing identifying is stored and no consent banner is needed.
    // Honors Global Privacy Control / Do-Not-Track here too (defense in depth; the
    // Worker re-checks). Fires ONE beacon per pageview on hide, so we never block
    // paint and a prerendered tab the user never views is never counted.
    analyticsBeacon();

    var toggle = document.querySelector(".nav-toggle");
    var drawer = document.getElementById("navDrawer");
    if (toggle && drawer) toggle.addEventListener("click", function () {
      var open = drawer.classList.toggle("open");
      toggle.setAttribute("aria-expanded", open ? "true" : "false");
    });

    // Reveal replays in BOTH scroll directions (James 2026-06-11): keep observing
    // and toggle the class, so sections animate again every time they re-enter.
    var obs = new IntersectionObserver(function (entries) {
      entries.forEach(function (e) { e.target.classList.toggle("in", e.isIntersecting); });
    }, { threshold: 0.12 });
    document.querySelectorAll(".reveal").forEach(function (n) { obs.observe(n); });

    // Nav lifts off the canvas once the page scrolls (shadow via .scrolled).
    var navEl = document.querySelector(".nav");
    if (navEl) {
      var navTick = false;
      var setNav = function () { navEl.classList.toggle("scrolled", window.scrollY > 8); navTick = false; };
      window.addEventListener("scroll", function () {
        if (!navTick) { navTick = true; requestAnimationFrame(setNav); }
      }, { passive: true });
      setNav();
    }

    // Deep-link fix: the header/footer are injected after the page loads,
    // which cancels the browser's native jump-to-anchor (so /products#pricing
    // would land at the top). Re-scroll to the hash once the chrome is in place.
    if (location.hash.length > 1) {
      try {
        var anchor = document.querySelector(location.hash);
        if (anchor) {
          var jump = function () { anchor.scrollIntoView(); };
          setTimeout(jump, 60);
          window.addEventListener("load", function () { setTimeout(jump, 120); });
        }
      } catch (e) { /* invalid selector in hash — ignore */ }
    }
  }

  // ---- First-party analytics beacon --------------------------------------
  // Sends a single anonymized pageview to the Cloudflare ingest Worker when the
  // page is hidden (tab switch / navigation away). No cookies, no localStorage,
  // no identifiers from the browser; the Worker derives a rotating daily hash at
  // the edge (deployed on its workers.dev URL; see ANALYTICS_ENDPOINT below).
  var ANALYTICS_ENDPOINT = "https://modulus-analytics-ingest.modulustech.workers.dev";
  function analyticsBeacon() {
    try {
      // Honor privacy signals — do not even build a payload.
      if (navigator.globalPrivacyControl === true) return;
      if (navigator.doNotTrack === "1" || window.doNotTrack === "1") return;
      if (!navigator.sendBeacon) return;

      var sent = false;
      var everVisible = false;
      var send = function () {
        if (sent) return;
        // Don't count a tab that was prerendered and never actually viewed.
        if (document.visibilityState === "hidden" && !everVisible) return;
        sent = true;
        var p = new URLSearchParams(location.search);
        var payload = {
          domain: location.hostname,
          path: location.pathname.slice(0, 2048),
          referrer: document.referrer || "",
          screen: (window.screen ? window.screen.width + "x" + window.screen.height : ""),
          utm_source: p.get("utm_source") || "",
          utm_medium: p.get("utm_medium") || "",
          utm_campaign: p.get("utm_campaign") || "",
          utm_term: p.get("utm_term") || "",
          utm_content: p.get("utm_content") || ""
        };
        // Drop empty keys so the Worker's strict allowlist stays happy.
        Object.keys(payload).forEach(function (k) { if (!payload[k]) delete payload[k]; });
        try {
          var blob = new Blob([JSON.stringify(payload)], { type: "application/json" });
          navigator.sendBeacon(ANALYTICS_ENDPOINT, blob);
        } catch (e) { /* ignore — analytics must never break the page */ }
      };

      // Track whether the page was ever actually visible (prerender guard).
      if (document.visibilityState === "visible") everVisible = true;
      document.addEventListener("visibilitychange", function () {
        if (document.visibilityState === "visible") { everVisible = true; }
        else { send(); }
      });
      // pagehide is the reliable "leaving" signal on mobile Safari / bfcache.
      window.addEventListener("pagehide", send, { capture: true });
    } catch (e) { /* analytics is best-effort; never throw into boot */ }
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", boot);
  else boot();
})();

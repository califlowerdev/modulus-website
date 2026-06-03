/* Modulus Technologies — shared light chrome (redo).
   Injects a consistent nav + footer on every page, gives each page's hero a
   constellation background, and runs scroll reveal.
   Above-the-fold uses CSS .fade-up (no JS); below-fold uses .reveal here.
   URLs are clean (extensionless); Netlify serves /services from services.html. */
(function () {
  var MARK = '<img class="brand-img" src="assets/modulus-mark.png" alt="Modulus" width="28" height="28" />';
  var LINKS = [
    ["Services", "/services"],
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
      var sdrawer = '<a href="/studio#features">Features</a><a href="/studio#how">How it works</a><a href="/products#pricing">Pricing</a><a href="/studio#download">Download</a><a href="/">← Modulus Technologies</a>';
      return '<header class="nav"><div class="wrap nav-inner">' +
          '<a class="brand" href="/studio" aria-label="Modulus Studio">' + MARK + '<b>Modulus</b> <span class="sub">Studio</span></a>' +
          '<nav class="nav-links" aria-label="Modulus Studio">' +
            '<a href="/studio#features">Features</a><a href="/studio#how">How it works</a><a href="/products#pricing">Pricing</a>' +
          '</nav>' +
          '<div class="nav-right">' +
            '<a class="login" href="/">← Modulus Technologies</a>' +
            '<a class="btn btn-gold" href="/studio#download" style="padding:10px 20px;font-size:14px;">Download</a>' +
            '<button class="nav-toggle" aria-label="Menu" aria-expanded="false"><svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><path d="M4 7h16M4 12h16M4 17h16"/></svg></button>' +
          '</div>' +
        '</div><div class="wrap"><div class="nav-drawer" id="navDrawer">' + sdrawer + '</div></div></header>';
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
    return '<footer class="footer"><div class="wrap">' +
        '<div class="footer-top">' +
          '<div><a class="brand" href="/">' + MARK + '<b>Modulus</b></a>' +
            '<p class="footer-tag">The infrastructure for unbounded ambition.</p></div>' +
          '<div class="footer-cols">' +
            '<div class="footer-col"><h5>Products</h5><a href="/studio">Modulus Studio</a><a href="/products#pricing">Pricing</a><a href="/products">Roadmap</a></div>' +
            '<div class="footer-col"><h5>Company</h5><a href="/about">About</a><a href="/insights">Insights</a><a href="/contact">Contact</a></div>' +
            '<div class="footer-col"><h5>Use cases</h5><a href="/services#growth">Growth</a><a href="/services#operations">Operations</a><a href="/services#content">Content</a><a href="/services#support">Support</a></div>' +
            '<div class="footer-col"><h5>Get started</h5><a href="/contact">Book a call</a><a href="/login">Login</a></div>' +
          '</div>' +
        '</div>' +
        '<div class="footer-bottom"><span>&copy; 2026 Modulus Technologies. All rights reserved.</span><span class="footer-legal"><a href="/privacy">Privacy</a> &middot; <a href="/terms">Terms</a> &middot; Agentic AI for SMBs.</span></div>' +
      '</div></footer>';
  }

  function el(html) { var d = document.createElement("div"); d.innerHTML = html.trim(); return d.firstChild; }

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
      s.src = "hero-anim.js";
      document.body.appendChild(s);
    }
  }

  function boot() {
    document.head.insertAdjacentHTML("beforeend",
      '<link rel="icon" type="image/png" href="assets/favicon-32.png">' +
      '<link rel="apple-touch-icon" href="assets/modulus-mark.png">');
    if (!document.querySelector('meta[name="theme-color"]')) {
      document.head.insertAdjacentHTML("beforeend", '<meta name="theme-color" content="#0C1B2E">');
    }
    document.body.insertAdjacentElement("afterbegin", el(nav()));
    document.body.insertAdjacentHTML("afterbegin", '<a class="skip" href="#main">Skip to content</a>');
    document.body.insertAdjacentElement("beforeend", el(footer()));
    constellation();

    // backend foundation (auth + assistant + checkout); inert until keys set in backend.js
    if (!document.querySelector('script[src*="backend.js"]')) {
      var bjs = document.createElement("script"); bjs.src = "backend.js"; document.body.appendChild(bjs);
    }

    // "Ask Modulus" assistant widget (self-contained; no external services or keys)
    if (!document.querySelector('script[src*="assistant.js"]')) {
      var ajs = document.createElement("script"); ajs.src = "assistant.js"; ajs.defer = true; document.body.appendChild(ajs);
    }

    var toggle = document.querySelector(".nav-toggle");
    var drawer = document.getElementById("navDrawer");
    if (toggle && drawer) toggle.addEventListener("click", function () {
      var open = drawer.classList.toggle("open");
      toggle.setAttribute("aria-expanded", open ? "true" : "false");
    });

    var obs = new IntersectionObserver(function (entries) {
      entries.forEach(function (e) { if (e.isIntersecting) { e.target.classList.add("in"); obs.unobserve(e.target); } });
    }, { threshold: 0.12 });
    document.querySelectorAll(".reveal").forEach(function (n) { obs.observe(n); });

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

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", boot);
  else boot();
})();

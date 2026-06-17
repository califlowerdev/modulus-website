/* Modulus — site constellation. One field of drifting nodes that link to their
   neighbors and reach toward the cursor (navy network, gold near the mouse).
   On the homepage it spans the hero through the founder section; on other pages
   site.js wraps the hero in its own field. Nodes ease back gently behind real
   text (headlines, headings, the founder quote) so they never fight with
   reading, but stay lively everywhere else. Ignores pointer events, respects
   reduced motion, pauses when off-screen or the tab is hidden. */
(function () {
  var canvas = document.querySelector(".field-canvas");
  if (!canvas || canvas.__c) return; // one init per canvas
  canvas.__c = 1;
  if (window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;

  var ctx = canvas.getContext("2d");
  var DPR = Math.min(window.devicePixelRatio || 1, 2);
  var field = canvas.parentElement;
  var w = 0, h = 0, particles = [], boxes = [], grid = [], raf = null, running = true;
  var mouse = { x: -9999, y: -9999 };
  var NAVY = "12,27,46", GOLD = "200,167,91";
  var LINK = 158, NEAR = 175;

  // Readability easing: a node's visibility eases down a little as it drifts over
  // real text and recovers as it leaves. Gentle (high floor) — calmer dots behind
  // text, lively everywhere else. Tune via MASK_FLOOR / MASK_MARGIN.
  var MASK_FLOOR = 0.12, MASK_MARGIN = 80;
  function vis(x, y) {
    var best = 1;
    for (var b = 0; b < boxes.length; b++) {
      var r = boxes[b];
      var dx = Math.max(r.x0 - x, x - r.x1, 0);
      var dy = Math.max(r.y0 - y, y - r.y1, 0);
      var d = Math.sqrt(dx * dx + dy * dy);
      var t = d >= MASK_MARGIN ? 1 : d / MASK_MARGIN;
      t = t * t * (3 - 2 * t); // smoothstep — gentle ease in/out
      var v = MASK_FLOOR + (1 - MASK_FLOOR) * t;
      if (v < best) best = v;
    }
    return best;
  }

  // v2 (2026-06-12): split the cheap canvas + text re-measure from the
  // expensive particle rebuild. A mobile URL bar showing or hiding fires
  // resize with only a HEIGHT change, and re-rolling every particle there made
  // the whole field flicker. Particles are now only rebuilt when the WIDTH
  // actually changes.
  var lastW = -1;
  function measureBoxes(r) {
    // calm only behind real text: the hero block, section headings, founder quote
    boxes = [];
    var texts = field.querySelectorAll(".hero .eyebrow, .hero h1, .hero .sub, .hero .trustline, h2, .founder .quote");
    for (var i = 0; i < texts.length; i++) {
      var tr = texts[i].getBoundingClientRect();
      if (tr.width === 0 && tr.height === 0) continue;
      boxes.push({
        x0: tr.left - r.left, y0: tr.top - r.top,
        x1: tr.left - r.left + tr.width, y1: tr.top - r.top + tr.height
      });
    }
  }
  function buildParticles() {
    // Sparser nodes on small screens: a phone shows the field full-frame and
    // runs on a battery, so the density is dialed down there (bigger divisor =
    // fewer dots, lower cap).
    var small = w < 700;
    var divisor = small ? 7000 : 3600;   // a lot denser field
    // The homepage field is very tall (it spans every section), so it is bound
    // by this cap, not the divisor. The cap is therefore the real dial for
    // "more dots on home". Neighbor links use a spatial grid (see step), so a
    // high node count stays cheap. Short sub-page heroes are divisor-bound and
    // barely move when the cap changes.
    var capMax = small ? 420 : 1100;
    var count = Math.max(70, Math.min(capMax, Math.round((w * h) / divisor)));
    particles = [];
    for (var k = 0; k < count; k++) {
      particles.push({
        x: Math.random() * w, y: Math.random() * h,
        // slow, calm drift (about half the old speed) so nothing darts around
        vx: (Math.random() - 0.5) * 0.11, vy: (Math.random() - 0.5) * 0.11,
        r: Math.random() * 2.6 + 2.1,
        gold: Math.random() < 0.32,
        _v: 1
      });
    }
  }
  function resize() {
    var r = field.getBoundingClientRect();
    w = r.width; h = r.height;
    canvas.width = Math.round(w * DPR); canvas.height = Math.round(h * DPR);
    canvas.style.width = w + "px"; canvas.style.height = h + "px";
    ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
    measureBoxes(r);
    if (Math.abs(w - lastW) > 1) { lastW = w; buildParticles(); }
  }

  function step() {
    ctx.clearRect(0, 0, w, h);

    // pass 1 — move each node with a calm drift, then compute its visibility
    for (var i = 0; i < particles.length; i++) {
      var p = particles[i];
      p.x += p.vx; p.y += p.vy;
      if (p.x < 0 || p.x > w) p.vx *= -1;
      if (p.y < 0 || p.y > h) p.vy *= -1;
      p._v = vis(p.x, p.y);
    }

    // Bucket the nodes into a spatial grid (cell = LINK) so each node only tests
    // its own cell and the eight around it for links. Keeps the field cheap even
    // at a high node count, which is what lets the homepage run dense.
    var cols = Math.max(1, Math.ceil(w / LINK));
    var rows = Math.max(1, Math.ceil(h / LINK));
    var cells = cols * rows;
    for (var c = 0; c < cells; c++) { if (grid[c]) grid[c].length = 0; else grid[c] = []; }
    for (var i = 0; i < particles.length; i++) {
      var p = particles[i];
      var cx = p.x <= 0 ? 0 : (p.x >= w ? cols - 1 : (p.x / LINK) | 0);
      var cy = p.y <= 0 ? 0 : (p.y >= h ? rows - 1 : (p.y / LINK) | 0);
      p._cx = cx; p._cy = cy;
      grid[cy * cols + cx].push(i);
    }

    // pass 2 — draw neighbor links (via the grid), the cursor link, then nodes
    for (var i = 0; i < particles.length; i++) {
      var p = particles[i];
      var dxm = p.x - mouse.x, dym = p.y - mouse.y, dm = Math.sqrt(dxm * dxm + dym * dym);
      var near = dm < NEAR;

      for (var oy = -1; oy <= 1; oy++) {
        var ny = p._cy + oy; if (ny < 0 || ny >= rows) continue;
        for (var ox = -1; ox <= 1; ox++) {
          var nx = p._cx + ox; if (nx < 0 || nx >= cols) continue;
          var bucket = grid[ny * cols + nx];
          for (var bi = 0; bi < bucket.length; bi++) {
            var j = bucket[bi];
            if (j <= i) continue; // count each pair once
            var q = particles[j], dx = p.x - q.x, dy = p.y - q.y, d = Math.sqrt(dx * dx + dy * dy);
            if (d < LINK) {
              var lv = p._v < q._v ? p._v : q._v; // fade the link by its calmer endpoint
              ctx.beginPath(); ctx.moveTo(p.x, p.y); ctx.lineTo(q.x, q.y);
              ctx.strokeStyle = "rgba(" + NAVY + "," + (0.2 * (1 - d / LINK) * lv).toFixed(3) + ")";
              ctx.lineWidth = 1; ctx.stroke();
            }
          }
        }
      }

      if (near) {
        ctx.beginPath(); ctx.moveTo(p.x, p.y); ctx.lineTo(mouse.x, mouse.y);
        ctx.strokeStyle = "rgba(" + GOLD + "," + (0.42 * (1 - dm / NEAR) * p._v).toFixed(3) + ")";
        ctx.lineWidth = 1; ctx.stroke();
      }

      var col = near ? GOLD : (p.gold ? GOLD : NAVY);
      var a = near ? (0.62 * (1 - dm / NEAR) + 0.3) : (p.gold ? 0.5 : 0.44);
      ctx.beginPath();
      ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2);
      ctx.fillStyle = "rgba(" + col + "," + (a * p._v).toFixed(3) + ")";
      ctx.fill();
    }

    if (running) raf = requestAnimationFrame(step);
  }

  function play() { if (running && !raf) raf = requestAnimationFrame(step); }
  function pause() { running = false; if (raf) { cancelAnimationFrame(raf); raf = null; } }

  window.addEventListener("mousemove", function (e) {
    var r = field.getBoundingClientRect();
    mouse.x = e.clientX - r.left; mouse.y = e.clientY - r.top;
  }, { passive: true });
  window.addEventListener("mouseout", function () { mouse.x = -9999; mouse.y = -9999; });
  window.addEventListener("resize", resize);
  window.addEventListener("load", resize); // re-measure once fonts/images settle
  document.addEventListener("visibilitychange", function () {
    if (document.hidden) pause(); else { running = true; play(); }
  });
  if ("IntersectionObserver" in window) {
    new IntersectionObserver(function (es) {
      if (es[0].isIntersecting && !document.hidden) { running = true; play(); } else { pause(); }
    }, { threshold: 0 }).observe(field);
  }

  resize();
  raf = requestAnimationFrame(step);
})();

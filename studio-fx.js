/* Modulus Studio — light page, calm motion.
   The background ambient is CSS-only (drifting orbs + faint grid).
   This script adds two interactions:
     1) a gentle 3D tilt on .tilt cards / the app window (the depth James likes);
     2) the Quality score rings count up + fill once they scroll into view.
   Respects prefers-reduced-motion. Same-origin + programmatic styles only — CSP-safe. */
(function () {
  var rm = window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  // 1) Gentle tilt on .tilt cards (skip if reduced motion)
  if (!rm) {
    var cards = document.querySelectorAll(".tilt");
    for (var i = 0; i < cards.length; i++) {
      (function (card) {
        card.addEventListener("pointermove", function (e) {
          var r = card.getBoundingClientRect();
          var px = (e.clientX - r.left) / r.width;
          var py = (e.clientY - r.top) / r.height;
          card.style.transform = "perspective(1000px) rotateY(" + ((px - 0.5) * 5).toFixed(2) +
            "deg) rotateX(" + (-(py - 0.5) * 5).toFixed(2) + "deg) translateY(-3px)";
        });
        card.addEventListener("pointerleave", function () { card.style.transform = ""; });
      })(cards[i]);
    }
  }

  // 2) Quality score rings: count up + fill the conic ring on first view
  var rings = document.querySelectorAll(".ring[data-score]");
  if (!rings.length) return;

  function setRing(el, value) {
    el.style.setProperty("--p", value.toFixed(1) + "%");
    var b = el.querySelector("b");
    if (b) b.textContent = Math.round(value);
  }

  if (rm || !("IntersectionObserver" in window)) {
    for (var k = 0; k < rings.length; k++) setRing(rings[k], +rings[k].getAttribute("data-score"));
    return;
  }

  function animate(el) {
    var target = +el.getAttribute("data-score");
    var startTs = null, dur = 1100;
    function tick(ts) {
      if (startTs === null) startTs = ts;
      var t = Math.min((ts - startTs) / dur, 1);
      var eased = 1 - Math.pow(1 - t, 3); // easeOutCubic
      setRing(el, target * eased);
      if (t < 1) requestAnimationFrame(tick);
    }
    requestAnimationFrame(tick);
  }

  var io = new IntersectionObserver(function (entries) {
    entries.forEach(function (en) {
      if (en.isIntersecting) { animate(en.target); io.unobserve(en.target); }
    });
  }, { threshold: 0.6 });

  for (var j = 0; j < rings.length; j++) io.observe(rings[j]);
})();

/* 3) Animated product demo: browse the library, pick a book, choose Q&A,
   generate, and watch the output stream out. A simulated cursor drives it.
   Loops while on-screen, pauses off-screen, static end-state for reduced motion. */
(function () {
  var demo = document.getElementById("studioDemo");
  if (!demo) return;
  var rm = window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  var cursor = demo.querySelector(".dcursor");
  var track = demo.querySelector(".carousel-track");
  var carousel = demo.querySelector(".carousel");
  var lead = demo.querySelector(".bk.lead");
  var qaOpt = demo.querySelector(".opt.qa");
  var genbtn = demo.querySelector(".genbtn");
  var steps = demo.querySelectorAll(".gen-steps li");
  var title = demo.querySelector(".out-title");
  var ocards = demo.querySelectorAll(".ocard");
  function grab(sel) { return [].map.call(demo.querySelectorAll(sel), function (el) { return { el: el, text: el.textContent }; }); }
  var qaAns = grab(".qa-content .oa"), allAns = qaAns;
  if (!cursor || !track || !lead || !qaOpt || !genbtn) return;

  if (rm) { // no motion: show the finished Q&A output
    demo.classList.add("mode-qa");
    demo.setAttribute("data-phase", "5");
    lead.classList.add("sel"); qaOpt.classList.add("on");
    demo.classList.add("genstart");
    for (var s = 0; s < steps.length; s++) steps[s].classList.add("done");
    return;
  }

  function leadX() { return -(lead.offsetLeft + lead.offsetWidth / 2 - carousel.clientWidth / 2); }
  function moveTo(el, dx, dy) {
    if (!el) return;
    var d = demo.getBoundingClientRect(), r = el.getBoundingClientRect();
    var x = r.left - d.left + r.width / 2 + (dx || 0), y = r.top - d.top + r.height / 2 + (dy || 0);
    cursor.style.transform = "translate(" + x + "px," + y + "px)";
  }
  function tap() { cursor.classList.remove("tap"); void cursor.offsetWidth; cursor.classList.add("tap"); }
  function typeOut(a) {            // reveal the card and stream its answer in together, like the model is writing it
    var el = a.el, text = a.text, i = 0;
    el.innerHTML = '<span class="caret"></span>';
    var card = el.parentNode;
    if (card && card.classList && card.classList.contains("ocard")) card.classList.add("show");
    (function step() {
      i = Math.min(i + 2, text.length);
      el.innerHTML = text.slice(0, i) + (i < text.length ? '<span class="caret"></span>' : '');
      if (i < text.length) timers.push(setTimeout(step, 22));
    })();
  }

  var timers = [];
  function at(ms, fn) { timers.push(setTimeout(fn, ms)); }
  function clearAll() { for (var i = 0; i < timers.length; i++) clearTimeout(timers[i]); timers = []; }

  function parkCursor() {   // tuck the cursor into the bottom-right so it never hides the output
    cursor.style.transform = "translate(" + (demo.clientWidth - 30) + "px," + (demo.clientHeight - 32) + "px)";
  }
  function play() {
    clearAll();
    demo.classList.add("mode-qa");
    if (title) title.textContent = "Q&A pulled from Ask Pastor John";
    demo.setAttribute("data-phase", "1");
    demo.classList.remove("genstart");
    lead.classList.remove("sel"); qaOpt.classList.remove("on");
    for (var s = 0; s < steps.length; s++) steps[s].classList.remove("done");
    for (var c = 0; c < ocards.length; c++) ocards[c].classList.remove("show");
    for (var a = 0; a < allAns.length; a++) allAns[a].el.textContent = allAns[a].text;
    track.style.transition = "none"; track.style.transform = "translateX(" + (leadX() + 250) + "px)";
    cursor.style.transition = "none"; cursor.style.transform = "translate(72px, 104px)";

    at(80, function () {
      cursor.style.transition = "";
      track.style.transition = "transform 3.4s var(--ease, ease)";
      track.style.transform = "translateX(" + leadX() + "px)"; // slow drift through the shelf, ending on the lead
    });
    at(3000, function () { moveTo(lead, 0, -8); });               // cursor to the book
    at(3900, function () { tap(); lead.classList.add("sel"); });  // select it
    at(4900, function () { demo.setAttribute("data-phase", "3"); }); // enter the working view
    at(5700, function () { moveTo(qaOpt); });                     // cursor to Q&A
    at(6700, function () { tap(); qaOpt.classList.add("on"); demo.classList.add("genstart"); });
    at(7700, function () { moveTo(genbtn); });                    // cursor to Generate
    at(8700, function () { tap(); demo.setAttribute("data-phase", "4"); }); // generating
    at(9050, function () { parkCursor(); });                      // move the cursor out of the way
    at(9100, function () { steps[0] && steps[0].classList.add("done"); });
    at(9800, function () { steps[1] && steps[1].classList.add("done"); });
    at(10500, function () { steps[2] && steps[2].classList.add("done"); });
    at(11200, function () { steps[3] && steps[3].classList.add("done"); });
    at(11900, function () { demo.setAttribute("data-phase", "5"); }); // output frame; each card stays hidden until it types in
    if (qaAns[0]) at(12300, function () { typeOut(qaAns[0]); });  // stream the answers in, one after another
    if (qaAns[1]) at(13050, function () { typeOut(qaAns[1]); });
    if (qaAns[2]) at(13800, function () { typeOut(qaAns[2]); });
    at(20000, play);                                             // long hold so it is easy to read, then loop
  }

  var running = false;
  function start() { if (running) return; running = true; play(); }
  function stop() { running = false; clearAll(); }
  if ("IntersectionObserver" in window) {
    new IntersectionObserver(function (es) { es[0].isIntersecting ? start() : stop(); }, { rootMargin: "-48% 0px -48% 0px", threshold: 0 }).observe(demo);
  } else { start(); }
})();

/* 4) Photo Editor demo: operating the editor as part of the ecosystem.
   Import a quote from the Content Repurposer (it generates in, off-center),
   drag it to center, choose platform + format from dropdowns (reframe), swap
   the background, stamp the logo, then export. A cursor drives it; loops. */
(function () {
  var pe = document.getElementById("peDemo");
  if (!pe) return;
  var rm = window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  var card = pe.querySelector(".pe-card");
  var box = pe.querySelector(".pe-textbox");
  var quote = pe.querySelector(".pe-quote");
  var attr = pe.querySelector(".pe-attr");
  var cursor = pe.querySelector(".dcursor");
  var bgs = pe.querySelectorAll(".pe-bg");
  var impBtn = pe.querySelector(".pe-imp");
  var expBtn = pe.querySelector(".pe-exp");
  var expLab = expBtn && expBtn.querySelector(".ex-label");
  var expDefault = expLab ? expLab.textContent : "";
  var logoBtn = pe.querySelector(".pe-logobtn");
  var logo = pe.querySelector(".pe-logo");
  var platSel = pe.querySelector('.pe-select[data-sel="platform"]');
  var fmtSel = pe.querySelector('.pe-select[data-sel="format"]');
  if (!card || !box || !quote || !attr || !cursor || !impBtn || !expBtn || !platSel || !fmtSel || !bgs.length) return;
  var quoteText = quote.textContent, attrText = attr.textContent;
  var platDef = platSel.querySelector(".pe-selopt.sel");
  var fmtDef = fmtSel.querySelector(".pe-selopt.sel");

  function setFmt(f) { pe.setAttribute("data-fmt", f); }
  function setBg(n) { card.setAttribute("data-bg", String(n)); for (var i = 0; i < bgs.length; i++) bgs[i].classList.toggle("on", bgs[i].getAttribute("data-bg") === String(n)); }
  function trig(sel) { return sel.querySelector(".pe-seltrigger"); }
  function selectOpt(sel, optEl) {
    if (!optEl) return;
    var opts = sel.querySelectorAll(".pe-selopt");
    for (var i = 0; i < opts.length; i++) opts[i].classList.remove("sel", "hot");
    optEl.classList.add("sel");
    var ic = optEl.querySelector(".picon"), tIc = sel.querySelector(".pe-seltrigger .picon");
    if (ic && tIc) tIc.parentNode.replaceChild(ic.cloneNode(true), tIc);
    var val = sel.querySelector(".pe-selval");
    if (val) val.textContent = optEl.textContent.trim();
  }
  function hotOpt(optEl) { if (!optEl) return; var sibs = optEl.parentNode.children; for (var i = 0; i < sibs.length; i++) sibs[i].classList.remove("hot"); optEl.classList.add("hot"); }

  if (rm) {
    setFmt("ig"); setBg(0); box.classList.add("shown");
    quote.textContent = quoteText; attr.textContent = attrText; attr.style.opacity = "1";
    if (logo) logo.classList.add("show");
    return;
  }

  var timers = [];
  function at(ms, fn) { timers.push(setTimeout(fn, ms)); }
  function clearAll() { for (var i = 0; i < timers.length; i++) clearTimeout(timers[i]); timers = []; }
  function moveTo(el, dx, dy) {
    if (!el) return;
    var d = pe.getBoundingClientRect(), r = el.getBoundingClientRect();
    cursor.style.transform = "translate(" + (r.left - d.left + r.width / 2 + (dx || 0)) + "px," + (r.top - d.top + r.height / 2 + (dy || 0)) + "px)";
  }
  function tap() { cursor.classList.remove("tap"); void cursor.offsetWidth; cursor.classList.add("tap"); }
  function typeQuote() {            // the imported quote streams in like it is being generated
    var i = 0; quote.innerHTML = '<span class="pe-caret"></span>';
    (function step() {
      i = Math.min(i + 2, quoteText.length);
      quote.innerHTML = quoteText.slice(0, i) + (i < quoteText.length ? '<span class="pe-caret"></span>' : '');
      if (i < quoteText.length) timers.push(setTimeout(step, 30));
      else timers.push(setTimeout(function () { attr.textContent = attrText; attr.style.transition = "opacity .4s"; attr.style.opacity = "1"; }, 80));
    })();
  }

  function play() {
    clearAll();
    setFmt("ig"); setBg(0);
    selectOpt(platSel, platDef); selectOpt(fmtSel, fmtDef);
    platSel.classList.remove("open"); fmtSel.classList.remove("open");
    box.classList.remove("shown", "grab", "sel"); box.classList.add("off");
    quote.textContent = ""; attr.textContent = ""; attr.style.opacity = "0";
    impBtn.classList.remove("on"); expBtn.classList.remove("loading", "done");
    if (expLab) expLab.textContent = expDefault;
    if (logoBtn) logoBtn.classList.remove("on");
    if (logo) logo.classList.remove("show");
    cursor.style.transition = "none"; cursor.style.transform = "translate(88px, 34px)";
    at(60, function () { cursor.style.transition = ""; });
    // 1) Import from the Content Repurposer — the quote generates in, off-center
    at(800, function () { moveTo(impBtn); });
    at(1500, function () { tap(); impBtn.classList.add("on"); box.classList.add("shown"); typeQuote(); });
    at(2100, function () { impBtn.classList.remove("on"); });
    // 2) the imported text landed off-center — grab it and drag it to centered (smooth transform-glide, cursor synced)
    at(3800, function () { moveTo(box, 0, -6); box.classList.add("sel"); });
    at(4400, function () { box.classList.add("grab"); });
    at(4700, function () { box.classList.remove("off"); cursor.style.transition = "transform .5s cubic-bezier(.22,.61,.36,1)"; moveTo(card, 0, -2); });
    at(5500, function () { box.classList.remove("grab"); cursor.style.transition = ""; });
    at(6100, function () { box.classList.remove("sel"); });
    // 3) Platform dropdown — open and pick Instagram
    at(6900, function () { moveTo(trig(platSel)); });
    at(7400, function () { tap(); platSel.classList.add("open"); });
    at(7950, function () { var o = platSel.querySelector('[data-plat="ig"]'); moveTo(o); hotOpt(o); });
    at(8500, function () { tap(); selectOpt(platSel, platSel.querySelector('[data-plat="ig"]')); platSel.classList.remove("open"); });
    // 4) Format dropdown — open and pick Story (the canvas reframes to 9:16)
    at(9300, function () { moveTo(trig(fmtSel)); });
    at(9800, function () { tap(); fmtSel.classList.add("open"); });
    at(10400, function () { var o = fmtSel.querySelector('[data-key="story"]'); moveTo(o); hotOpt(o); });
    at(11000, function () { var o = fmtSel.querySelector('[data-key="story"]'); tap(); selectOpt(fmtSel, o); setFmt(o.getAttribute("data-fmt")); fmtSel.classList.remove("open"); });
    // 5) swap the background to the foggy forest
    at(12000, function () { moveTo(bgs[1]); });
    at(12600, function () { tap(); setBg(1); });
    // 6) stamp the logo into the bottom-left
    at(13500, function () { moveTo(logoBtn); });
    at(14100, function () { tap(); if (logoBtn) logoBtn.classList.add("on"); if (logo) logo.classList.add("show"); });
    at(14500, function () { if (logoBtn) logoBtn.classList.remove("on"); });
    // 7) export — a loading beat, then the checkmark
    at(15400, function () { moveTo(expBtn); });
    at(16100, function () { tap(); expBtn.classList.add("loading"); if (expLab) expLab.textContent = "Exporting…"; });
    at(17400, function () { expBtn.classList.remove("loading"); expBtn.classList.add("done"); if (expLab) expLab.textContent = "Posted"; });
    at(21500, play);
  }
  var running = false;
  function start() { if (running) return; running = true; play(); }
  function stop() { running = false; clearAll(); }
  if ("IntersectionObserver" in window) {
    new IntersectionObserver(function (es) { es[0].isIntersecting ? start() : stop(); }, { rootMargin: "-48% 0px -48% 0px", threshold: 0 }).observe(pe);
  } else { start(); }
})();

/* 5) Transcription demo: a sermon file dropped in, a short processing beat,
   then the transcript streams out line by line with speaker labels. */
(function () {
  var tr = document.getElementById("trDemo");
  if (!tr) return;
  var rm = window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  var go = tr.querySelector(".tr-go");
  var cursor = tr.querySelector(".dcursor");
  var lines = tr.querySelectorAll(".tr-line");
  var trLines = tr.querySelector(".tr-lines");
  var trScript = tr.querySelector(".tr-script");
  var expBtn = tr.querySelector(".tr-export");
  var expLab = expBtn && expBtn.querySelector(".trx-label");
  var expDefault = expLab ? expLab.textContent : "";
  if (!go || !cursor) return;

  if (rm) {
    tr.setAttribute("data-st", "done");
    for (var i = 0; i < lines.length; i++) lines[i].classList.add("show");
    return;
  }

  var timers = [];
  function at(ms, fn) { timers.push(setTimeout(fn, ms)); }
  function clearAll() { for (var i = 0; i < timers.length; i++) clearTimeout(timers[i]); timers = []; }
  function moveTo(el, dy) {
    var d = tr.getBoundingClientRect(), r = el.getBoundingClientRect();
    cursor.style.transform = "translate(" + (r.left - d.left + r.width / 2) + "px," + (r.top - d.top + r.height / 2 + (dy || 0)) + "px)";
  }
  function tap() { cursor.classList.remove("tap"); void cursor.offsetWidth; cursor.classList.add("tap"); }
  function showLine(i) {            // reveal a line, then auto-scroll so the newest stays in view
    if (!lines[i]) return;
    lines[i].classList.add("show");
    if (trLines && trScript) {
      var off = Math.max(0, lines[i].offsetTop + lines[i].offsetHeight - trScript.clientHeight + 4);
      trLines.style.transform = "translateY(-" + off + "px)";
    }
  }

  function play() {
    clearAll();
    tr.setAttribute("data-st", "idle"); tr.classList.remove("dropping");
    for (var c = 0; c < lines.length; c++) lines[c].classList.remove("show");
    if (trLines) trLines.style.transform = "translateY(0)";
    if (expBtn) { expBtn.classList.remove("loading", "done"); if (expLab) expLab.textContent = expDefault; }
    cursor.style.transition = "none"; cursor.style.transform = "translate(60px, 150px)";
    at(60, function () { cursor.style.transition = ""; });
    at(1000, function () { moveTo(go); });
    at(1700, function () { tr.classList.add("dropping"); });
    at(2100, function () { tap(); tr.classList.remove("dropping"); tr.setAttribute("data-st", "working"); });
    at(2450, function () { cursor.style.transform = "translate(" + (tr.clientWidth - 28) + "px," + (tr.clientHeight - 28) + "px)"; });
    at(4900, function () { tr.setAttribute("data-st", "done"); });
    // the transcript streams out, auto-scrolling to follow the newest line
    at(5200, function () { showLine(0); });
    at(5800, function () { showLine(1); });
    at(6400, function () { showLine(2); });
    at(7000, function () { showLine(3); });
    at(7600, function () { showLine(4); });
    at(8200, function () { showLine(5); });
    at(8800, function () { showLine(6); });
    // hand the finished transcript to the Repurposer — the ecosystem link
    at(10100, function () { if (expBtn) moveTo(expBtn, -4); });
    at(10800, function () { if (expBtn) { tap(); expBtn.classList.add("loading"); if (expLab) expLab.textContent = "Exporting…"; } });
    at(12000, function () { if (expBtn) { expBtn.classList.remove("loading"); expBtn.classList.add("done"); if (expLab) expLab.textContent = "Sent to extraction"; } });
    at(16500, play);
  }
  var running = false;
  function start() { if (running) return; running = true; play(); }
  function stop() { running = false; clearAll(); }
  if ("IntersectionObserver" in window) {
    new IntersectionObserver(function (es) { es[0].isIntersecting ? start() : stop(); }, { rootMargin: "-48% 0px -48% 0px", threshold: 0 }).observe(tr);
  } else { start(); }
})();

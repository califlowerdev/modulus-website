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
    new IntersectionObserver(function (es) { es[0].isIntersecting ? start() : stop(); }, { threshold: 0.3 }).observe(demo);
  } else { start(); }
})();

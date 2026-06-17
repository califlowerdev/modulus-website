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
  var qa = demo.querySelector(".opt.qa");
  var genbtn = demo.querySelector(".genbtn");
  var steps = demo.querySelectorAll(".gen-steps li");
  if (!cursor || !track || !lead || !qa || !genbtn) return;

  if (rm) { // no motion: show the finished output
    demo.setAttribute("data-phase", "5");
    lead.classList.add("sel"); qa.classList.add("on");
    demo.classList.add("genstart");
    for (var s = 0; s < steps.length; s++) steps[s].classList.add("done");
    return;
  }

  function leadX() { return -(lead.offsetLeft + lead.offsetWidth / 2 - carousel.clientWidth / 2); }
  function moveTo(el, dx, dy) {
    if (!el) return;
    var d = demo.getBoundingClientRect(), r = el.getBoundingClientRect();
    cursor.style.transform = "translate(" + (r.left - d.left + r.width / 2 + (dx || 0)) +
      "px," + (r.top - d.top + r.height / 2 + (dy || 0)) + "px)";
  }
  function tap() { cursor.classList.remove("tap"); void cursor.offsetWidth; cursor.classList.add("tap"); }

  var timers = [];
  function at(ms, fn) { timers.push(setTimeout(fn, ms)); }
  function clearAll() { for (var i = 0; i < timers.length; i++) clearTimeout(timers[i]); timers = []; }

  function play() {
    clearAll();
    demo.setAttribute("data-phase", "1");
    demo.classList.remove("genstart");
    lead.classList.remove("sel"); qa.classList.remove("on");
    for (var s = 0; s < steps.length; s++) steps[s].classList.remove("done");
    track.style.transition = "none";
    track.style.transform = "translateX(" + (leadX() + 250) + "px)";
    cursor.style.transition = "none";
    cursor.style.transform = "translate(72px, 104px)";

    at(60, function () {
      cursor.style.transition = "";
      track.style.transition = "transform 2.9s linear";
      track.style.transform = "translateX(" + leadX() + "px)"; // drift, ending centered on the lead
    });
    at(2400, function () { moveTo(lead, 0, -8); });               // cursor to the book
    at(3200, function () { tap(); lead.classList.add("sel"); });  // select it
    at(4100, function () { demo.setAttribute("data-phase", "3"); }); // enter the working view
    at(4750, function () { moveTo(qa); });                        // cursor to Q&A
    at(5550, function () { tap(); qa.classList.add("on"); demo.classList.add("genstart"); });
    at(6350, function () { moveTo(genbtn); });                    // cursor to Generate
    at(7150, function () { tap(); demo.setAttribute("data-phase", "4"); }); // generating
    at(7450, function () { steps[0] && steps[0].classList.add("done"); });
    at(7950, function () { steps[1] && steps[1].classList.add("done"); });
    at(8500, function () { steps[2] && steps[2].classList.add("done"); });
    at(9050, function () { steps[3] && steps[3].classList.add("done"); });
    at(9550, function () { demo.setAttribute("data-phase", "5"); moveTo(carousel, 0, 70); }); // output
    at(13800, play);                                              // hold, then loop
  }

  var running = false;
  function start() { if (running) return; running = true; play(); }
  function stop() { running = false; clearAll(); }
  if ("IntersectionObserver" in window) {
    new IntersectionObserver(function (es) { es[0].isIntersecting ? start() : stop(); }, { threshold: 0.3 }).observe(demo);
  } else { start(); }
})();

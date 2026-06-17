/* Modulus Studio — minimal motion.
   The hero background is now a calm, static glow (no cursor chase).
   The only interaction kept is the gentle 3D tilt on the .tilt cards
   and window mockups, which respond to the pointer that is over them.
   Respects prefers-reduced-motion. Same-origin + programmatic styles only — CSP-safe. */
(function () {
  var rm = window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  if (rm) return;

  // Gentle tilt + soft spotlight on .tilt cards (the 3D depth, kept subtle)
  var cards = document.querySelectorAll(".tilt");
  for (var i = 0; i < cards.length; i++) {
    (function (card) {
      card.addEventListener("pointermove", function (e) {
        var r = card.getBoundingClientRect();
        var px = (e.clientX - r.left) / r.width;
        var py = (e.clientY - r.top) / r.height;
        card.style.setProperty("--mx", (px * 100).toFixed(2) + "%");
        card.style.setProperty("--my", (py * 100).toFixed(2) + "%");
        card.style.transform = "perspective(1000px) rotateY(" + ((px - 0.5) * 5).toFixed(2) +
          "deg) rotateX(" + (-(py - 0.5) * 5).toFixed(2) + "deg) translateY(-3px)";
      });
      card.addEventListener("pointerleave", function () { card.style.transform = ""; });
    })(cards[i]);
  }
})();

/* Modulus Studio — signature adaptive-feedback animation.
   1) Hero "aurora": a soft radial glow that follows the cursor.
   2) Tilt + spotlight on .tilt cards: the card tilts toward the pointer and a
      highlight tracks the pointer inside it. Respects prefers-reduced-motion.
   Same-origin script + programmatic styles only — CSP-safe. */
(function () {
  var rm = window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  if (rm) return;

  // Hero cursor aurora
  var glow = document.getElementById("sGlow");
  var hero = document.querySelector(".s-hero");
  if (glow && hero) {
    hero.addEventListener("pointermove", function (e) {
      var r = hero.getBoundingClientRect();
      glow.style.setProperty("--mx", ((e.clientX - r.left) / r.width * 100).toFixed(2) + "%");
      glow.style.setProperty("--my", ((e.clientY - r.top) / r.height * 100).toFixed(2) + "%");
    });
  }

  // Tilt + spotlight cards
  var cards = document.querySelectorAll(".tilt");
  for (var i = 0; i < cards.length; i++) {
    (function (card) {
      card.addEventListener("pointermove", function (e) {
        var r = card.getBoundingClientRect();
        var px = (e.clientX - r.left) / r.width;
        var py = (e.clientY - r.top) / r.height;
        card.style.setProperty("--mx", (px * 100).toFixed(2) + "%");
        card.style.setProperty("--my", (py * 100).toFixed(2) + "%");
        card.style.transform = "perspective(900px) rotateY(" + ((px - 0.5) * 7).toFixed(2) +
          "deg) rotateX(" + (-(py - 0.5) * 7).toFixed(2) + "deg) translateY(-4px)";
      });
      card.addEventListener("pointerleave", function () { card.style.transform = ""; });
    })(cards[i]);
  }
})();

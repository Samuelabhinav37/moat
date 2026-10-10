// The page's product demos. Each one shows the problem, then Moat's real
// answer, and the cookie that stands for the problem fades and blurs out
// ("handled"); then it calmly starts over. Everything plays only while on
// screen; reduced motion shows the answered state and stays still.
(function () {
  "use strict";
  var reduce = matchMedia("(prefers-reduced-motion: reduce)").matches;
  var sleep = function (ms) { return new Promise(function (r) { setTimeout(r, ms); }); };
  var watch = function (el, cb, t) {
    if (!el) return;
    if (!("IntersectionObserver" in window)) { cb(true); return; }
    new IntersectionObserver(function (en) { cb(en[0].isIntersecting); }, { threshold: t || .4 }).observe(el);
  };
  // runs `step` in a loop while `el` is on screen
  var loop = function (el, step, done) {
    var on = false, running = false;
    var go = async function () {
      if (running) return; running = true;
      while (on) await step(function () { return on; });
      running = false; if (done) done();
    };
    watch(el, function (v) { on = v; if (v) go(); }, .45);
  };

  // ---- before/after sliders. `paint(v)` gets the share of the page shown
  // without Moat (1 = all ads, 0 = clean) as the slider moves or sweeps.
  var slider = function (cmp, start, sweep, paint, onTake, sweepClass, end) {
    sweepClass = sweepClass || "sweep"; end = end === undefined ? start : end;
    if (!cmp) return;
    var range = cmp.querySelector(".range"), taken = false;
    var x = function () { return parseFloat(getComputedStyle(cmp).getPropertyValue("--x")) || start; };
    var set = function (v) {
      cmp.style.setProperty("--x", v + "%");
      range.setAttribute("aria-valuetext", v < 10 ? "With Moat" : v > 90 ? "Without Moat" : Math.round(v) + "% without Moat");
      paint(v / 100);
    };
    var take = function () { if (taken) return; taken = true; cmp.classList.remove(sweepClass); set(range.value); if (onTake) onTake(); };
    ["pointerdown", "keydown", "touchstart"].forEach(function (t) { range.addEventListener(t, take, { passive: true }); });
    range.addEventListener("input", function () { take(); set(range.value); });
    set(start);
    if (sweep && !reduce && window.CSS && CSS.registerProperty) {
      var swept = false;
      watch(cmp, function (v) {
        if (!v || swept || taken) return;
        swept = true; cmp.classList.add(sweepClass); if (onTake) onTake();
        var t0 = performance.now();
        var tick = function (t) { paint(x() / 100); if (t - t0 < 4400 && cmp.classList.contains(sweepClass)) requestAnimationFrame(tick); };
        requestAnimationFrame(tick);
      }, .5);
      cmp.addEventListener("animationend", function () { if (!taken) { cmp.classList.remove(sweepClass); set(end); range.value = end; } });
    }
  };
  var fade = function (img, v, min) {
    img.style.opacity = (min + (1 - min) * v).toFixed(3);
    img.style.filter = "saturate(" + (.3 + .7 * v).toFixed(2) + ") blur(" + ((1 - v) * 7).toFixed(1) + "px) drop-shadow(0 18px 24px rgba(0,0,0,.55))";
    img.style.scale = (.9 + .1 * v).toFixed(3);
  };

  // "Just the page you came for": slide toward "With Moat" and the cookies go
  var cmp2 = document.getElementById("compare2");
  if (cmp2) {
    var diff = document.getElementById("scene-diff"), hint = document.getElementById("scene-hint");
    var diffOuts = [].slice.call(diff.querySelectorAll(".out .char"));
    var diffKai = diff.querySelector("[data-kai]"), happy = false;
    slider(cmp2, 100, true, function (v) {
      diffOuts.forEach(function (img) { fade(img, v, 0); });
      // Kai's face follows the slider: annoyed while the ads are up,
      // happy once the page is clean, plain in between.
      var kai = window.MoatLife && diffKai ? window.MoatLife.kai(diffKai) : null;
      if (!kai) return;
      var mood = v > .6 ? "focus" : v < .08 ? "happy" : "";
      if (mood !== kai.mood) { kai.setMood(mood); if (mood === "happy" && !happy) { happy = true; kai.hop(); } }
      if (v > .3) happy = false;
    }, function () { if (hint) hint.classList.add("gone"); }, "sweep-clean", 0);
  }

  var feature = function (id) { return document.getElementById(id); };

  // ---- trackers: each blocked tracker is ticked off, then Crumb is handled ----
  var ft = feature("f-trackers"), rep = document.getElementById("report");
  if (ft && rep) {
    var lis = [].slice.call(rep.querySelectorAll("li"));
    if (reduce) { lis.forEach(function (li) { li.classList.add("on"); }); ft.classList.add("done"); }
    else loop(ft, async function (on) {
      ft.classList.remove("handled"); lis.forEach(function (li) { li.classList.remove("on"); });
      await sleep(1200);
      for (var i = 0; i < lis.length && on(); i++) { lis[i].classList.add("on"); await sleep(420); }
      await sleep(400); ft.classList.add("handled");
      await sleep(4200);
    });
  }

  // ---- cookie banners: the real steps of Moat's consent rule, then Nag ---------
  var fb = feature("f-banners"), film = document.getElementById("steps-film");
  if (fb && film) {
    var frames = [].slice.call(film.querySelectorAll("img"));
    var caps = [].slice.call(fb.querySelectorAll(".steps-cap span"));
    var capFor = [0, 1, 2, 2, 2, 3];          // frame -> caption
    var show = function (k) {
      frames.forEach(function (f, i) { f.classList.toggle("on", i === k); });
      caps.forEach(function (c, i) { c.classList.toggle("on", i === capFor[k]); });
    };
    if (reduce) { show(frames.length - 2); fb.classList.add("done"); }
    else { show(0); loop(fb, async function (on) {
      fb.classList.remove("handled"); show(0);
      await sleep(1800);
      for (var k = 1; k < frames.length && on(); k++) { show(k); await sleep(k === 1 ? 1100 : 700); }
      fb.classList.add("handled");
      await sleep(3800);
    }); }
  }

  // ---- pop-ups: a tab sneaks open, gets struck out and closed, then Popsy -------
  var fp = feature("f-popups"), tabs = document.getElementById("tabs-demo");
  if (fp && tabs) {
    if (reduce) fp.classList.add("done");
    else loop(fp, async function () {
      fp.classList.remove("handled"); tabs.className = "tabs-demo";
      await sleep(1600);
      tabs.classList.add("open"); await sleep(1400);
      tabs.classList.remove("open"); tabs.classList.add("struck"); await sleep(700);
      tabs.classList.remove("struck"); fp.classList.add("handled");
      await sleep(3800);
    });
  }

  // ---- the film: plays on click, with sound; phones get 720p ---------------------
  var film = document.getElementById("film"), play = document.getElementById("play");
  if (film && play) {
    watch(film, function (v) { if (v) film.classList.add("in-view"); }, .3);
    play.addEventListener("click", function () {
      var v = document.createElement("video");
      v.src = matchMedia("(max-width: 900px)").matches ? "media/moat-film-720.mp4" : "media/moat-film.mp4";
      v.controls = true; v.playsInline = true; v.autoplay = true; v.preload = "auto";
      v.poster = "media/moat-film-poster.webp";
      v.setAttribute("aria-label", "Moat film");
      film.appendChild(v); film.classList.add("playing");
      v.addEventListener("ended", function () { v.remove(); film.classList.remove("playing"); play.focus(); });
      v.play().catch(function () {});
    });
  }
})();

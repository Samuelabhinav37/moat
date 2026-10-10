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

  // ---- before/after; Blare is there while the ads are ------------------------
  var cmp = document.getElementById("compare"), blare = document.getElementById("blare-side");
  if (cmp) {
    var range = cmp.querySelector(".range"), taken = false;
    var x = function () { return parseFloat(getComputedStyle(cmp).getPropertyValue("--x")) || 50; };
    var paintBlare = function () {
      if (!blare) return;
      var v = x() / 100;                      // share of the page shown without Moat
      var img = blare.firstElementChild;
      img.style.opacity = (.15 + .85 * v).toFixed(3);
      img.style.filter = "blur(" + ((1 - v) * 7).toFixed(1) + "px) drop-shadow(0 18px 24px rgba(0,0,0,.55))";
    };
    var set = function (v) {
      cmp.style.setProperty("--x", v + "%");
      range.setAttribute("aria-valuetext", v < 10 ? "Mostly with Moat" : v > 90 ? "Mostly without Moat" : Math.round(v) + "% without Moat");
      paintBlare();
    };
    var take = function () { if (taken) return; taken = true; cmp.classList.remove("sweep"); set(range.value); };
    ["pointerdown", "keydown", "touchstart"].forEach(function (t) { range.addEventListener(t, take, { passive: true }); });
    range.addEventListener("input", function () { take(); set(range.value); });
    set(50);
    if (!reduce && window.CSS && CSS.registerProperty) {
      var swept = false;
      watch(cmp, function (v) {
        if (!v || swept || taken) return;
        swept = true; cmp.classList.add("sweep");
        var t0 = performance.now();
        var tick = function (t) { paintBlare(); if (t - t0 < 4000 && cmp.classList.contains("sweep")) requestAnimationFrame(tick); };
        requestAnimationFrame(tick);
      }, .5);
      cmp.addEventListener("animationend", function () { if (!taken) { cmp.classList.remove("sweep"); set(50); } });
    }
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
  // ---- closing scene: cookies drift up to the page now and then, and fade ------
  var scene = document.getElementById("scene");
  if (scene && !reduce) {
    var outs = [].slice.call(scene.querySelectorAll(".out"));
    var kaiEl = scene.querySelector("[data-kai]");
    var kai = window.MoatLife && kaiEl ? window.MoatLife.kai(kaiEl) : null;
    loop(scene, async function () {
      await sleep(2400 + Math.random() * 1800);
      var o = outs[Math.floor(Math.random() * outs.length)];
      if (getComputedStyle(o).display === "none") return;
      if (kai) { kai.target = o; kai.setMood("focus"); }
      o.classList.add("near"); await sleep(1200);
      o.classList.remove("near"); o.classList.add("handled");
      if (kai) { kai.setMood("happy", 1400); kai.target = null; }
      await sleep(2600);
      o.classList.remove("handled");
    });
  }
})();

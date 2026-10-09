// The page's product demos: the before/after inside the laptop, the
// tracker report, the cookie banner tile, the pop-up tab and the pause
// switch. Each plays only while on screen; reduced motion shows the end.
(function () {
  "use strict";
  var reduce = matchMedia("(prefers-reduced-motion: reduce)").matches;
  var sleep = function (ms) { return new Promise(function (r) { setTimeout(r, ms); }); };
  var watch = function (el, cb, t) {
    if (!el) return;
    if (!("IntersectionObserver" in window)) { cb(true); return; }
    new IntersectionObserver(function (en) { cb(en[0].isIntersecting); }, { threshold: t || .4 }).observe(el);
  };
  var once = function (el, cb, t) {
    var done = false;
    watch(el, function (v) { if (v && !done) { done = true; cb(); } }, t);
  };

  // before/after: sweeps once when it comes into view, then it's the visitor's
  var cmp = document.getElementById("compare");
  if (cmp) {
    var range = cmp.querySelector(".range");
    var set = function (v) {
      cmp.style.setProperty("--x", v + "%");
      range.setAttribute("aria-valuetext", v < 10 ? "Mostly with Moat" : v > 90 ? "Mostly without Moat" : Math.round(v) + "% without Moat");
    };
    var taken = false;
    var take = function () { if (taken) return; taken = true; cmp.classList.remove("sweep"); set(range.value); };
    ["pointerdown", "keydown", "focus", "touchstart"].forEach(function (t) { range.addEventListener(t, take, { passive: true }); });
    range.addEventListener("input", function () { take(); set(range.value); });
    if (reduce || !(window.CSS && CSS.registerProperty)) set(50);
    else once(cmp, function () { if (!taken) cmp.classList.add("sweep"); }, .5);
    cmp.addEventListener("animationend", function () { if (!taken) { cmp.classList.remove("sweep"); set(50); } });
  }

  // tracker report: rows arrive one by one
  var rep = document.getElementById("report");
  if (rep) once(rep, function () {
    var lis = rep.querySelectorAll("li");
    lis.forEach(function (li, i) { li.style.transitionDelay = (reduce ? 0 : 200 + i * 160) + "ms"; });
    rep.classList.add("on");
  });

  // cookie banner: the banner is there, then Moat answers it
  var consent = document.getElementById("consent"), chip = document.getElementById("consent-chip");
  if (consent) {
    var on = false, running = false;
    var loop = async function () {
      if (running) return; running = true;
      while (on) {
        consent.classList.remove("clean"); chip.classList.remove("on");
        await sleep(2200); if (!on) break;
        consent.classList.add("clean"); await sleep(500); chip.classList.add("on");
        await sleep(3600);
      }
      running = false;
    };
    if (reduce) { consent.classList.add("clean"); chip.classList.add("on"); }
    else watch(consent, function (v) { on = v; if (v) loop(); }, .4);
  }

  // pop-up tab: opens, gets struck out, closes
  var tabs = document.getElementById("tabs-demo");
  if (tabs && !reduce) {
    var ton = false, trun = false;
    var tloop = async function () {
      if (trun) return; trun = true;
      while (ton) {
        tabs.className = "tabs-demo"; await sleep(1400); if (!ton) break;
        tabs.classList.add("open"); await sleep(1300);
        tabs.classList.remove("open"); tabs.classList.add("struck"); await sleep(700);
        tabs.classList.remove("struck"); await sleep(2200);
      }
      tabs.className = "tabs-demo"; trun = false;
    };
    watch(tabs, function (v) { ton = v; if (v) tloop(); }, .4);
  }

  // pause switch: tapped, paused for a while, back on
  var flip = document.getElementById("flipper");
  if (flip && !reduce) {
    var fon = false, frun = false;
    var floop = async function () {
      if (frun) return; frun = true;
      while (fon) {
        await sleep(2000); if (!fon) break;
        flip.classList.remove("tapping"); void flip.offsetWidth; flip.classList.add("tapping");
        await sleep(300); flip.classList.add("paused");
        await sleep(3000);
        flip.classList.remove("tapping"); void flip.offsetWidth; flip.classList.add("tapping");
        await sleep(300); flip.classList.remove("paused");
        await sleep(1600);
      }
      flip.classList.remove("paused"); frun = false;
    };
    watch(flip, function (v) { fon = v; if (v) floop(); }, .4);
  }
})();

// The page's scenes, using the characters from life.js:
// - How to use it: Kai talks through each task while a cursor clicks
//   through real Moat screens, and watches that cursor as it goes;
// - reveals on scroll, and Kai cheering at the closing install button.
// Scenes run only while on screen; reduced motion shows the end states.
(function () {
  "use strict";
  var L = window.MoatLife;
  if (!L) return;
  var sleep = L.sleep, rand = L.rand, reduce = L.reduce;
  var watch = function (el, cb, threshold) {
    if (!("IntersectionObserver" in window)) { cb(true); return; }
    new IntersectionObserver(function (en) { cb(en[0].isIntersecting); }, { threshold: threshold || .3 }).observe(el);
  };

  // ---- reveals ----------------------------------------------------------------
  var rev = document.querySelectorAll("[data-reveal]");
  if ("IntersectionObserver" in window && !reduce) {
    var rio = new IntersectionObserver(function (en) {
      en.forEach(function (e) { if (e.isIntersecting) { e.target.classList.add("in"); rio.unobserve(e.target); } });
    }, { threshold: .2 });
    rev.forEach(function (el) { rio.observe(el); });
  } else rev.forEach(function (el) { el.classList.add("in"); });

  // ---- How to use it -----------------------------------------------------------------
  // Each task is a list of steps: Kai says the line, the step lights up, the
  // cursor moves to a spot on a real screenshot ([selector, x, y] as
  // fractions of that element's box) and clicks, and the window switches to
  // the next screen (data-s on .view items).
  var HOWTO = [
    { start: "1a", url: "wired.com/story/best-password-managers", steps: [
      { li: 0, say: "Site acting up? Click my icon, up by the address bar.", go: [".tb-moat", .5, .55], then: "1b" },
      { li: 1, say: "Flip the switch. Moat pauses on this site only.", go: ['img[data-s="1b"]', .79, .59], then: "1c" },
      { li: 2, say: "The page reloads without Moat. Every other site stays protected.", reload: true, happy: true }
    ] },
    { start: "2a", url: "recipes.example/tomato-soup", steps: [
      { li: 0, say: "See that app banner? Click my icon first.", go: [".tb-moat", .5, .55], then: "2b" },
      { li: 0, say: "Now pick Hide something on this page.", go: ['img[data-s="2b"]', .46, .85], then: "2c" },
      { li: 1, say: "Point at the banner and click it.", go: ['img[data-s="2c"]', .5, .3], then: "2d" },
      { li: 2, say: "Choose Hide on recipes.example.", go: ['img[data-s="2d"]', .234, .525], then: "2e" },
      { li: 2, say: "Gone. It stays gone next time too.", happy: true }
    ] },
    { start: "3a", url: "mail.example/inbox", steps: [
      { li: 0, say: "Here's a normal email. Click its link.", go: [".mail-btn", .5, .5], then: "3b", url: "www.awin1.com/cread.php?awinmid=1&ued=https%3A%2F%2Fexample.com" },
      { li: 1, say: "That link went through a tracker first, so I stopped it." },
      { li: 2, say: "Click Go to example.com to skip the tracker.", go: ['img[data-s="3b"]', .363, .434], then: "3c", url: "example.com/landing" },
      { li: 2, say: "And you land where the email meant to send you.", happy: true }
    ] },
    { start: "1a", url: "wired.com/story/best-password-managers", steps: [
      { li: 0, say: "My settings are one click away. Open my icon.", go: [".tb-moat", .5, .55], then: "1b" },
      { li: 0, say: "Then Settings, at the top.", go: ['img[data-s="1b"]', .83, .063], then: "4a", url: "Moat › Settings › Protection" },
      { li: 1, say: "Protection is where your level lives. Balanced is the default." },
      { li: 2, say: "Want more privacy? Pick Strict.", go: ['img[data-s="4a"]', .72, .44], then: "4b" },
      { li: 2, say: "Strict blocks more. If a site breaks, Light blocks less.", happy: true }
    ] },
    { start: "1a", url: "wired.com/story/best-password-managers", steps: [
      { li: 0, say: "Spotted a problem? Open my icon.", go: [".tb-moat", .5, .55], then: "1b" },
      { li: 0, say: "Pick Report a problem.", go: ['img[data-s="1b"]', .5, .923], then: "5a", url: "Moat › Report a problem" },
      { li: 1, say: "Say what's wrong.", go: ['img[data-s="5a"]', .115, .255], then: "5b" },
      { li: 2, say: "Open What will be sent. You see all of it first.", go: ['img[data-s="5b"]', .2, .814], then: "5c" },
      { li: 2, say: "Then send it. No account needed.", go: ['img[data-s="5c"]', .17, .931], happy: true }
    ] }
  ];
  var stageEl = document.getElementById("howstage");
  if (stageEl) {
    var view = stageEl.querySelector(".view"), cursor = document.getElementById("cursor"), ripple = document.getElementById("ripple");
    var urlEl = document.getElementById("tb-url"), sayEl = document.getElementById("kai-say");
    var kai = L.kai(document.getElementById("kai"));
    var tabs = [].slice.call(document.querySelectorAll(".howto-strip [role=tab]"));
    var items = [].slice.call(view.querySelectorAll("[data-s]"));
    var current = 0, token = 0, visible = false;
    var show = function (state) {
      stageEl.dataset.show = state;
      items.forEach(function (el) { el.classList.toggle("on", el.dataset.s.split(" ").indexOf(state) !== -1); });
    };
    var lis = function () { return [].slice.call(document.querySelectorAll("#how-" + (current + 1) + " li")); };
    var light = function (i) { lis().forEach(function (li, k) { li.classList.toggle("on", k === i); }); };
    // Kai types the line out, mouth moving while it does
    var typing = 0;
    var say = async function (text) {
      var my = ++typing;
      if (reduce) { sayEl.textContent = text; return; }
      kai.talk(text.length * 22 + 120);
      for (var n = 1; n <= text.length; n += 2) {
        if (my !== typing) return;
        sayEl.textContent = text.slice(0, n); await sleep(22);
      }
      sayEl.textContent = text;
    };
    var point = function (target) {
      var el = stageEl.querySelector(target[0]); if (!el) return null;
      var s = stageEl.getBoundingClientRect(), r = el.getBoundingClientRect();
      return { x: r.left - s.left + r.width * target[1], y: r.top - s.top + r.height * target[2] };
    };
    var moveTo = function (p) { cursor.style.transform = "translate(" + (p.x - 5) + "px," + (p.y - 3) + "px)"; };
    var rest = function () { var s = stageEl.getBoundingClientRect(); moveTo({ x: s.width * .62, y: s.height * .78 }); };
    var finalState = function (task) { var st = task.start; task.steps.forEach(function (s) { if (s.then) st = s.then; }); return st; };
    var run = async function () {
      var my = ++token, task = HOWTO[current];
      if (reduce) { show(finalState(task)); urlEl.textContent = task.url; sayEl.textContent = task.steps[task.steps.length - 1].say; light(-1); return; }
      stageEl.classList.add("live"); kai.target = cursor;
      while (my === token) {
        show(task.start); urlEl.textContent = task.url; light(-1); rest();
        say("Watch. I'll show you.");
        await sleep(1300);
        for (var i = 0; i < task.steps.length; i++) {
          if (my !== token) return;
          var step = task.steps[i];
          light(step.li); say(step.say);
          await sleep(step.go ? Math.max(900, step.say.length * 14) : Math.max(1600, step.say.length * 30));
          if (step.go) {
            var p = point(step.go); if (!p) continue;
            moveTo(p); await sleep(950); if (my !== token) return;
            ripple.style.left = p.x + "px"; ripple.style.top = p.y + "px";
            ripple.classList.remove("go"); void ripple.offsetWidth; ripple.classList.add("go");
            cursor.classList.add("press"); kai.nod();
            await sleep(160); cursor.classList.remove("press");
            await sleep(200);
            if (step.then) show(step.then);
            if (step.url) urlEl.textContent = step.url;
          }
          if (step.reload) { view.style.opacity = ".35"; await sleep(260); view.style.opacity = ""; }
          if (step.happy) { kai.setMood("happy", 1900); kai.hop(); }
          await sleep(step.happy ? 2800 : 900);
        }
        await sleep(900);
      }
    };
    var stop = function () { token++; typing++; stageEl.classList.remove("live"); kai.target = null; };
    var select = function (i, focus) {
      current = i;
      tabs.forEach(function (t, k) {
        var on = k === i;
        t.setAttribute("aria-selected", String(on)); t.tabIndex = on ? 0 : -1;
        document.getElementById(t.getAttribute("aria-controls")).hidden = !on;
      });
      if (focus) tabs[i].focus();
      stop(); if (visible || reduce) run();
    };
    tabs.forEach(function (t, i) {
      t.addEventListener("click", function () { select(i); });
      t.addEventListener("keydown", function (e) {
        var d = { ArrowRight: 1, ArrowLeft: -1 }[e.key];
        if (d) { e.preventDefault(); select((i + d + tabs.length) % tabs.length, true); }
      });
    });
    document.getElementById("how-next").addEventListener("click", function () { select((current + 1) % tabs.length); });
    show(HOWTO[0].start);
    if (reduce) run();
    else watch(stageEl, function (now) {
      if (now && !visible) { visible = true; run(); }
      else if (!now && visible) { visible = false; stop(); }
    }, .35);
  }

  // ---- CTA ----------------------------------------------------------------------------
  var ctaKaiEl = document.getElementById("cta-kai");
  if (ctaKaiEl) {
    var ck = L.kai(ctaKaiEl);
    ctaKaiEl.closest("section").querySelectorAll(".btn").forEach(function (b) {
      b.addEventListener("pointerenter", function () { ck.target = b; ck.setMood("happy"); ck.hop(); });
      b.addEventListener("pointerleave", function () { ck.target = null; ck.setMood(""); });
    });
  }
})();

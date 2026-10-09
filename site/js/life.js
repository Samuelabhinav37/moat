// Life for Moat's characters: Kai (live eyes and mouth over kai-face.webp)
// and the cookies (one still image each, brought to life by motion).
//
// The principles it follows (squash and stretch, anticipation, follow-
// through, ease in and out, staging): a cookie breathes, turns and leans to
// look at the pointer, ducks away when it gets close, crouches before a hop
// and squashes when it lands, gloats while an ad is up, and when Moat steps
// in it cracks into pieces that fall with gravity. Kai's eyes follow the
// pointer, blink at random, smile, focus and get scared; the mouth moves
// while Kai talks.
//
// Everything runs only while on screen. With reduced motion nothing moves,
// characters keep their resting pose, and every call below still works.
(function () {
  "use strict";
  var reduce = matchMedia("(prefers-reduced-motion: reduce)").matches;
  var pointer = { x: -1e4, y: -1e4, seen: false };
  addEventListener("pointermove", function (e) { pointer.x = e.clientX; pointer.y = e.clientY; pointer.seen = true; }, { passive: true });
  var sleep = function (ms) { return new Promise(function (r) { setTimeout(r, ms); }); };
  var rand = function (a, b) { return a + Math.random() * (b - a); };
  var clamp = function (v, a, b) { return Math.max(a, Math.min(b, v)); };
  var anim = function (el, frames, opts) {
    if (reduce || !el.animate) return Promise.resolve();
    var a = el.animate(frames, opts);
    return a.finished.catch(function () {});
  };

  // ---- visibility: characters act only while on screen -----------------
  var onScreen = new WeakMap();
  var io = "IntersectionObserver" in window ? new IntersectionObserver(function (en) {
    en.forEach(function (e) { onScreen.set(e.target, e.isIntersecting); });
  }, { rootMargin: "60px" }) : null;
  var visible = function (el) { return io ? !!onScreen.get(el) : true; };

  // ---- Kai ---------------------------------------------------------------
  function Kai(root) {
    this.root = root;
    root.insertAdjacentHTML("beforeend",
      '<span class="k-eye l"></span><span class="k-eye r"></span><span class="k-mouth"><i></i><i></i><i></i></span>');
    this.eyes = root.querySelectorAll(".k-eye");
    this.bars = root.querySelectorAll(".k-mouth i");
    this.target = null;      // an element or {x, y} to look at instead of the pointer
    this.mood = "";
    this.lx = 0; this.ly = 0;
    if (io) io.observe(root);
    if (!reduce) { this.blinkLoop(); this.lookLoop(); }
  }
  Kai.prototype.setMood = function (m, ms) {
    var self = this;
    this.root.classList.remove("happy", "scared", "focus");
    if (m) this.root.classList.add(m);
    this.mood = m || "";
    clearTimeout(this._mt);
    if (m && ms) this._mt = setTimeout(function () { self.setMood(""); }, ms);
  };
  Kai.prototype.blink = function () {
    this.eyes.forEach(function (e) { anim(e, [{ transform: e.style.transform + " scaleY(1)" }, { transform: e.style.transform + " scaleY(.08)" }, { transform: e.style.transform + " scaleY(1)" }], { duration: 150, easing: "ease-in-out" }); });
  };
  Kai.prototype.blinkLoop = async function () {
    for (;;) {
      await sleep(rand(1800, 5200));
      if (!visible(this.root) || this.mood === "happy") continue;
      this.blink();
      if (Math.random() < .25) { await sleep(220); this.blink(); }
    }
  };
  // eyes ease toward the target each frame (pointer, an element, or a wander point)
  Kai.prototype.lookLoop = function () {
    var self = this, wander = { x: 0, y: 0 }, nextWander = 0;
    var tick = function (t) {
      requestAnimationFrame(tick);
      if (!visible(self.root)) return;
      var r = self.root.getBoundingClientRect();
      var cx = r.left + r.width * .6, cy = r.top + r.height * .58;
      var tx, ty, p = null;
      if (self.target) {
        if (self.target.getBoundingClientRect) { var b = self.target.getBoundingClientRect(); p = { x: b.left + b.width / 2, y: b.top + b.height / 2 }; }
        else p = self.target;
      } else if (pointer.seen && Math.hypot(pointer.x - cx, pointer.y - cy) < 900) p = pointer;
      if (p) {
        var dx = p.x - cx, dy = p.y - cy, d = Math.hypot(dx, dy) || 1, k = Math.min(1, d / 260);
        tx = dx / d * 4.2 * k; ty = dy / d * 2.8 * k;
      } else {
        if (t > nextWander) { wander = { x: rand(-3.5, 3.5), y: rand(-2, 2) }; nextWander = t + rand(900, 2600); }
        tx = wander.x; ty = wander.y;
      }
      self.lx += (tx - self.lx) * .14; self.ly += (ty - self.ly) * .14;
      var tr = "translate(" + self.lx.toFixed(2) + "cqw," + self.ly.toFixed(2) + "cqw)";
      self.eyes.forEach(function (e) { e.style.transform = tr; });
    };
    requestAnimationFrame(tick);
  };
  // mouth bars move while Kai "says" something for ms milliseconds
  Kai.prototype.talk = function (ms) {
    if (reduce) return;
    var self = this, end = performance.now() + ms;
    clearInterval(this._talk);
    this._talk = setInterval(function () {
      var on = performance.now() < end;
      self.bars.forEach(function (b, i) { b.style.transform = on ? "scaleY(" + rand(.6, 2.6).toFixed(2) + ")" : ""; });
      if (!on) clearInterval(self._talk);
    }, 90);
  };
  Kai.prototype.hop = function () {
    return anim(this.root, [
      { transform: "translateY(0) scale(1,1)" },
      { transform: "translateY(2%) scale(1.06,.92)", offset: .18 },
      { transform: "translateY(-12%) scale(.96,1.05)", offset: .5 },
      { transform: "translateY(1%) scale(1.05,.95)", offset: .8 },
      { transform: "translateY(0) scale(1,1)" }
    ], { duration: 620, easing: "ease-in-out" });
  };
  Kai.prototype.nod = function () {
    return anim(this.root, [{ transform: "rotate(0)" }, { transform: "rotate(-6deg) translateY(-2%)", offset: .35 }, { transform: "rotate(3deg)", offset: .7 }, { transform: "rotate(0)" }], { duration: 480, easing: "ease-in-out" });
  };

  // ---- Cookies ------------------------------------------------------------
  // Pieces a cookie cracks into: polygons in % of its box.
  var SHARDS = [
    "0 0,46 0,40 34,0 42", "46 0,100 0,100 30,62 40,40 34", "0 42,40 34,34 66,0 70",
    "40 34,62 40,58 70,34 66", "62 40,100 30,100 72,58 70", "0 70,34 66,30 100,0 100",
    "34 66,58 70,64 100,30 100", "58 70,100 72,100 100,64 100"
  ];
  function Cookie(root) {
    this.root = root;
    this.img = root.querySelector("img");
    root.insertAdjacentHTML("afterbegin", '<span class="c-shadow"></span>');
    this.body = document.createElement("span"); this.body.className = "c-body";
    this.img.replaceWith(this.body); this.body.appendChild(this.img);
    this.shadow = root.querySelector(".c-shadow");
    this.face = root.dataset.face === "left" ? -1 : 1;   // which way the art faces
    this.lean = 0; this.dir = 1; this.busy = false; this.gone = false; this.mood = "";
    root.style.setProperty("--phase", (-Math.random() * 3).toFixed(2) + "s");
    if (io) io.observe(root);
    if (!reduce) { this.watchLoop(); this.idleLoop(); }
    var self = this;
    root.addEventListener("click", function () { if (!self.gone && !self.busy) self.crumble(); });
  }
  // turn and lean toward the pointer; duck away when it comes close
  Cookie.prototype.watchLoop = function () {
    var self = this;
    var tick = function () {
      requestAnimationFrame(tick);
      if (!visible(self.root) || self.gone) return;
      var r = self.root.getBoundingClientRect();
      var cx = r.left + r.width / 2, cy = r.top + r.height / 2;
      var dx = pointer.x - cx, dy = pointer.y - cy, d = Math.hypot(dx, dy);
      var near = pointer.seen && d < 420;
      var want = near ? clamp(dx / 30, -7, 7) : 0;
      self.lean += (want - self.lean) * .1;
      var dir = near && Math.abs(dx) > 30 ? (dx > 0 ? 1 : -1) : self.dir;
      if (dir !== self.dir && !self.busy) { self.dir = dir; self.turn(); }
      self.root.style.setProperty("--lean", self.lean.toFixed(2) + "deg");
      if (near && d < r.width * .75 && !self.busy) self.dodge(dx);
    };
    requestAnimationFrame(tick);
  };
  Cookie.prototype.turn = function () {
    this.root.style.setProperty("--dir", String(this.dir * this.face));
    anim(this.body, [{ transform: "scale(1,1)" }, { transform: "scale(.86,1.06)", offset: .5 }, { transform: "scale(1,1)" }], { duration: 220, easing: "ease-out" });
  };
  Cookie.prototype.dodge = async function (dx) {
    this.busy = true;
    var away = dx > 0 ? -1 : 1;
    await this.hop(away * 16, 22, 380);
    await sleep(700);
    await this.hop(-away * 16, 10, 420);
    this.busy = false;
  };
  // a hop: crouch (anticipation), stretch up, land with a squash, settle
  Cookie.prototype.hop = function (dx, h, ms) {
    var b = this.body, s = this.shadow, x0 = this._x || 0, x1 = x0 + (dx || 0);
    this._x = x1;
    var p = function (x, y, sx, sy) { return { transform: "translate(" + x + "px," + y + "px) scale(" + sx + "," + sy + ")" }; };
    anim(s, [{ transform: "translateX(" + x0 + "px) scale(1)", opacity: 1 }, { transform: "translateX(" + (x0 + x1) / 2 + "px) scale(.55)", opacity: .5, offset: .5 }, { transform: "translateX(" + x1 + "px) scale(1)", opacity: 1 }], { duration: ms, easing: "ease-in-out", fill: "forwards" });
    return anim(b, [
      p(x0, 0, 1, 1),
      p(x0, 3, 1.1, .88),
      p((x0 + x1) / 2, -h, .92, 1.08),
      p(x1, 2, 1.12, .86),
      p(x1, 0, .97, 1.03),
      p(x1, 0, 1, 1)
    ], { duration: ms, easing: "cubic-bezier(.3,.7,.4,1)", fill: "forwards" });
  };
  Cookie.prototype.wiggle = function () {
    return anim(this.body, [{ rotate: "0deg" }, { rotate: "-9deg" }, { rotate: "8deg" }, { rotate: "-5deg" }, { rotate: "0deg" }], { duration: 640, easing: "ease-in-out", composite: "add" });
  };
  Cookie.prototype.idleLoop = async function () {
    for (;;) {
      await sleep(rand(1800, 4200));
      if (!visible(this.root) || this.busy || this.gone) continue;
      var r = Math.random();
      if (this.mood === "gloat") { this.busy = true; await this.hop(0, 16, 460); await this.hop(0, 10, 380); this.busy = false; }
      else if (r < .45) await this.wiggle();
      else if (r < .8) { this.busy = true; await this.hop(0, 12, 420); this.busy = false; }
      else { this.busy = true; await this.hop(rand(-14, 14), 9, 420); this.busy = false; }
    }
  };
  Cookie.prototype.setMood = function (m) {
    this.mood = m || "";
    this.root.classList.toggle("gloat", m === "gloat");
    this.root.classList.toggle("scared", m === "scared");
  };
  // trembles (it knows), then cracks into pieces that fall away, crumbs too
  Cookie.prototype.crumble = async function (opts) {
    if (this.gone) return;
    opts = opts || {};
    this.busy = true; this.gone = true; this.setMood("scared");
    var self = this, root = this.root;
    if (!reduce) await anim(this.body, [{ translate: "0 0" }, { translate: "-3px 0" }, { translate: "3px 0" }, { translate: "-3px 0" }, { translate: "2px 0" }, { translate: "0 0" }], { duration: 300, composite: "add" });
    var r = this.body.getBoundingClientRect(), rr = root.getBoundingClientRect();
    var layer = document.createElement("span"); layer.className = "c-shards";
    layer.style.left = (r.left - rr.left) + "px"; layer.style.top = (r.top - rr.top) + "px";
    layer.style.width = r.width + "px"; layer.style.height = r.height + "px";
    var src = this.img.currentSrc || this.img.src;
    var fall = opts.fall || 140;
    SHARDS.forEach(function (poly, i) {
      var s = document.createElement("span"); s.className = "c-shard";
      s.style.backgroundImage = "url('" + src + "')";
      s.style.clipPath = "polygon(" + poly.split(",").map(function (pt) { var q = pt.trim().split(" "); return q[0] + "% " + q[1] + "%"; }).join(",") + ")";
      if (self.dir * self.face < 0) s.style.transform = "scaleX(-1)";
      layer.appendChild(s);
      var cx = i % 3 - 1, up = rand(18, 46);
      var dx = cx * rand(14, 34) + rand(-10, 10), rot = rand(-140, 140);
      var flip = s.style.transform || "";
      anim(s, [
        { transform: flip + " translate(0,0) rotate(0deg)", opacity: 1 },
        { transform: flip + " translate(" + dx * .4 + "px," + (-up) + "px) rotate(" + rot * .3 + "deg)", opacity: 1, offset: .25 },
        { transform: flip + " translate(" + dx + "px," + fall + "px) rotate(" + rot + "deg)", opacity: 0 }
      ], { duration: rand(820, 1100), easing: "cubic-bezier(.25,.1,.5,1)", fill: "forwards" });
    });
    for (var k = 0; k < 10; k++) {
      var c = document.createElement("i"); c.className = "c-crumb";
      c.style.left = rand(25, 75) + "%"; c.style.top = rand(30, 70) + "%";
      layer.appendChild(c);
      var cdx = rand(-60, 60), cup = rand(20, 60);
      anim(c, [
        { transform: "translate(0,0)", opacity: 1 },
        { transform: "translate(" + cdx * .5 + "px," + (-cup) + "px)", opacity: 1, offset: .3 },
        { transform: "translate(" + cdx + "px," + (fall * .8) + "px)", opacity: 0 }
      ], { duration: rand(700, 1000), easing: "cubic-bezier(.3,.1,.6,1)", fill: "forwards" });
    }
    root.appendChild(layer);
    this.body.style.visibility = "hidden"; this.shadow.style.opacity = "0";
    await sleep(1150);
    layer.remove();
    this.busy = false;
  };
  // hops back in from the side after a crumble
  Cookie.prototype.enter = async function (from) {
    if (!this.gone) return;
    this.busy = true;
    this.setMood("");
    var side = from || -1;
    this._x = side * 160;
    this.body.style.transform = "translate(" + this._x + "px,0)";
    this.body.style.visibility = ""; this.shadow.style.opacity = "";
    this.gone = false;
    if (reduce) { this._x = 0; this.body.style.transform = ""; this.busy = false; return; }
    await this.hop(-side * 60, 18, 420);
    await this.hop(-side * 55, 14, 400);
    await this.hop(-side * 45, 8, 360);
    this._x = 0; this.body.getAnimations().forEach(function (a) { a.cancel(); }); this.body.style.transform = "";
    this.shadow.getAnimations().forEach(function (a) { a.cancel(); });
    this.busy = false;
  };

  // ---- wire up --------------------------------------------------------------
  var kais = new Map(), cookies = new Map();
  document.querySelectorAll("[data-kai]").forEach(function (el) { kais.set(el, new Kai(el)); });
  document.querySelectorAll("[data-cookie]").forEach(function (el) { cookies.set(el, new Cookie(el)); });
  window.MoatLife = {
    kai: function (el) { return kais.get(el); },
    cookie: function (el) { return cookies.get(el); },
    reduce: reduce, sleep: sleep, rand: rand, visible: visible, pointer: pointer
  };
  document.dispatchEvent(new Event("moatlife"));
})();

/* Kai, front-facing, alive. One small engine for every Kai on the site.

   Layers (see src/styles/kai.css): antenna behind the head, the head image,
   and a live SVG face on the screen. Each frame composes:
     - idle life: a slow float, breathing, an antenna on a spring;
     - one action at a time (hop, nod, wave...), keyframed over 0..1;
     - the face: eyes are rounded squares shaped by eyelids (a top lid that
       can slant for sleepy, focused or sad, a bottom lid that pushes the eye
       into a ^ for happy), plus a three-bar mouth that smiles, talks,
       "types" while thinking and rounds into an o.
   The brain (opt-in, `auto: true`) decides what Kai does by itself: blinks,
   follows the pointer, looks at what you hover, leans with the scroll,
   fidgets when it's quiet, dozes off after a minute and wakes when you move.
   It never acts while you type, only runs while Kai is on screen and the tab
   is visible, and holds still for prefers-reduced-motion.

   Usage: const kai = new Kai(el, { auto: true });
          kai.setMood('happy', 1500); kai.do('hop'); kai.talk(1200);
          kai.think(true); kai.react('found' | 'miss' | 'hello' | 'joke');
          kai.pointAt(el) glances at el and leans the antenna toward it.

   How Kai moves (the character guide's motion rules): respond, don't
   perform; one beat per moment (wind-up, action, settle, under ~1.5 s);
   the eyes carry the feeling; never act while you type. */
(function () {
  'use strict';
  var NS = 'http://www.w3.org/2000/svg';
  var REDUCED = typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
  var PI = Math.PI;
  var clamp = function (v, a, b) { return v < a ? a : v > b ? b : v; };
  var lerp = function (a, b, t) { return a + (b - a) * t; };
  var rand = function (a, b) { return a + Math.random() * (b - a); };
  var pick = function (list) { return list[Math.floor(Math.random() * list.length)]; };
  var ease = function (t) { t = clamp(t, 0, 1); return t * t * (3 - 2 * t); };
  var easeOut = function (t) { t = clamp(t, 0, 1); return 1 - Math.pow(1 - t, 3); };
  // 0 -> 1 -> 0 over the action, with an eased hold in the middle
  var hold = function (p, inEnd, outStart) { return p < inEnd ? ease(p / inEnd) : p > outStart ? 1 - ease((p - outStart) / (1 - outStart)) : 1; };
  var bump = function (p, a, b) { return p <= a || p >= b ? 0 : Math.sin((p - a) / (b - a) * PI); };

  // Face geometry in SVG units: the head image is 1000 wide, 968.6 tall.
  var EYE = { w: 191, h: 189, r: 54, cy: 443, cx: [343, 655] };
  var MOUTH = { x: 367, y: 664, w: 72, h: 30, step: 100 };
  var SCREEN = { x: 65, y: 69, w: 869, h: 840, r: 150 };

  /* Moods: eye shape (open, top lid cover + slant, bottom lid rise, scale),
     where the eyes rest, and the mouth. Lid slant is in degrees: positive
     drops the inner corner (focused/annoyed), negative drops the outer
     corner (sad, sleepy). */
  var MOODS = {
    neutral:  { open: 1,    top: 0,   slant: 0,   bottom: 0,   scale: 1,    gy: 0,   mouth: 'flat' },
    happy:    { open: 1,    top: 0,   slant: 0,   bottom: .56, scale: 1.03, gy: -8,  mouth: 'smile' },
    joyful:   { open: 1,    top: .18, slant: 0,   bottom: .72, scale: 1.05, gy: -10, mouth: 'smile' },
    curious:  { open: 1.06, top: 0,   slant: 0,   bottom: 0,   scale: 1.1,  gy: -6,  mouth: 'flat', asym: .035 },
    thinking: { open: 1,    top: .08, slant: 0,   bottom: .1,  scale: .98,  gy: -40, gx: 36, mouth: 'dots', asym: -.025 },
    focused:  { open: 1,    top: .22, slant: 1.5, bottom: .12, scale: 1,    gy: 4,   mouth: 'flat' },
    surprised:{ open: 1.16, top: 0,   slant: 0,   bottom: 0,   scale: 1.18, gy: -6,  mouth: 'o' },
    scared:   { open: 1.1,  top: 0,   slant: -10, bottom: .1,  scale: .82,  gy: 0,   mouth: 'wobble' },
    sad:      { open: .92,  top: .28, slant: -16, bottom: 0,   scale: .96,  gy: 26,  mouth: 'frown' },
    shy:      { open: 1,    top: .08, slant: 0,   bottom: .42, scale: .98,  gy: 30, gx: -40, mouth: 'smile', blush: 1 },
    sleepy:   { open: .9,   top: .56, slant: -8,  bottom: .1,  scale: .98,  gy: 22,  mouth: 'flat', dim: 1 },
    asleep:   { open: .9,   top: .93, slant: -4,  bottom: .12, scale: .98,  gy: 26,  mouth: 'flat', dim: 1 },
    // chin up, eyes smiling: a milestone it's pleased about
    proud:    { open: 1,    top: .14, slant: 0,   bottom: .6,  scale: 1.04, gy: -16, mouth: 'smile' },
    // a squint with one eye smaller: something looks off
    suspicious:{ open: .96, top: .4,  slant: 5,   bottom: .2,  scale: .97,  gy: 2,  gx: 18, mouth: 'flat', asym: -.07 },
    // a soft sad slant and an unsteady mouth: something is actually wrong
    worried:  { open: 1.04, top: .24, slant: -14, bottom: .04, scale: .9,   gy: 14,  mouth: 'wobble', asym: .03 },
  };

  /* Actions: one-shot motions keyed over p in 0..1. Each returns body
     offsets (dy in fractions of Kai's width, negative is up; rot in deg;
     sx/sy squash), optional eye/mouth overrides and an antenna drive. */
  var ACTIONS = {
    blink:    { dur: 160, fn: function (p) { return { blink: bump(p, 0, 1) }; } },
    wink:     { dur: 520, fn: function (p) { return { winkR: hold(p, .25, .7), rot: 4 * hold(p, .25, .7), mood: 'happy' }; } },
    hop:      { dur: 640, kick: 14, fn: function (p) {
                var crouch = bump(p, 0, .22), air = bump(p, .18, .78), land = bump(p, .72, 1);
                return { dy: .02 * crouch - .13 * air + .015 * land, sx: 1 + .07 * crouch - .03 * air + .06 * land, sy: 1 - .09 * crouch + .05 * air - .07 * land };
              } },
    nod:      { dur: 760, fn: function (p) {
                var d = Math.sin(p * PI * 2) * (1 - p * .3);
                return { dy: .018 * Math.max(0, d), sy: 1 - .035 * Math.max(0, d), gy: 26 * Math.max(0, d), mood: 'happy' };
              } },
    shake:    { dur: 760, fn: function (p) { var s = Math.sin(p * PI * 5) * (1 - p); return { rot: 6 * s, gx: -40 * s }; } },
    tilt:     { dur: 1500, fn: function (p) { return { rot: 11 * hold(p, .25, .75), mood: 'curious' }; } },
    wave:     { dur: 1400, fn: function (p) { var h = hold(p, .12, .82); return { rot: 4 * Math.sin(p * PI * 4) * h, ant: 26 * Math.sin(p * PI * 6) * h, mood: 'happy' }; } },
    wiggle:   { dur: 760, fn: function (p) { var s = Math.sin(p * PI * 8) * (1 - p); return { rot: 4 * s, sx: 1 + .02 * Math.abs(s), ant: -12 * s }; } },
    stretch:  { dur: 1500, fn: function (p) {
                var up = hold(p, .3, .62), shake = p > .62 ? Math.sin((p - .62) * PI * 10) * (1 - p) * 2 : 0;
                return { sy: 1 + .08 * up, sx: 1 - .05 * up, dy: -.03 * up, rot: 3 * shake, top: .5 * up, bottom: .25 * up };
              } },
    yawn:     { dur: 1900, fn: function (p) {
                var y = hold(p, .35, .7);
                return { sy: 1 + .05 * y, dy: -.015 * y, top: .62 * y, slant: -10 * y, mouthO: y, gy: -20 * y };
              } },
    startle:  { dur: 720, kick: -22, emote: '!', fn: function (p) {
                var j = bump(p, 0, .5);
                return { dy: -.09 * j, sy: 1 + .06 * j, sx: 1 - .04 * j, mood: 'surprised' };
              } },
    celebrate:{ dur: 1500, kick: 18, emote: '✦', fn: function (p) {
                var a = bump(p, 0, .42), b = bump(p, .45, .85);
                return { dy: -.12 * a - .08 * b, sx: 1 - .03 * (a + b), sy: 1 + .05 * (a + b), ant: 20 * Math.sin(p * PI * 6) * (1 - p), mood: 'joyful' };
              } },
    lookAround:{ dur: 2600, fn: function (p) {
                var g = p < .4 ? -ease(p / .15) : p < .8 ? lerp(-1, 1, ease((p - .4) / .2)) : 1 - ease((p - .8) / .2);
                return { gx: 70 * g, rot: -2.5 * g };
              } },
    shy:      { dur: 1800, fn: function (p) { var h = hold(p, .2, .8); return { rot: -5 * h, dy: .01 * h, mood: 'shy' }; } },
    // a brief screen flicker: two dips in brightness and one small sideways
    // slip of the face, deterministic so it never strobes
    glitch:   { dur: 520, fn: function (p) {
                var dip = Math.max(bump(p, .1, .24), bump(p, .5, .62) * .7);
                return { faceAlpha: 1 - dip * .6, gx: 10 * bump(p, .12, .22) - 8 * bump(p, .52, .6) };
              } },
    dizzy:    { dur: 2200, emote: '?', fn: function (p) {
                var w = Math.sin(p * PI * 6) * (1 - p);
                return { rot: 7 * w, gx: 50 * Math.sin(p * PI * 8), gy: 30 * Math.cos(p * PI * 8), top: .2, mood: 'curious' };
              } },
    // "got it": one small quick dip
    nodSmall: { dur: 440, fn: function (p) { var d = bump(p, 0, 1); return { dy: .012 * d, sy: 1 - .025 * d, gy: 18 * d }; } },
    // "not sure": a lift, a tilt with eyes up to one side, the antenna droops
    shrug:    { dur: 1400, fn: function (p) {
                var lift = bump(p, 0, .3), h = hold(p, .2, .78);
                return { dy: -.02 * lift, sy: 1 + .03 * lift, rot: 7 * h, gx: 34 * h, gy: -26 * h, ant: -24 * h, mood: 'curious' };
              } },
    // dips out of sight a little and pops back up, pleased
    peek:     { dur: 1150, kick: 10, fn: function (p) {
                var down = hold(p, .25, .45), pop = bump(p, .45, .8);
                return { dy: .07 * down - .04 * pop, sy: 1 - .05 * down + .04 * pop, top: .3 * down, mood: p > .45 ? 'happy' : 'curious' };
              } },
    // looks at something (see pointAt) and leans its antenna toward it
    point:    { dur: 1150, fn: function (p, k) {
                var h = hold(p, .18, .78), d = (k && k.pointDir) || { x: 1, y: 0 };
                return { gx: 82 * d.x * h, gy: 52 * d.y * h, rot: 3.5 * d.x * h, ant: 24 * d.x * h, mood: 'curious' };
              } },
    // a breath out: sinks, eyes half close, then brightens
    relief:   { dur: 1500, fn: function (p) {
                var a = hold(p, .12, .55);
                return { top: .42 * a, sy: 1 - .05 * a, sx: 1 + .03 * a, dy: .016 * a, mouthO: .45 * bump(p, .06, .5), mood: p > .55 ? 'happy' : 'neutral' };
              } },
    // puffs up a little, chin up
    puff:     { dur: 1300, kick: -10, fn: function (p) { var h = hold(p, .22, .72); return { sx: 1 + .05 * h, sy: 1 + .05 * h, dy: -.02 * h, mood: 'proud' }; } },
    // waves toward the side, as if seeing someone off
    bye:      { dur: 1700, fn: function (p) {
                var h = hold(p, .12, .8);
                return { rot: -6 * h + 3 * Math.sin(p * PI * 5) * h, ant: 30 * Math.sin(p * PI * 6) * h, gx: -50 * h, mood: 'happy' };
              } },
    // closes one eye and looks away: "I won't watch there"
    lookAway: { dur: 1600, fn: function (p) { var h = hold(p, .2, .82); return { winkR: h, gx: -46 * h, gy: 8 * h, rot: -3 * h, mood: 'happy' }; } },
    // narrows the eyes at something
    squint:   { dur: 1700, fn: function (p) { var h = hold(p, .2, .8); return { gx: 26 * h, rot: 3 * h, mood: 'suspicious' }; } },
  };

  function el(tag, attrs, parent) {
    var n = document.createElementNS(NS, tag);
    for (var k in attrs) n.setAttribute(k, attrs[k]);
    if (parent) parent.appendChild(n);
    return n;
  }

  var uid = 0;
  function Kai(root, opts) {
    opts = opts || {};
    this.root = root;
    this.id = 'kai' + (++uid);
    this.lite = !!opts.lite;
    // calm: no float, breathing or sway, and no frames at all while Kai is
    // still. For busy app screens (Moat's Settings measured 7ms -> 28ms p95
    // frames with a looping float). Kai still blinks, glances and acts.
    this.calm = !!opts.calm;
    var src = opts.src || '/images/kai/';
    var size = opts.imgWidth || 320;
    root.classList.add('kai');
    if (this.lite) root.classList.add('lite');
    // built with DOM calls (no innerHTML), so it passes extension linters
    var div = function (cls) { var n = document.createElement('div'); n.className = cls; return n; };
    var img = function (cls, file) { var n = document.createElement('img'); n.className = cls; n.alt = ''; n.draggable = false; n.src = src + file + '.w' + size + '.webp'; return n; };
    var rig = div('kai-rig'), head = div('kai-head');
    head.appendChild(img('kai-body', 'kai-body'));
    rig.appendChild(img('kai-ant', 'kai-antenna'));
    rig.appendChild(head);
    root.replaceChildren(div('kai-shadow'), rig);
    if (!root.hasAttribute('aria-label')) { root.setAttribute('role', 'img'); root.setAttribute('aria-label', 'Kai, a small robot'); }
    this.rig = root.querySelector('.kai-rig');
    this.ant = root.querySelector('.kai-ant');
    this.shadow = root.querySelector('.kai-shadow');
    this.buildFace(root.querySelector('.kai-head'));

    // state
    this.mood = 'neutral'; this.moodUntil = 0; this.base = 'neutral';
    this.cur = Object.assign({ gx: 0, asym: 0 }, MOODS.neutral);      // eased eye/mouth params
    this.gaze = { x: 0, y: 0 }; this.gazeTarget = null;       // svg-unit offsets
    this.action = null; this.queue = [];
    this.antA = 0; this.antV = 0; this.lastRot = 0; this.lastRotV = 0;
    this.lean = 0; this.leanTarget = 0; this.squash = 0;
    this.talkUntil = 0; this.thinking = false; this.blinkT = -1;
    this.visible = true; this.t0 = performance.now();
    this.w = root.getBoundingClientRect().width || 160;

    var self = this;
    if ('ResizeObserver' in window) new ResizeObserver(function (e) { self.w = e[0].contentRect.width || self.w; }).observe(root);
    if ('IntersectionObserver' in window) new IntersectionObserver(function (e) { self.visible = e[0].isIntersecting; if (self.visible) self.start(); }, { rootMargin: '80px' }).observe(root);
    this.render(performance.now());
    if (!REDUCED) this.start();
    if (opts.auto) this.brain = new Brain(this, opts);
    else if (opts.blinks !== false && !REDUCED) {
      // no brain (a small Kai on a button): still blink now and then
      (function loop() {
        setTimeout(function () { if (self.visible && !document.hidden) self.blink(Math.random() < .2); loop(); }, rand(2500, 6500));
      })();
    }
    if (this.calm && !REDUCED) {
      // calm Kai glances around now and then instead of every frame
      (function glance() {
        setTimeout(function () {
          if (self.visible && !document.hidden && !self.gazeTarget) { self.sacc = { x: rand(-16, 16), y: rand(-9, 9) }; self.start(); }
          glance();
        }, rand(2600, 6200));
      })();
    }
  }

  Kai.prototype.buildFace = function (head) {
    var id = this.id;
    var svg = el('svg', { class: 'kai-face', viewBox: '0 0 1000 968.6', 'aria-hidden': 'true' });
    var defs = el('defs', {}, svg);
    var f = el('filter', { id: id + 'glow', x: '-50%', y: '-50%', width: '200%', height: '200%' }, defs);
    el('feGaussianBlur', { in: 'SourceGraphic', stdDeviation: '14', result: 'b' }, f);
    var m = el('feMerge', {}, f); el('feMergeNode', { in: 'b' }, m); el('feMergeNode', { in: 'SourceGraphic' }, m);
    // glass glare, clipped to the screen
    var clip = el('clipPath', { id: id + 'scr' }, defs);
    el('rect', { x: SCREEN.x, y: SCREEN.y, width: SCREEN.w, height: SCREEN.h, rx: SCREEN.r }, clip);
    // a soft diagonal sheen across the glass that slides as Kai moves
    var g = el('linearGradient', { id: id + 'glare', x1: '0', y1: '0', x2: '1', y2: '1' }, defs);
    el('stop', { offset: '0', 'stop-color': '#fff', 'stop-opacity': '0' }, g);
    el('stop', { offset: '.42', 'stop-color': '#fff', 'stop-opacity': '0' }, g);
    el('stop', { offset: '.5', 'stop-color': '#fff', 'stop-opacity': '.07' }, g);
    el('stop', { offset: '.58', 'stop-color': '#fff', 'stop-opacity': '0' }, g);
    var gc = el('g', { 'clip-path': 'url(#' + id + 'scr)' }, svg);
    this.glare = el('rect', { x: -200, y: -200, width: 900, height: 900, fill: 'url(#' + id + 'glare)' }, gc);

    // blush under the eyes (shy)
    this.blush = [0, 1].map(function (i) { return el('rect', { class: 'blush', x: EYE.cx[i] - 70, y: 585, width: 140, height: 34, rx: 17 }, svg); });

    // eyes: each a rounded rect masked by its lids, glowing as one shape
    var glowG = el('g', { class: 'glowing', filter: 'url(#' + id + 'glow)' }, svg);
    this.eyes = EYE.cx.map(function (cx, i) {
      var mask = el('mask', { id: id + 'lid' + i, maskUnits: 'userSpaceOnUse', x: 0, y: 0, width: 1000, height: 969 }, defs);
      el('rect', { x: 0, y: 0, width: 1000, height: 969, fill: '#fff' }, mask);
      var top = el('polygon', { fill: '#000' }, mask);
      var bot = el('ellipse', { fill: '#000' }, mask);
      var grp = el('g', { mask: 'url(#' + id + 'lid' + i + ')' }, glowG);
      var rect = el('rect', { class: 'eye' }, grp);
      return { rect: rect, top: top, bot: bot, side: i ? 1 : -1 };
    });
    // mouth: three bars
    this.bars = [0, 1, 2].map(function (i) { return el('rect', { class: 'bar', width: MOUTH.w, height: MOUTH.h, rx: MOUTH.h / 2 }, svg); });
    this.face = svg;
    head.appendChild(svg);
  };

  Kai.prototype.start = function () {
    if (this.running || REDUCED || typeof requestAnimationFrame !== 'function') return;
    this.running = true;
    var self = this;
    var tick = function (t) {
      if (!self.visible || document.hidden) { self.running = false; return; }
      self.render(t);
      if (self.calm && self.settled(t)) { self.running = false; return; }
      requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  };
  document.addEventListener('visibilitychange', function () {
    if (!document.hidden) document.querySelectorAll('.kai').forEach(function (n) { if (n._kai) n._kai.start(); });
  });

  Kai.prototype.setMood = function (m, ms) {
    if (!MOODS[m]) return;
    var self = this;
    if (ms) { this.mood = m; this.moodUntil = performance.now() + ms; setTimeout(function () { self.start(); }, ms + 30); }
    else { this.base = m; this.mood = m; this.moodUntil = 0; }
    this.start();
    if (REDUCED) this.render(performance.now(), true);
  };
  Kai.prototype.do = function (name) {
    var A = ACTIONS[name]; if (!A) return;
    if (REDUCED) { var mid = A.fn(.5, this) || {}; if (mid.mood) this.setMood(mid.mood, A.dur); return; }
    if (this.action && this.action.name !== 'blink') { if (this.queue.length < 2) this.queue.push(name); return; }
    this.action = { name: name, A: A, t0: performance.now() };
    if (A.kick) this.antV += A.kick;
    if (A.emote) this.emote(A.emote);
    this.start();
  };
  Kai.prototype.blink = function (double) {
    if (REDUCED) return;
    this.blinkT = performance.now();
    this.blinkDouble = !!double;
    this.start();
  };
  Kai.prototype.lookAt = function (target) { this.gazeTarget = target; this.start(); };
  /* Glance at an element (or {x, y}) and lean the antenna toward it, as a
     wind-up before something happens there ("Show me"). */
  Kai.prototype.pointAt = function (target) {
    var r = this.root.getBoundingClientRect(), cx = r.left + r.width / 2, cy = r.top + r.height / 2, px, py;
    if (target && target.getBoundingClientRect) { var b = target.getBoundingClientRect(); px = b.left + b.width / 2; py = b.top + b.height / 2; }
    else if (target) { px = target.x; py = target.y; }
    else { px = cx - 1; py = cy - 1; }
    var dx = px - cx, dy = py - cy, d = Math.hypot(dx, dy) || 1;
    this.pointDir = { x: dx / d, y: dy / d };
    this.do('point');
  };
  /* Nothing left to move: no action, blink, talk or thinking, and the eyes,
     face, lean and antenna have arrived. Only calm Kais stop on this. */
  Kai.prototype.settled = function (now) {
    return !this.action && !this.queue.length && this.blinkT < 0 && now > this.talkUntil && !this.thinking &&
      !(this.moodUntil && now > this.moodUntil) && this._motion < .5;
  };
  Kai.prototype.talk = function (ms) { this.talkUntil = performance.now() + (ms || 1200); this.start(); };
  Kai.prototype.think = function (on) {
    this.thinking = !!on;
    if (on) this.setMood('thinking', 60000); else if (this.mood === 'thinking') this.moodUntil = 1;
  };
  Kai.prototype.lightAntenna = function (ms) {
    var a = this.ant; a.classList.add('lit');
    clearTimeout(this._lit); this._lit = setTimeout(function () { a.classList.remove('lit'); }, ms || 1400);
  };
  /* What Kai does with a chat answer. */
  Kai.prototype.react = function (kind, replyLen) {
    this.think(false);
    var talkMs = Math.min(3200, 500 + (replyLen || 60) * 22);
    if (kind === 'found') { this.lightAntenna(); this.setMood('happy', talkMs + 800); this.do('nod'); this.talk(talkMs); }
    else if (kind === 'miss') { this.setMood('curious', talkMs + 600); this.do('shrug'); this.talk(talkMs); }
    else if (kind === 'hello') { this.setMood('happy', talkMs + 600); this.do('wave'); this.talk(talkMs); }
    else if (kind === 'joke') { this.do('wink'); this.talk(talkMs); }
    else this.talk(talkMs);
  };
  Kai.prototype.emote = function (text, small) {
    if (REDUCED) return;
    var n = document.createElement('span');
    n.className = 'kai-emote' + (small ? ' small' : '');
    n.textContent = text;
    this.root.appendChild(n);
    var dx = rand(14, 26) * (Math.random() < .5 ? -1 : 1);
    if (!n.animate) { n.remove(); return; }
    var a = n.animate([
      { transform: 'translate(-50%, 0) scale(.6)', opacity: 0 },
      { transform: 'translate(calc(-50% + ' + dx * .4 + 'cqw), -6cqw) scale(1)', opacity: 1, offset: .25 },
      { transform: 'translate(calc(-50% + ' + dx + 'cqw), -22cqw) scale(.9)', opacity: 0 }
    ], { duration: 1400, easing: 'ease-out' });
    a.onfinish = function () { n.remove(); };
  };

  /* One frame. */
  Kai.prototype.render = function (now, snap) {
    var t = (now - this.t0) / 1000;
    if (this.moodUntil && now > this.moodUntil) { this.mood = this.base; this.moodUntil = 0; }

    // action
    var o = {};
    if (this.action) {
      var p = (now - this.action.t0) / this.action.A.dur;
      if (p >= 1) { this.action = null; var next = this.queue.shift(); if (next) this.do(next); }
      else o = this.action.A.fn(p, this) || {};
    }
    var mood = MOODS[o.mood || this.mood] || MOODS.neutral;
    if (this._shown !== mood) {   // blush and dimming follow the mood on screen, set by an action or not
      this._shown = mood;
      this.root.classList.toggle('blushing', !!mood.blush);
      this.root.classList.toggle('dim', !!mood.dim);
    }

    // ease the face toward the mood (fast enough to read, slow enough to feel soft)
    var k = snap ? 1 : .16, c = this.cur;
    var moodGap = 0;
    ['open', 'top', 'slant', 'bottom', 'scale', 'gy', 'asym'].forEach(function (key) { moodGap += Math.abs((mood[key] || 0) - c[key]); c[key] = lerp(c[key], mood[key] || 0, k); });
    c.gx = lerp(c.gx || 0, mood.gx || 0, k);

    // gaze: an element, a point, or straight ahead with small saccades
    var gt = { x: 0, y: 0 };
    if (this.gazeTarget) {
      var r = this.root.getBoundingClientRect(), cx = r.left + r.width / 2, cy = r.top + r.height * .55, px, py;
      if (this.gazeTarget.getBoundingClientRect) { var b = this.gazeTarget.getBoundingClientRect(); px = b.left + b.width / 2; py = b.top + b.height / 2; }
      else { px = this.gazeTarget.x; py = this.gazeTarget.y; }
      var dx = px - cx, dy = py - cy, d = Math.hypot(dx, dy) || 1, reach = Math.min(1, d / 420);
      gt.x = dx / d * 78 * reach; gt.y = dy / d * 52 * reach;
    } else {
      if (!this.calm && (!this.sacc || now > this.saccAt)) { this.sacc = { x: rand(-14, 14), y: rand(-8, 8) }; this.saccAt = now + rand(700, 2400); }
      gt = this.sacc || { x: 0, y: 0 };
    }
    var gk = snap ? 1 : .12;
    this.gaze.x = lerp(this.gaze.x, gt.x, gk); this.gaze.y = lerp(this.gaze.y, gt.y, gk);
    var gx = clamp(this.gaze.x + c.gx + (o.gx || 0), -95, 95), gy = clamp(this.gaze.y + c.gy + (o.gy || 0), -70, 70);

    // blink (with an occasional second one)
    var blink = o.blink || 0;
    if (this.blinkT > 0) {
      var bt = now - this.blinkT, bl = 150;
      if (bt < bl) blink = Math.max(blink, Math.sin(bt / bl * PI));
      else if (this.blinkDouble && bt > bl + 90 && bt < bl * 2 + 90) blink = Math.max(blink, Math.sin((bt - bl - 90) / bl * PI));
      else if (bt > (this.blinkDouble ? bl * 2 + 100 : bl)) this.blinkT = -1;
    }

    // idle body life
    var still = REDUCED || snap || this.calm;
    var float = still ? 0 : Math.sin(t * PI * 2 / 4.2) * .014;
    var breathe = still ? 0 : Math.sin(t * PI * 2 / 3.1) * .011;
    this.lean = lerp(this.lean, this.leanTarget, .08);
    this.squash = lerp(this.squash, 0, .1);
    var rot = (o.rot || 0) + this.lean + (still ? 0 : Math.sin(t * PI * 2 / 7.3) * .8);
    var dyW = (o.dy || 0) + float;
    var sx = (o.sx || 1) * (1 - breathe * .5) * (1 + this.squash * .5), sy = (o.sy || 1) * (1 + breathe) * (1 - this.squash);
    this.rig.style.transform = 'translateY(' + (dyW * this.w).toFixed(2) + 'px) rotate(' + rot.toFixed(2) + 'deg) scale(' + sx.toFixed(4) + ',' + sy.toFixed(4) + ')';
    var lift = clamp(-dyW / .14, -.2, 1);
    this.shadow.style.transform = 'translateX(' + (rot * .6).toFixed(2) + 'cqw) scale(' + (1 - lift * .35).toFixed(3) + ')';
    this.shadow.style.opacity = (1 - lift * .5).toFixed(3);

    // antenna: a damped spring driven by the head's turning, plus actions
    var rotV = rot - this.lastRot, rotA = rotV - this.lastRotV;
    this.lastRot = rot; this.lastRotV = rotV;
    if (!REDUCED && !snap) {
      var target = (o.ant || 0) + (this.calm ? 0 : Math.sin(t * PI * 2 / 5.1) * 1.5);
      this.antV += (target - this.antA) * .09 - this.antV * .12 - rotA * 2.2 - (o.dy ? (o.dy - (this._lastDy || 0)) * 160 : 0);
      this._lastDy = o.dy || 0;
      this.antA = clamp(this.antA + this.antV, -38, 38);
    }
    this.ant.style.transform = 'rotate(' + this.antA.toFixed(2) + 'deg)';
    this._motion = Math.abs(gt.x - this.gaze.x) + Math.abs(gt.y - this.gaze.y) + moodGap * 20 + Math.abs(this.lean - this.leanTarget) * 4 + Math.abs(this.antA) + Math.abs(this.antV) * 10 + this.squash * 40;

    // glare slides opposite the lean, like light on curved glass
    this.glare.setAttribute('x', (-200 - rot * 14 - gx * .5).toFixed(1));
    this.glare.setAttribute('y', (-200 + dyW * 500).toFixed(1));

    // eyes
    var winkR = o.winkR || 0;
    var top = clamp(c.top + (o.top || 0), 0, 1), slant = c.slant + (o.slant || 0);
    for (var i = 0; i < 2; i++) {
      var e = this.eyes[i], side = e.side;
      // curious: the right eye opens wider; thinking: the left one, a little
      // eyes stay the same size whatever Kai looks at; only curious (right
      // eye) and thinking (left eye) open one eye a few percent wider, eased
      var asym = 1 + side * c.asym;
      var w = EYE.w * c.scale * asym, h = EYE.h * c.scale * asym * c.open;
      var close = blink;     // a wink closes into a ^ (bottom lid), not a flat line
      var ex = EYE.cx[i] + gx, ey = EYE.cy + gy;
      var x0 = ex - w / 2, y0 = ey - h / 2;
      e.rect.setAttribute('x', x0.toFixed(1)); e.rect.setAttribute('y', y0.toFixed(1));
      e.rect.setAttribute('width', w.toFixed(1)); e.rect.setAttribute('height', h.toFixed(1));
      e.rect.setAttribute('rx', Math.min(EYE.r * c.scale, w / 2, h / 2).toFixed(1));
      // top lid: a slanted edge coming down; a blink brings it to the bottom lid
      var cover = clamp(top + (1 - top) * close * .97, 0, 1);
      var edge = y0 + h * cover - 2;
      // positive slant drops the inner corner (nearest the nose), negative the outer
      var d = Math.tan(slant * PI / 180) * (w / 2 + 40);
      var L = x0 - 40, R = x0 + w + 40;
      var edgeL = side < 0 ? edge - d : edge + d, edgeR = side < 0 ? edge + d : edge - d;
      e.top.setAttribute('points', L + ',' + (y0 - 160) + ' ' + R + ',' + (y0 - 160) + ' ' + R + ',' + edgeR.toFixed(1) + ' ' + L + ',' + edgeL.toFixed(1));
      // bottom lid: an ellipse rising from below makes the happy ^
      var bottom = clamp(c.bottom + (o.bottom || 0), 0, 1);
      if (side > 0 && winkR) bottom = lerp(bottom, .84, winkR);
      var ry = h * .78, rx = w * .8;
      e.bot.setAttribute('cx', ex.toFixed(1)); e.bot.setAttribute('rx', rx.toFixed(1)); e.bot.setAttribute('ry', ry.toFixed(1));
      e.bot.setAttribute('cy', (y0 + h + ry + 6 - bottom * h * .92).toFixed(1));
    }
    if (o.faceAlpha != null) this.face.style.opacity = o.faceAlpha; else if (this.face.style.opacity) this.face.style.opacity = '';

    // mouth
    var talking = now < this.talkUntil, mode = (o.mouthO ? 'o' : null) || (talking ? 'talk' : null) || (this.thinking ? 'dots' : null) || mood.mouth;
    var mx = MOUTH.x + gx * .55, my = MOUTH.y + gy * .45;
    for (var j = 0; j < 3; j++) {
      var bar = this.bars[j], bw = MOUTH.w, bh = MOUTH.h, bx = mx + j * MOUTH.step, by = my, op = 1;
      if (mode === 'smile') by += j === 1 ? 14 : -8;
      else if (mode === 'frown') by += j === 1 ? -10 : 8;
      else if (mode === 'talk') { var s = .6 + Math.abs(Math.sin(now / 95 + j * 1.7)) * 1.9; bh = MOUTH.h * s; by -= (bh - MOUTH.h) / 2; }
      else if (mode === 'dots') { var wave = Math.max(0, Math.sin(now / 160 - j * 1.1)); bw = bh = 40; bx += (MOUTH.w - bw) / 2; by -= 5 + wave * 20; op = .5 + wave * .5; }
      else if (mode === 'wobble') by += Math.sin(now / 70 + j * 2) * 5;
      else if (mode === 'o') {
        var amt = o.mouthO != null ? o.mouthO : 1;
        if (j !== 1) { op = 1 - amt; } else { bw = lerp(MOUTH.w, 74, amt); bh = lerp(MOUTH.h, 74, amt); bx = mx + MOUTH.step + (MOUTH.w - bw) / 2; by = my - (bh - MOUTH.h) / 2; }
      }
      bar.setAttribute('x', bx.toFixed(1)); bar.setAttribute('y', by.toFixed(1));
      bar.setAttribute('width', bw.toFixed(1)); bar.setAttribute('height', bh.toFixed(1));
      bar.setAttribute('rx', (Math.min(bw, bh) / 2).toFixed(1));
      bar.style.opacity = op;
    }
  };

  /* ---------------------------------------------------------------------
     Brain: what Kai does on its own. */
  function Brain(kai, opts) {
    this.kai = kai;
    this.lastInput = performance.now();
    this.typing = false;
    this.hidAt = 0;
    var self = this, root = kai.root;
    var pointer = null, lastMove = 0, reversals = [], lastDir = 0;
    this.sleepAfter = opts.sleepAfter || 60000;

    var wake = function () {
      var was = kai.base;
      self.lastInput = performance.now();
      if (self.dozing && (was === 'asleep' || was === 'sleepy')) {
        self.dozing = false;
        kai.setMood('neutral');
        if (was === 'asleep') { kai.do('startle'); kai.do('stretch'); }
        else kai.blink(true);
      }
    };
    addEventListener('pointermove', function (e) {
      var now = performance.now();
      pointer = { x: e.clientX, y: e.clientY };
      // shake detection near Kai: many direction flips in a short time
      var r = root.getBoundingClientRect(), near = Math.hypot(e.clientX - (r.left + r.width / 2), e.clientY - (r.top + r.height / 2)) < Math.max(160, r.width * .9);
      var dir = Math.abs(e.movementX || 0) > 6 ? Math.sign(e.movementX) : 0;
      if (near && dir && lastDir && dir !== lastDir) { reversals.push(now); reversals = reversals.filter(function (x) { return now - x < 600; }); if (reversals.length >= 6) { reversals = []; kai.setMood('scared', 1600); kai.do('startle'); } }
      if (dir) lastDir = dir;
      lastMove = now;
      if (!self.focusEl) kai.lookAt(pointer);
      wake();
    }, { passive: true });
    addEventListener('pointerdown', wake, { passive: true });
    addEventListener('keydown', function () { wake(); }, { passive: true });

    var lastY = scrollY, lastScrollT = performance.now();
    addEventListener('scroll', function () {
      var now = performance.now(), dy = scrollY - lastY, dt = Math.max(16, now - lastScrollT);
      lastY = scrollY; lastScrollT = now;
      var v = clamp(dy / dt, -4, 4);
      kai.leanTarget = clamp(-v * 2.4, -6, 6);
      kai.squash = clamp(Math.abs(v) * .02, 0, .05);
      clearTimeout(self._settle);
      self._settle = setTimeout(function () { kai.leanTarget = 0; }, 140);
      wake();
    }, { passive: true });

    // look at what you hover (links, buttons, anything marked data-kai-look)
    document.addEventListener('pointerover', function (e) {
      var t = e.target.closest && e.target.closest('a, button, [data-kai-look]');
      if (!t || root.contains(t)) return;
      self.focusEl = t; kai.lookAt(t);
    });
    document.addEventListener('pointerout', function (e) {
      if (self.focusEl && (!e.relatedTarget || !self.focusEl.contains(e.relatedTarget))) { self.focusEl = null; if (pointer) kai.lookAt(pointer); }
    });
    // typing in Kai's chat: focus, and never fidget meanwhile
    document.addEventListener('focusin', function (e) {
      if (e.target.matches && e.target.matches('input, textarea')) { self.typing = true; self.focusEl = e.target; kai.lookAt(e.target); kai.setMood('focused', 2500); }
    });
    document.addEventListener('focusout', function (e) { if (e.target.matches && e.target.matches('input, textarea')) { self.typing = false; self.focusEl = null; } });

    // poke Kai
    var clicks = [];
    root.addEventListener('click', function () {
      var now = performance.now();
      clicks = clicks.filter(function (x) { return now - x < 2200; }); clicks.push(now);
      if (clicks.length >= 5) { clicks = []; kai.do('dizzy'); return; }
      pick([function () { kai.do('wink'); }, function () { kai.do('hop'); kai.setMood('happy', 1400); }, function () { kai.do('shy'); }, function () { kai.do('wiggle'); kai.emote('♥', true); }])();
    });
    root.addEventListener('pointerenter', function () { if (!kai.action && Math.random() < .5) kai.setMood('happy', 1200); });

    // coming back to the tab: look at you, a small hop
    document.addEventListener('visibilitychange', function () {
      if (document.hidden) { self.hidAt = performance.now(); return; }
      if (self.hidAt && performance.now() - self.hidAt > 5000) {
        kai.lookAt(null); kai.setMood('happy', 1800);
        setTimeout(function () { kai.do('hop'); }, 250);
      }
      self.lastInput = performance.now();
    });

    // the slow loop: blinks, fidgets, getting sleepy, looking back at you
    var night = function () { var h = new Date().getHours(); return h >= 23 || h < 6; };
    var nextBlink = performance.now() + rand(1500, 4000);
    var nextFidget = performance.now() + rand(16000, 30000);
    setInterval(function () {
      if (document.hidden || !kai.visible || REDUCED) return;
      var now = performance.now(), idle = now - self.lastInput, sleepAt = night() ? self.sleepAfter * .5 : self.sleepAfter;
      if (now > nextBlink && kai.base !== 'asleep') { kai.blink(Math.random() < .22); nextBlink = now + rand(2000, 6000); }
      if (self.dozing && kai.base === 'sleepy' && idle > sleepAt * 1.35) { kai.setMood('asleep'); }
      else if (kai.base === 'neutral' && idle > sleepAt) { self.dozing = true; kai.setMood('sleepy'); kai.do('yawn'); }
      if (kai.base === 'asleep' && Math.random() < .12) kai.emote('z', true);
      // the pointer has been still a while: look back at the visitor
      if (pointer && now - lastMove > 3500 && !self.focusEl && kai.gazeTarget) { kai.lookAt(null); if (Math.random() < .5) kai.blink(); }
      if (now > nextFidget && !self.typing && !kai.action && kai.base === 'neutral' && !kai.thinking && now >= kai.talkUntil) {
        kai.do(pick(['lookAround', 'tilt', 'wiggle', 'stretch', 'lookAround', 'blink']));
        nextFidget = now + rand(20000, 40000);
      }
    }, 250);
  }

  Kai.MOODS = Object.keys(MOODS);
  Kai.ACTIONS = Object.keys(ACTIONS);
  var Base = Kai;
  window.Kai = function (root, opts) { var k = new Base(root, opts); root._kai = k; return k; };
  window.Kai.MOODS = Kai.MOODS; window.Kai.ACTIONS = Kai.ACTIONS;
})();

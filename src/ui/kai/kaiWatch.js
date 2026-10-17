/* Kai's watcher: when the bubble above Kai shows, and what it says.

   "Ask Kai" greets you for a few seconds, then folds away: the full hello
   at most once a day, a short "Welcome back." on a later day, and nothing
   when you come back the same day.
   Kai stays in the corner. The bubble comes back only when you look stuck,
   using the signals session-replay tools call frustration signals:
     stuck   3 clicks on one spot within a second (a rage click), or two
             clicks on things that look clickable but do nothing (dead clicks)
     looking going back and forth between the same two screens, hopping
             through screens fast, or scrolling up and down / hovering
             controls without clicking for half a minute
     unsure  flipping the same switch on and off
   Limits, so Kai never turns into Clippy: one nudge per screen, a minute
   between nudges, three per visit, never in the first seconds, while you
   type or while the chat is open, and quiet for the visit once two nudges
   go ignored. After you've opened the chat Kai waits twice as long.

   Shared by the portfolio, Moat and Cluster as identical copies. Edit the
   portfolio's public/scripts/kai-watch.js, then copy it to Moat's
   src/ui/kai/kaiWatch.js and Cluster's src/dashboard/kai/kaiWatch.js.

   Usage:
     var w = KaiWatch({
       win,                       // window to watch (omit in tests)
       kaiEl,                     // Kai's corner: nothing inside it counts
       show(kind, text), hide(),  // draw / fold the bubble
       isOpen(),                  // is the chat open
       text: { welcome, stuck, looking, unsure, named }, // named has {name}
       sectionName(id),           // optional: a screen's name for the text
       storageKey, limits, now    // optional
     });
     w.welcome(text?, ms?)   once a day (returns 'welcome', 'back' or false)
     w.say(text, ms?)        a short line after something you did (not a nudge)
     w.section(id, t?)       the screen changed (t replays an earlier visit)
     w.opened()              the chat was opened
   kind passed to show is 'welcome' | 'back' | 'say' | 'stuck' | 'looking' |
   'unsure'. Only the last three are nudges (counted, and ignorable). */
(function (global) {
  'use strict';

  var LIMITS = {
    welcomeMs: 8000, showMs: 7000, graceMs: 1500,
    gapMs: 60000, firstGapMs: 12000, perSession: 3, quietAfterIgnored: 2,
    helloEveryMs: 20 * 3600000, sayMs: 3200,
    rageClicks: 3, rageMs: 1000, ragePx: 30,
    deadClicks: 2, deadMs: 8000, deadWaitMs: 700,
    loopMs: 20000, hopCount: 5, hopMs: 30000,
    flips: 3, flipMs: 15000,
    huntMs: 30000, reversals: 4, hesitations: 3, hesitateMs: 1200, scrollRun: 200,
    typingMs: 3000
  };
  var TEXT = {
    welcome: 'Ask Kai',
    back: 'Welcome back.',
    stuck: 'Hmm. Want me to take a look?',
    looking: 'Looking for something? I know my way around.',
    unsure: 'Not sure what that does? I can explain.',
    named: 'Need a hand with {name}?'
  };
  var INTERACTIVE = 'a[href], button, input, select, textarea, label, summary, [role="button"], [role="switch"], [role="tab"], [role="link"], [role="menuitem"], [role="checkbox"], [role="option"], [contenteditable=""], [contenteditable="true"], [onclick]';
  var NUDGE = { stuck: 1, looking: 1, unsure: 1 };
  var STEPPERS = 'input, select, textarea, [role="spinbutton"], [role="slider"], [contenteditable=""], [contenteditable="true"]';

  function KaiWatch(opts) {
    opts = opts || {};
    var L = merge(LIMITS, opts.limits), T = merge(TEXT, opts.text);
    var now = opts.now || function () { return Date.now(); };
    var win = opts.win || null;
    var key = opts.storageKey || 'kai-watch';

    // per visit (session storage): nudges shown, ignored in a row, chat opened
    var S = load();
    function load() {
      try { var s = JSON.parse(win.sessionStorage.getItem(key)); if (s && typeof s.n === 'number') return s; } catch (e) {}
      return { n: 0, ignored: 0, opened: false, last: 0, welcomed: false };
    }
    function save() { try { win.sessionStorage.setItem(key, JSON.stringify(S)); } catch (e) {} }
    // when the hello was last said, across visits (local storage)
    function lastHello() { try { return +win.localStorage.getItem(key + '-hello') || 0; } catch (e) { return 0; } }
    function saidHello() { try { win.localStorage.setItem(key + '-hello', String(now())); } catch (e) {} }

    var started = now();
    var showing = null, hideTimer = 0, retryTimer = 0, shownAt = 0, shownFor = 0;
    var stopped = false, lastKey = -1e9, lastAct = -1e9;
    var clicks = [], dead = [], sections = [], flips = {}, nudged = {};
    var reversals = [], hesitations = [], scrolls = [];
    var current = null;

    function typing() {
      if (now() - lastKey < L.typingMs) return true;
      var a = win && win.document && win.document.activeElement;
      return !!(a && a.matches && a.matches('input:not([type="checkbox"]):not([type="radio"]):not([type="range"]):not([type="button"]):not([type="submit"]), textarea, [contenteditable=""], [contenteditable="true"]'));
    }
    // 'ok', 'later' (only too early: try again when allowed) or 'no'
    function verdict() {
      if (stopped || (opts.isOpen && opts.isOpen())) return 'no';
      if (win && win.document && win.document.hidden) return 'no';
      if (S.ignored >= L.quietAfterIgnored || S.n >= L.perSession) return 'no';
      if (current != null && nudged[current]) return 'no';
      var t = now(), gap = S.opened ? L.gapMs * 2 : L.gapMs;
      if (S.last && t - S.last < gap) return 'no';
      if (typing() || (showing && NUDGE[showing])) return 'no';
      if (t - started < L.firstGapMs || showing) return 'later';
      return 'ok';
    }
    function textFor(kind) {
      var name = current != null && opts.sectionName ? opts.sectionName(current) : '';
      if (name && kind !== 'stuck') return T.named.replace('{name}', name);
      return T[kind];
    }
    function nudge(kind) {
      var v = verdict();
      if (v === 'later') {
        clearTimeout(retryTimer);
        var wait = Math.max(started + L.firstGapMs - now(), showing ? shownFor - (now() - shownAt) : 0, 0) + 50;
        retryTimer = setTimeout(function () { if (verdict() === 'ok') go(kind); }, wait);
        return true;
      }
      if (v !== 'ok') return false;
      go(kind);
      return true;
    }
    function go(kind) {
      S.n++; S.last = now(); save();
      if (current != null) nudged[current] = true;
      put(kind, textFor(kind), L.showMs);
    }
    function put(kind, text, ms) {
      clearTimeout(hideTimer);
      showing = kind; shownAt = now(); shownFor = ms;
      if (opts.show) opts.show(kind, text);
      hideTimer = setTimeout(function () { fold(!!NUDGE[kind]); }, ms);
    }
    // fold the bubble; a nudge that folds without being taken was ignored
    function fold(ignored) {
      clearTimeout(hideTimer);
      if (!showing) return;
      showing = null;
      if (ignored) { S.ignored++; save(); }
      if (opts.hide) opts.hide();
    }
    function within(list, ms) { var t = now(); return list.filter(function (x) { return t - (typeof x === 'number' ? x : x.t) < ms; }); }
    // a click elsewhere: the welcome folds at once, a nudge after a moment
    function acted() {
      lastAct = now(); reversals = []; hesitations = [];
      if (showing && !NUDGE[showing]) { if (now() - shownAt > 300) fold(false); }
      else if (showing && now() - shownAt > L.graceMs) fold(true);
    }
    // scrolling up and down or hovering without clicking, for half a minute
    function hunt() {
      var since = Math.max(lastAct, now() - L.huntMs);
      reversals = reversals.filter(function (x) { return x > since; });
      hesitations = hesitations.filter(function (x) { return x > since; });
      if (reversals.length >= L.reversals || hesitations.length >= L.hesitations) {
        if (nudge('looking')) { reversals = []; hesitations = []; }
      }
    }

    var api = {
      welcome: function (text, ms) {
        if (stopped || S.welcomed || (opts.isOpen && opts.isOpen())) return false;
        S.welcomed = true; save();
        var last = lastHello();
        if (last && now() - last < L.helloEveryMs) return false;
        saidHello();
        if (last) { put('back', T.back, Math.min(ms || L.welcomeMs, 4000)); return 'back'; }
        put('welcome', text || T.welcome, ms || L.welcomeMs);
        return 'welcome';
      },
      /* A short line after something the person did ("Back on guard."). Not
         a nudge: never counted or ignored, but never over a nudge either. */
      say: function (text, ms) {
        if (stopped || !text || (opts.isOpen && opts.isOpen())) return false;
        if (showing && NUDGE[showing]) return false;
        put('say', text, ms || L.sayMs);
        return true;
      },
      /* A pointer click at x, y (not inside Kai). */
      click: function (x, y) {
        acted();
        var t = now();
        clicks = within(clicks, L.rageMs);
        clicks.push({ t: t, x: x, y: y });
        var near = clicks.filter(function (c) { return Math.hypot(c.x - x, c.y - y) <= L.ragePx; });
        if (near.length >= L.rageClicks) { clicks = []; nudge('stuck'); }
      },
      /* A click on something that looks clickable did nothing. */
      dead: function () {
        dead = within(dead, L.deadMs); dead.push(now());
        if (dead.length >= L.deadClicks) { dead = []; nudge('stuck'); }
      },
      section: function (id, t) {
        var live = t == null;
        t = live ? now() : t;
        if (live) { current = id; reversals = []; hesitations = []; }
        var prev = sections.length ? sections[sections.length - 1].id : null;
        if (prev === id) return;
        sections.push({ id: id, t: t });
        sections = within(sections, Math.max(L.loopMs, L.hopMs));
        var loop = within(sections, L.loopMs).slice(-4), ids = {};
        loop.forEach(function (s) { ids[s.id] = 1; });
        if (live && ((loop.length === 4 && Object.keys(ids).length === 2) || within(sections, L.hopMs).length >= L.hopCount)) {
          if (nudge('looking')) sections = [];
        }
      },
      /* A switch or checkbox changed; k names which one. */
      flip: function (k) {
        lastAct = now();
        flips[k] = within(flips[k] || [], L.flipMs);
        flips[k].push(now());
        if (flips[k].length >= L.flips) { flips[k] = []; nudge('unsure'); }
      },
      /* Scroll position y of a scroller (pane names it, default the page). */
      scroll: function (y, pane) {
        var s = null;
        for (var i = 0; i < scrolls.length; i++) if (scrolls[i].pane === pane) s = scrolls[i];
        if (!s) { scrolls.push(s = { pane: pane, y: y, dir: 0, run: 0 }); return; }
        var dy = y - s.y; s.y = y;
        if (!dy) return;
        var dir = dy > 0 ? 1 : -1;
        if (dir === s.dir) { s.run += Math.abs(dy); return; }
        if (s.dir && s.run >= L.scrollRun) { reversals.push(now()); hunt(); }
        s.dir = dir; s.run = Math.abs(dy);
      },
      /* Hovered a control a while and left it without clicking. */
      hesitated: function () { hesitations.push(now()); hunt(); },
      key: function () { lastKey = now(); lastAct = lastKey; },
      opened: function () { clearTimeout(retryTimer); fold(false); S.opened = true; S.ignored = 0; save(); },
      isShowing: function () { return showing; },
      fold: function () { fold(false); },
      stop: function () { stopped = true; clearTimeout(retryTimer); fold(false); },
      state: function () { return { n: S.n, ignored: S.ignored, opened: S.opened, welcomed: S.welcomed, showing: showing }; }
    };

    if (win && win.document) attach(win, api, opts.kaiEl, L);
    return api;
  }

  /* Wire a page's events to the watcher. Only the person's own input
     counts (isTrusted): clicks a script fires are not struggle. */
  function attach(win, api, kaiEl, L) {
    var doc = win.document;
    var mine = function (el) { return !!(kaiEl && el && el.nodeType && kaiEl.contains(el)); };
    doc.addEventListener('click', function (e) {
      var t = e.target;
      if (!e.isTrusted || mine(t) || e.detail === 0) return; // keyboard "clicks" aren't struggle
      var sel = win.getSelection && String(win.getSelection() || '');
      // tapping a stepper fast or triple-clicking to select text is on purpose
      if (!sel && !(t.closest && t.closest(STEPPERS))) api.click(e.clientX, e.clientY);
      else api.click(-1e6, -1e6);
      var s = t.closest && t.closest('[role="switch"], [aria-pressed]');
      if (s) api.flip(s.id || cssPath(s));
      if (!sel && looksClickable(t) && !(t.closest && t.closest(INTERACTIVE))) checkDead();
    }, true);
    // a dead click: nothing on the page changed, no navigation, no scroll
    // (one check at a time)
    var checking = false;
    function checkDead() {
      if (!win.MutationObserver || checking) return;
      checking = true;
      var href = win.location.href, y = win.scrollY, changed = false;
      var mo = new win.MutationObserver(function (list) {
        for (var i = 0; i < list.length; i++) if (!mine(list[i].target)) { changed = true; mo.disconnect(); return; }
      });
      mo.observe(doc.documentElement, { subtree: true, childList: true, characterData: true, attributes: true, attributeFilter: ['class', 'hidden', 'open', 'aria-expanded', 'aria-selected', 'aria-checked', 'aria-pressed'] });
      setTimeout(function () {
        mo.disconnect();
        checking = false;
        if (!changed && win.location.href === href && win.scrollY === y && !doc.hidden) api.dead();
      }, L.deadWaitMs);
    }
    function looksClickable(el) {
      try { return el.nodeType === 1 && win.getComputedStyle(el).cursor === 'pointer'; } catch (e) { return false; }
    }
    doc.addEventListener('keydown', function (e) { if (e.isTrusted) api.key(); }, true);
    doc.addEventListener('change', function (e) {
      var t = e.target;
      if (!e.isTrusted || !t || mine(t) || !t.matches || !t.matches('input[type="checkbox"], input[type="radio"], select')) return;
      api.flip(t.id || t.name || cssPath(t));
    }, true);
    var ticking = false, last = null;
    win.addEventListener('scroll', function (e) {
      last = e.target && e.target.nodeType === 1 ? e.target : null;
      if (ticking) return;
      ticking = true;
      win.requestAnimationFrame(function () {
        ticking = false;
        if (last && mine(last)) return;
        if (last) api.scroll(last.scrollTop, last); else api.scroll(win.scrollY, null);
      });
    }, { passive: true, capture: true });
    // hovering a control a while, then leaving without a click
    var over = null, overAt = 0, pressed = false;
    doc.addEventListener('pointerover', function (e) {
      if (!e.isTrusted) return;
      if (e.pointerType && e.pointerType !== 'mouse') return;
      var c = e.target && e.target.closest && e.target.closest('a[href], button, [role="button"], [role="tab"], select, summary');
      if (c && mine(c)) c = null;
      if (c === over) return;
      if (over && !pressed && Date.now() - overAt >= L.hesitateMs) api.hesitated();
      over = c; overAt = Date.now(); pressed = false;
    }, true);
    doc.addEventListener('pointerdown', function () { pressed = true; }, true);
  }
  function cssPath(el) {
    var parts = [];
    for (var n = el; n && n.nodeType === 1 && parts.length < 4; n = n.parentElement) {
      var i = 1;
      for (var s = n.previousElementSibling; s; s = s.previousElementSibling) i++;
      parts.unshift(n.tagName + ':' + i);
    }
    return parts.join('>');
  }
  function merge(a, b) {
    var o = {}, k;
    for (k in a) o[k] = a[k];
    for (k in (b || {})) if (b[k] != null && b[k] !== '') o[k] = b[k];
    return o;
  }

  KaiWatch.LIMITS = LIMITS;
  global.KaiWatch = KaiWatch;
})(typeof window !== 'undefined' ? window : globalThis);

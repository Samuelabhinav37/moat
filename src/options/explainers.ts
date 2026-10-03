// "How it works" scenes for the Settings page: one small looping picture
// per setting, drawn as inline SVG and animated by the ex-* keyframes in
// options.html. They use the page's own colours, carry no words beyond
// example hostnames (the step line under each one, in explainerPanel.ts,
// is translated), and hold still under prefers-reduced-motion. Whatever
// Moat acts on (the ad, the tracker, the banner) is drawn in amber. A
// row's "How it works" button shows its scene in the side panel on wide
// screens, or inline on narrower ones. Built with createElementNS, never innerHTML (web-ext lint).

const SVG_NS = "http://www.w3.org/2000/svg";

type Attrs = Record<string, string | number>;
type Child = SVGElement | string;

function h(tag: string, attrs: Attrs = {}, ...children: Child[]): SVGElement {
  const node = document.createElementNS(SVG_NS, tag) as SVGElement;
  for (const [key, value] of Object.entries(attrs)) node.setAttribute(key, String(value));
  for (const child of children) node.append(child);
  return node;
}

const rect = (x: number, y: number, w: number, hgt: number, cls: string, rx = 3, extra: Attrs = {}) =>
  h("rect", { x, y, width: w, height: hgt, rx, class: cls, ...extra });
const text = (x: number, y: number, value: string, cls: string, extra: Attrs = {}) => h("text", { x, y, class: cls, ...extra }, value);
/** Grey placeholder lines standing in for a page's text. */
const lines = (x: number, y: number, widths: number[], gap = 9) =>
  h("g", {}, ...widths.map((w, i) => rect(x, y + i * gap, w, 4, "ex-line", 2)));
/** A small browser window: frame, three dots, an address pill. */
function frame(x: number, y: number, w: number, hgt: number, host?: string): SVGElement {
  return h(
    "g",
    {},
    rect(x, y, w, hgt, "ex-frame", 9),
    h("line", { x1: x, y1: y + 18, x2: x + w, y2: y + 18, class: "ex-rule" }),
    h("circle", { cx: x + 10, cy: y + 9, r: 2.2, class: "ex-dot" }),
    h("circle", { cx: x + 18, cy: y + 9, r: 2.2, class: "ex-dot" }),
    h("circle", { cx: x + 26, cy: y + 9, r: 2.2, class: "ex-dot" }),
    rect(x + 36, y + 4.5, Math.min(120, w - 48), 9, "ex-pill", 4.5),
    ...(host ? [text(x + 42, y + 11.5, host, "ex-host")] : [])
  );
}
/** An ad slot: dashed outline and a small "AD" mark. */
const adBox = (x: number, y: number, w: number, hgt: number, cls = "") =>
  h("g", { class: cls }, rect(x, y, w, hgt, "ex-ad", 4), text(x + 5, y + 10, "AD", "ex-ad-mark"));
/** Moat's shield, the one blue mark in each scene. */
const shield = (x: number, y: number, cls = "") =>
  h("path", { d: `M${x} ${y}l9 3.6v6c0 5.4-3.8 9.7-9 11.4-5.2-1.7-9-6-9-11.4v-6z`, class: `ex-shield ${cls}` });
const cross = (x: number, y: number, cls = "") =>
  h("g", { class: `ex-cross ${cls}` }, h("circle", { cx: x, cy: y, r: 7 }), h("path", { d: `M${x - 3} ${y - 3}l6 6M${x + 3} ${y - 3}l-6 6` }));
const check = (x: number, y: number, cls = "") =>
  h("g", { class: `ex-check ${cls}` }, h("circle", { cx: x, cy: y, r: 7 }), h("path", { d: `M${x - 3.2} ${y}l2.2 2.4 4.2-4.8` }));

type SceneBuilder = () => SVGElement[];

const SCENES: Record<string, SceneBuilder> = {
  // Blocking level: ads, then trackers, then a cookie banner go as the level rises.
  levels: () => [
    frame(20, 14, 240, 142, "news.example"),
    lines(34, 44, [120, 130, 96]),
    adBox(176, 42, 70, 36, "ex-lv1"),
    lines(34, 86, [150, 130, 140, 110]),
    h("g", { class: "ex-lv2" }, h("circle", { cx: 200, cy: 98, r: 4, class: "ex-tracker" }), h("circle", { cx: 214, cy: 104, r: 4, class: "ex-tracker" }), h("circle", { cx: 228, cy: 96, r: 4, class: "ex-tracker" })),
    h("g", { class: "ex-lv3" }, rect(30, 126, 220, 22, "ex-banner", 5), lines(38, 134, [90]), rect(196, 131, 44, 12, "ex-btn", 6)),
    h("g", { class: "ex-meter" }, rect(96, 160, 26, 4, "ex-step ex-step1", 2), rect(127, 160, 26, 4, "ex-step ex-step2", 2), rect(158, 160, 26, 4, "ex-step ex-step3", 2)),
  ],
  // Cookie banner answered: it rises, "reject" is pressed, it's gone.
  consentReject: () => [
    frame(20, 14, 240, 142, "shop.example"),
    lines(34, 44, [150, 170, 120, 160, 140]),
    h(
      "g",
      { class: "ex-consent" },
      rect(30, 100, 220, 48, "ex-banner", 6),
      lines(40, 110, [120, 90]),
      rect(40, 130, 56, 12, "ex-btn", 6),
      rect(104, 130, 56, 12, "ex-btn-ghost ex-reject", 6)
    ),
    shield(236, 40, "ex-pop-late"),
  ],
  // Unblockable video ad faded to grey while it plays.
  grayscale: () => [
    frame(20, 14, 240, 142, "video.example"),
    h("g", { class: "ex-video" }, rect(34, 42, 212, 90, "ex-video-fill", 6), h("path", { d: "M132 72v30l26-15z", class: "ex-play" }), rect(42, 50, 22, 12, "ex-ad-chip", 3), text(46, 59, "AD", "ex-ad-chip-text")),
    rect(34, 140, 212, 4, "ex-line", 2),
    rect(34, 140, 70, 4, "ex-progress", 2),
  ],
  // Sponsored post folded out of a feed; the next one moves up.
  feedScan: () => [
    frame(20, 14, 240, 142, "social.example"),
    h("g", {}, rect(34, 40, 212, 30, "ex-card", 6), h("circle", { cx: 47, cy: 55, r: 6, class: "ex-avatar" }), lines(60, 50, [110, 80])),
    h("g", { class: "ex-sponsored" }, rect(34, 76, 212, 30, "ex-card ex-card-ad", 6), h("circle", { cx: 47, cy: 91, r: 6, class: "ex-avatar" }), lines(60, 86, [90, 60]), rect(200, 84, 38, 12, "ex-ad-chip", 3)),
    h("g", { class: "ex-feed-rise" }, rect(34, 112, 212, 30, "ex-card", 6), h("circle", { cx: 47, cy: 127, r: 6, class: "ex-avatar" }), lines(60, 122, [120, 70]))
  ],
  // Password typed, checked, flagged as seen in a breach.
  leakedPassword: () => [
    frame(20, 14, 240, 142, "login.example"),
    lines(60, 46, [80]),
    rect(60, 60, 160, 22, "ex-field", 6),
    h("g", { class: "ex-typing" }, ...[0, 1, 2, 3, 4, 5, 6, 7].map((i) => h("circle", { cx: 74 + i * 11, cy: 71, r: 3, class: `ex-bullet ex-bullet${i}` }))),
    rect(60, 90, 160, 16, "ex-btn", 8),
    h("g", { class: "ex-breach" }, rect(60, 116, 160, 24, "ex-warn", 6), h("path", { d: "M72 133l6-11 6 11z", class: "ex-warn-icon" }), lines(92, 126, [100])),
  ],
  // A tracker's cookie tries to follow you to the next site; it's cut.
  cookies: () => [
    frame(14, 30, 112, 100, "a.example"),
    frame(154, 30, 112, 100, "b.example"),
    lines(24, 60, [80, 60, 70]),
    lines(164, 60, [80, 60, 70]),
    h("g", { class: "ex-cookie" }, h("circle", { cx: 70, cy: 105, r: 8, class: "ex-cookie-body" }), h("circle", { cx: 67, cy: 102, r: 1.4, class: "ex-cookie-chip" }), h("circle", { cx: 73, cy: 108, r: 1.4, class: "ex-cookie-chip" })),
    h("path", { d: "M140 88v36", class: "ex-wall" }),
    shield(140, 60),
  ],
  // Your real IP address replaced before a page can read it.
  webrtc: () => [
    frame(20, 14, 240, 142, "call.example"),
    rect(40, 50, 90, 70, "ex-card", 8),
    h("circle", { cx: 85, cy: 76, r: 12, class: "ex-avatar" }),
    rect(62, 96, 46, 14, "ex-avatar", 7),
    h("g", { class: "ex-ip-real" }, rect(146, 70, 96, 22, "ex-field", 6), text(156, 85, "203.0.113.7", "ex-mono")),
    h("g", { class: "ex-ip-masked" }, rect(146, 70, 96, 22, "ex-field ex-field-on", 6), text(156, 85, "• • • • • •", "ex-mono ex-mono-on")),
    shield(194, 44, "ex-pop-late"),
  ],
  // What a site reads about your device keeps coming back different.
  fingerprint: () => [
    frame(20, 14, 240, 142, "site.example"),
    ...["ex-fp1", "ex-fp2", "ex-fp3", "ex-fp4"].map((cls, i) => h("g", {}, rect(40, 44 + i * 26, 32, 10, "ex-line", 3), rect(84, 44 + i * 26, 150, 10, "ex-track", 5), rect(84, 44 + i * 26, 90, 10, `ex-fp ${cls}`, 5))),
  ],
  // A tracker hiding under the site's own address is unmasked and stopped.
  cname: () => [
    frame(20, 14, 240, 142, "shop.example"),
    lines(34, 44, [150, 120]),
    h("path", { d: "M60 104h86", class: "ex-arrow" }),
    rect(34, 94, 26, 20, "ex-card", 5),
    h("g", { class: "ex-alias" }, rect(150, 94, 96, 20, "ex-field", 5), text(158, 108, "metrics.shop…", "ex-mono")),
    h("g", { class: "ex-real" }, rect(150, 94, 96, 20, "ex-field ex-field-bad", 5), text(158, 108, "tracker.net", "ex-mono")),
    cross(236, 132, "ex-pop-late"),
  ],
  cnameFirefox: () => SCENES.cname!(),
  // A content-farm result folded behind a one-line "show" link.
  searchSlop: () => [
    frame(20, 14, 240, 142, "search.example"),
    rect(34, 38, 150, 12, "ex-field", 6),
    lines(34, 62, [70, 150]),
    h("g", { class: "ex-slop" }, rect(30, 84, 220, 30, "ex-card ex-card-ad", 5), lines(38, 92, [60, 140])),
    h("g", { class: "ex-slop-fold" }, rect(34, 90, 80, 8, "ex-fold", 4)),
    h("g", { class: "ex-feed-rise" }, lines(34, 122, [80, 140])),
  ],
  // A page asks for the camera on load; the prompt never appears.
  permissionGuard: () => [
    frame(20, 14, 240, 142, "site.example"),
    lines(34, 44, [150, 170, 120, 160]),
    h("g", { class: "ex-prompt" }, rect(28, 34, 132, 58, "ex-banner", 7), h("path", { d: "M40 52h14a3 3 0 013 3v8a3 3 0 01-3 3H40a3 3 0 01-3-3v-8a3 3 0 013-3zM57 57l6-3v10l-6-3", class: "ex-glyph" }), lines(70, 52, [70, 50]), rect(96, 74, 26, 10, "ex-btn", 5), rect(126, 74, 26, 10, "ex-btn-ghost", 5)),
    shield(236, 40, "ex-pop-late"),
  ],
  // Filter lists: several lists feed one shield.
  lists: () => [
    ...[0, 1, 2, 3].map((i) => h("g", { class: `ex-list ex-list${i}` }, rect(26, 26 + i * 30, 110, 22, "ex-card", 5), lines(36, 35 + i * 30, [70]))),
    h("path", { d: "M140 37C170 37 170 80 196 80M140 67c20 0 30 13 56 13M140 97c20 0 30-17 56-17M140 127c30 0 30-47 56-47", class: "ex-arrow ex-flow" }),
    h("g", { transform: "translate(0 0)" }, shield(222, 66)),
  ],
  // Paused site: ads come back, dangerous sites stay blocked.
  paused: () => [
    frame(20, 14, 240, 142, "trusted.example"),
    lines(34, 44, [120, 130, 96]),
    adBox(176, 42, 70, 36, "ex-unpause"),
    h("g", { class: "ex-toggle" }, rect(34, 124, 30, 16, "ex-switch", 8), h("circle", { cx: 42, cy: 132, r: 6, class: "ex-knob" })),
    lines(72, 130, [60]),
    shield(236, 124),
  ],
  // Hidden on pages: point at a box, click, gone.
  hidden: () => [
    frame(20, 14, 240, 142, "blog.example"),
    lines(34, 44, [150, 130, 140]),
    h("g", { class: "ex-picked" }, rect(34, 78, 212, 40, "ex-card ex-card-ad", 6), lines(44, 90, [120, 80])),
    rect(32, 76, 216, 44, "ex-outline", 8),
    h("path", { d: "M200 100l0 16 4-4 3 7 3-1-3-7h6z", class: "ex-cursor" }),
    h("g", { class: "ex-feed-rise" }, lines(34, 128, [150, 110])),
  ],
  // Always block / never block: your own two lanes.
  rules: () => [
    h("g", {}, rect(20, 36, 150, 30, "ex-field", 8), text(32, 55, "ads.example", "ex-mono"), h("path", { d: "M176 51h36", class: "ex-arrow ex-travel" }), cross(230, 51, "ex-pop-late")),
    h("g", {}, rect(20, 100, 150, 30, "ex-field", 8), text(32, 119, "shop.example", "ex-mono"), h("path", { d: "M176 115h36", class: "ex-arrow ex-travel" }), check(230, 115, "ex-pop-late")),
  ],
  // Backup and sync: a readable file, and the same settings on another computer.
  backup: () => [
    rect(24, 40, 96, 64, "ex-card", 6),
    rect(36, 50, 72, 40, "ex-frame", 3),
    rect(56, 104, 32, 6, "ex-line", 2),
    h("g", { class: "ex-doc" }, h("path", { d: "M136 58h22l8 8v30h-30z", class: "ex-card" }), lines(142, 72, [18, 14, 18], 7)),
    rect(186, 40, 70, 90, "ex-card", 8),
    rect(194, 50, 54, 64, "ex-frame", 3),
    h("path", { d: "M126 120c20 16 50 16 70 0", class: "ex-arrow ex-flow" }),
  ],
};

/** Which scene each Settings screen shows before a row's "How it works" is pressed. */
export const SCREEN_SCENES: Record<string, string> = {
  protection: "levels",
  exceptions: "paused",
};

/** Settings rows whose id has its own picture. */
export function hasScene(id: string): boolean {
  return Object.hasOwn(SCENES, id);
}

export function buildScene(id: string): SVGElement {
  const build = SCENES[id] ?? SCENES.levels!;
  return h("svg", { viewBox: "0 0 280 170", class: `ex-scene ex-${id}`, role: "img", "aria-hidden": "true", focusable: "false" }, ...build());
}

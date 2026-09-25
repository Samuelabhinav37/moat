# Handoff: Moat surface redesign (popup, settings, warning, logger, icons, store assets)

## Overview

This package covers a polish pass across every user-facing surface of **Moat**
(`github.com/Samuelabhinav37/moat`, branch `master`) — the MV3 ad blocker / popup
firewall. Nothing here changes what Moat *blocks*; the work is entirely presentation:
the options page is restructured, the toolbar popup keeps its current design, the
warning and logger pages are tightened, the extension icons are fixed (they are
currently broken — see §Icons), and a Chrome Web Store listing set is provided.

The single biggest change is the **options page**, which moves from tabbed
bordered cards to a side-rail layout with borderless hairline rows and real
usage baselines.

## About the design files

`moat-surfaces-polish.dc.html` in this bundle is a **design reference created in
HTML** — a prototype showing intended look, copy and layout. It is *not* production
code to copy. It is one large pannable canvas holding every option explored this
session, grouped into numbered "turns", newest at the top. Each option has a visible
badge id (`1a`, `9a`, `10b`, …) matching the ids used throughout this document.

Your task is to **recreate the approved designs inside the existing extension**, using
its established patterns: plain HTML in `src/<surface>/*.html`, shared tokens and
components in `src/ui/theme.css`, TypeScript behaviour in the sibling `.ts` file. Do not
introduce a framework, a build-step CSS library, or a component system — this codebase
is deliberately vanilla, and the designs were drawn to fit it.

To view the prototype: open the `.dc.html` file in a browser (it needs `support.js`,
included, sitting next to it). Scroll to the turn you need, or search the file for the
badge id.

## Fidelity

**High-fidelity.** Exact hex values, px sizes, font weights and copy are all final
and are transcribed in this document. Recreate pixel-for-pixel using `theme.css`
variables wherever one exists (mapping table in §Design tokens). Where the design
introduces a value the theme has no variable for, add the variable — don't inline
the hex.

Two caveats on fidelity:
- The prototype uses inline styles. In the real surfaces these must become CSS in
  `theme.css` / the page's own `<style>` block, matching the existing conventions
  (`.card`, `.toggle-row`, `.switch`, `.muted`, `.filter-category`).
- All numbers shown (1,204 blocked, 84 companies, 38 of 42 sites) are **sample data**
  to demonstrate the layout. They must come from real state — see §Data required.

## Status: what is approved and what is not

| Surface | Design | Status |
| --- | --- | --- |
| Toolbar popup | `1a` | **Approved** — this is the *current* shipped design, kept deliberately. No popup work needed beyond the icon swap. |
| Options — Protection tab | `9a` | **Approved** |
| Options — Filter Lists | `10a` | **Approved** |
| Options — Custom Rules | `10b` | **Approved** |
| Options — Trackers | `10c` | **Approved** |
| Warning page | `4a` | **Approved** |
| Rule-match logger | `4b` | **Approved** |
| Extension icons | `8d` | **Approved** |
| Store listing screenshots | `7a`, `7b`, `7c`, `7d`, `7e` | **Approved** |
| Store tile + marquee | `5d`, `5e` | **Approved** |
| Options — About tab | `12a` *or* `12b` | **NOT DECIDED — do not build yet** |
| Onboarding / first-run | `11a`, `11b`, `11c` | **NOT DECIDED — do not build yet** |
| Marketing site (`site/index.html`) | `3a`, `3b` | **Deferred by the designer** |

Superseded, ignore if you come across them in the canvas: `1b`, `1c`, `2a`, `2b`,
`8a`, `8b`, `8c`, `9b`, `5a`, `5b`, `5c`, `6a`–`6c`.

## Screen map — design id → repo file

| Design | Implement in |
| --- | --- |
| `9a`, `10a`, `10b`, `10c` | `src/options/options.html` + `src/options/options.ts` |
| `4a` | `src/warning/warning.html` |
| `4b` | `src/logger/logger.html` |
| `8d` | `icons/logo.svg`, `icons/logo-banner.svg`, `icons/icon16.png`, `icon32.png`, `icon48.png`, `icon128.png` |
| Shared tokens | `src/ui/theme.css` |
| `7a`–`7e`, `5d`, `5e` | Store listing assets — export as PNG, not code |

---

## Design tokens

### Existing `theme.css` variables — unchanged, use as-is

| Variable | Value | Use |
| --- | --- | --- |
| `--bg` | `#1b191d` | page background, rail background |
| `--card` | `#242229` | raised surfaces: active rail item, drawer, inset panels |
| `--fg` | `#eceef0` | primary text, switch thumb |
| `--muted` | `#a7a1ac` | secondary text, labels, inactive rail items |
| `--accent` | `#6f9be0` | links, affordances, data-viz line/bars, deltas |
| `--on` | `#43c13a` | switch-on |
| `--on-fg` | `#0e2b0c` | text on `--on` |
| `--danger` | `#fa6d6d` | policy-block badge (`4a`) |
| `--danger-fg` | `#2c2c2f` | text on `--danger` |
| `--border` | `#37343b` | panel borders, section dividers, switch-off track |

### New variables to add to `theme.css`

```css
--hairline: #2b282f;   /* row separator inside a borderless list — sits between
                          --bg and --border so it reads as a rule, not an edge */
--caution:  #e0b16f;   /* amber: "worth knowing" warnings, stale rules, heavy
                          page badge. Distinct from --danger, which means blocked. */
--selected: #4a4550;   /* border of a selected list row / keycap outline */
--plate:    #030307;   /* extension-icon background plate (see §Icons) */
```

Do **not** use `--danger` for the caution cases. Red in this product means
"blocked / refused"; amber means "this might break something".

### Colour rules that the design depends on

- **Deltas and trend data are `--accent` blue, never green.** "More ads blocked
  this week" is not good news, it is just more. Green is reserved for switch-on state.
- **Contrast floor:** any grey text must be `--muted` (`#a7a1ac`, 6.2:1 on `--bg`).
  Do not introduce a dimmer grey — an earlier draft used `#6f6b73` (3.2:1) and it
  failed review.

### Type scale (all `system-ui`, matching `theme.css` body font)

| Role | Size / weight / line-height |
| --- | --- |
| Page title (`h2` in content column) | 19px / 600 / 1.4, `letter-spacing:-0.01em` |
| Page description | 13px / 400 / 1.5, `--muted` |
| Hero metric | 44px / 600 / 1, `letter-spacing:-0.03em`, **monospace** |
| Secondary metric | 22px / 600 / 1, **monospace** |
| Metric label / baseline | 12.5px / 400, `--muted` |
| Group heading | 11px / 600, uppercase, `letter-spacing:.06em`, `--muted` |
| Row title | 13.5px / 600 |
| Row evidence line | 12.5px / 400, `--muted` |
| Rail item | 13px / 400 (600 when active) |
| Rail count | 11px / 600, monospace, `--muted` |

Monospace stack used for every number:
`ui-monospace, 'SFMono-Regular', Consolas, monospace`. Numbers must be tabular —
add `font-variant-numeric: tabular-nums` where a column of figures aligns.

### Geometry

| Token | Value |
| --- | --- |
| Rail width | 150px, `flex: none` |
| Rail ↔ content gap | 30px |
| Page padding | 30px 28px |
| Rail item radius / padding | 7px / 7px 10px |
| Rail item gap | 1px |
| Panel radius (drawer, inset) | 9–10px |
| Row vertical padding | 13px 0 |
| Row gap (flex) | 14px |
| Section divider margin | 22px 0 0 |
| Switch | 36×20, thumb 16px, `translateX(16px)` — unchanged from `theme.css` |

---

## Screen: Options — Protection tab (`9a`)

### Purpose
The page a user opens to answer "how protected am I, and what else could I turn on".
The old version answered neither: eleven identically-weighted bordered rows, no state
summary, no data.

### Layout
Two columns, `display:flex; gap:30px; align-items:flex-start`.

1. **Rail** — 150px fixed. Brand row (22px icon + "Moat" 16px/600, 22px bottom margin),
   then the tab list at 1px gaps. Active tab: `background:--card`, `--fg`, weight 600.
   Inactive: `--muted`, transparent.
   Each tab carries a **live indicator on the right**:
   - Protection → 6px green dot (`--on`) when master protection is on
   - Filter Lists → count of enabled lists (`6`)
   - Custom Rules → count of user rules (`12`)
   - Trackers → companies seen this week (`84`)
   - About → nothing
   These counts are the reason the tabs get clicked. They are not decorative.

2. **Content column** — `flex:1; min-width:0`, **plus `padding-right:352px`**. That
   padding is load-bearing: the drawer is absolutely positioned and out of flow, so
   without it the content lays out under the drawer. (This was a real bug caught in
   review.)

### Content order
1. `h2` "Protection" + description: *"What Moat blocks, and what it leaves alone.
   Everything here runs on your device."*
2. **Metric row** (`display:flex; align-items:flex-end; flex-wrap:wrap; gap:22px 36px;
   margin:26px 0 4px`):
   - Hero: `1,204` at 44px mono + `+12%` delta chip in `--accent` with a 11px up-arrow
     SVG. Baseline line under it: *"blocked today · vs 1,075 last Thursday"*.
   - **Sparkline**: 132×40 SVG, `polyline` at `stroke:--accent; stroke-width:2;
     stroke-linecap:round; stroke-linejoin:round`, plus a 3px `circle` on the final
     point. Caption *"last 7 days"* at 11.5px mono `--muted`.
   - Right group (`margin-left:auto`, 30px gap): `42` / "sites today", and
     `6/11` / "protections on" where the `/11` is `--muted` inside the same number.
3. 1px `--border` divider.
4. **Group heading** row: "PRIVACY" + `1 of 4 on` at 12px `--muted`.
5. **Rows** — no card, no border. `padding:13px 0`, `border-bottom:1px solid --hairline`,
   last row in a group has no bottom border.

### Row anatomy — the important rule
- **Switch on:** title at full `--fg`, plus a second line of *evidence* at 12.5px
  `--muted` — what this setting has actually done. e.g. "Blocked on 38 of 42 sites
  today", "Randomised on 31 sites this week".
- **Switch off:** title at `--muted`, **no second line at all.**

This is deliberate: enabled protections are visually louder than disabled ones, so the
page's overall state is legible without reading a single label. Do not add descriptions
to off rows to make them look consistent — the asymmetry *is* the design.

The long-form description, the caveat, and the exceptions list all move into the drawer.

### The drawer
`position:absolute; top:0; right:0; bottom:0; width:330px`, `background:--card`,
`border-left:1px solid --selected`, `box-shadow:-28px 0 60px -16px rgba(0,0,0,.55)`,
`padding:26px 24px`, `display:flex; flex-direction:column`.

Opens on clicking a row (not the switch). Contents, top to bottom:
1. Setting title 15px/600 + state line `On · advanced` at 11.5px mono `--muted`, and
   the switch, mirrored from the row so it is operable from here.
2. That setting's own metric: `31` at 32px mono + "sites randomised this week".
3. **Seven-day bar chart**: 7 bars, `flex:1` each, 3px gap, 28px tall, `align-items:
   flex-end`, `border-radius:2px`. Past days `--border`, the two most recent
   `--accent`. Caption "Mon — Sun" at 11.5px mono.
4. Full description at 13px `--fg`.
5. **Caution block**: 14px amber triangle SVG + text at 12.5px `--muted`. Copy for
   fingerprinting: *"Can occasionally break a CAPTCHA or a bank's device check. If a
   site misbehaves, pause this first."* This is the home for every caveat that the
   old page carried as body prose.
6. `margin-top:auto` footer, `border-top:1px solid --border`: "2 exceptions" + a
   "Manage" link in `--accent`.

Behaviour: overlay, not a permanent column — it must not reserve width when closed.
Close on Esc, on clicking the row again, and on a click outside. Preserve scroll
position of the list behind it.

### Copy changes from the current page
Every hint is trimmed to its **first sentence**; the remainder moves to the drawer.
Specifically:
- Fingerprinting: keep *"Randomly tweaks details about your device that sites use to
  recognize you across visits."* — move *"Can occasionally break a CAPTCHA"* to the
  drawer's caution block.
- Cloaked trackers: keep *"Some trackers disguise themselves as part of the site
  you're visiting."* — the whole Chrome-DoH/Cloudflare explanation moves to the drawer.
- Search slop: keep *"Hides results from a small, curated list of content-farm
  domains."* — the "can misfire" reasoning moves to the drawer.
- Breached passwords: keep *"Warns if a password you type has appeared in a known
  breach."* — the hash explanation moves to the drawer.

### Grouping
The eleven protections regroup under three headings (the current page has one flat
"Extra protection" category):
- **Privacy** — third-party cookies, IP address leaks, fingerprinting (+ its rotate
  sub-toggle), cloaked trackers
- **Annoyances** — grayscale video ads, sponsored posts, cookie banners, low-quality
  search results
- **Safety** — breached passwords, ambush permission prompts

**Merge the three permission toggles into one row.** `permission-guard-camera-toggle`,
`-microphone-toggle` and `-location-toggle` become a single row titled *"Block ambush
permission prompts"* with three chips below it — Camera / Microphone / Location — each
chip toggling its own underlying setting. On chips: `border:1px solid --on;
background:rgba(67,193,58,.14); --fg`. Off chips: `border:1px solid --border; --muted`.
Chip type 11px/600, radius 999px, padding 3px 9px. They are one decision set three
ways, not three decisions.

---

## Screen: Options — Filter Lists (`10a`)

Same rail + content shell. Description: *"The rule sets Moat compiles into the
browser's own blocker. All six ship inside the extension — nothing is fetched to make
them work."*

**Metric row:** hero `271,270` + baseline *"rules active · Chrome's cap is 330,000"*;
a 190px-wide budget bar (6px tall, radius 999px, `--accent` fill on `--hairline`
track) with caption "82% of budget used"; then `14,208` / "from daily updates" and
`3h` / "since last check".

Framing the total against the platform's `declarativeNetRequest` rule ceiling is the
point — it is the only comparison that makes a six-figure number mean anything, and it
explains in passing why lists can't grow forever. Wire the percentage to the real
`getAvailableStaticRuleCount`-derived figure; when the budget warning condition fires
(`filter-budget-warning` in the current page) the bar turns `--caution` and the
existing warning copy appears directly beneath it.

**Rows:** list name 13.5px/600, a plain-language line saying what it catches, a
right-aligned rule count (13px mono `--muted`, `width:64px; text-align:right`), then
the switch. Lists that matched on the current page append *"· matched 71 times on this
page"* to their description line — that is this tab's baseline.

Group heading row carries "6 of 6 on" and a right-aligned "Check for updates" link.

Keep the existing five filtering-level presets (Off / Lite / Essential / Standard /
Strict) — they are not in the mock but must not be dropped; place them above the group
heading as a row of buttons using the existing `.preset-row` pattern.

---

## Screen: Options — Custom Rules (`10b`)

Description: *"Everything you've hidden yourself with the element picker. These
override the filter lists and never leave your browser."*
Top-right: a **"Pick an element"** button (`--card` bg, `--border`, 8px radius,
12.5px/600) with a 13px amber cursor-arrow SVG.

**Metric row:** `12` + "rules, across 7 sites", baseline *"Hid something 341 times
this month"*; right group `11` / "still matching" and `1` / "gone stale" where the
stale figure is `--caution`.

**Rows:** selector in 13px mono, site in 12.5px `--muted` beside it, then a metadata
line *"Added 3 days ago · hidden 28 times since"*, and a right-aligned "Remove".

**The one new idea — stale rules.** A rule whose selector hasn't matched in 30 days
replaces its metadata line with an amber triangle + *"Hasn't matched in 30 days — the
site probably changed"*, dims its selector to `--muted`, and turns its Remove link
`--accent` to invite the click. Requires tracking a per-rule `lastMatchedAt`
timestamp. Sites change constantly and dead selectors accumulate silently; nothing
else in the product would ever tell the user.

Footer line: *"7 more on 3 other sites"* at 12.5px `--muted`.

This tab must also keep the existing Paused sites / Blocked sites / Allowed sites
lists and their add-rows — put them below the picker rules under their own group
headings, styled as hairline rows rather than `.card`s.

---

## Screen: Options — Trackers (`10c`)

Description: *"Which companies tried to follow you, and how far they got. Counted on
your device from the browser's own match data — this list is never uploaded."*

**Metric row:** `84` + delta chip `9`, baseline *"companies seen this week · 75 last
week"*; a 132×40 sparkline captioned "last 7 weeks"; then `1,204` / "attempts blocked"
and **`0` / "got through"**. That last figure is the one that matters — it must sit
beside the hero, not below the fold.

**Rows:** 132px fixed left cell (company name 13.5px/600 + reach "31 of 42 sites" at
12px `--muted`), a flexible bar, then a right-aligned count (13px mono, 46px wide).

Bar: 8px tall, radius 999px, `--hairline` track, `--accent` fill. **Fill is relative
to the top company's count, not to a total.** A share-of-100% chart would imply a
completeness this data doesn't have. Reach ("31 of 42 sites") is the honest alarming
number, not the raw hit count.

Footer: *"79 more companies, 284 attempts between them"* + a "Show all" link.
Group heading row carries a right-aligned "Clear history".

Keep the existing Firefox-unsupported message (`trackers-unsupported`) and the
refresh affordance.

---

## Screen: Warning page (`4a`)

`src/warning/warning.html`. Centred card, `max-width:440px`, `background:--card`,
`border:1px solid --border`, radius 12px, padding 28px.

Three changes from the current page:
1. **Red is confined to the badge.** The card gets an ordinary `--border`, not a red
   outline — a red box around the whole page reads as "something crashed", not
   "policy". Badge: `background:--danger; color:--danger-fg`, 11px/600 uppercase,
   `letter-spacing:.04em`, padding 3px 8px, radius 6px, text "Blocked by organization
   policy", 14px bottom margin.
2. **The hostname leaves the headline** and gets its own field: 15px mono, `--fg`,
   `background:--bg`, `border:1px solid --border`, radius 8px, padding 8px 11px,
   `word-break:break-all`. Headline above it is a static 18px/600 "This site was
   blocked". A 60-character domain can no longer wrap the sentence into nonsense.
3. **"Go back" is the solid light button** (`background:--fg; color:--bg`, 13px/600) and
   "Report a mistake" is outlined. The current primary-green treatment reads as "this
   site is fine, proceed".

Body copy: *"Your organization's security policy blocks this site. This isn't Moat's
own filter list — it's a domain your organization specifically named."*

Report form, separated by `border-top:1px solid --border`, 20px above / 18px padding:
explanatory line *"This sends a note to your organization's security team for review —
it does not unblock the site."*, a textarea (min-height 64px, `--bg`,
`border:1px solid --border`, radius 8px), a primary Submit, and beside it *"Goes to
your IT team, not to Moat."* at 12px `--muted`.

---

## Screen: Rule-match logger (`4b`)

`src/logger/logger.html`. Title row: "Rule-match logger" 17px/600 + a pill badge
*"Unpacked builds only"* (11px/600 `--muted`, `border:1px solid --border`, radius 999px,
padding 2px 9px). The developer-mode constraint becomes a badge you see *before*
reading, not a paragraph after.

Description keeps the real technical explanation: *"Shows which of Moat's compiled
rules matched each request on the active tab. Chrome only fires this event for
extensions loaded in developer mode — it will never populate on a store install, and
Firefox doesn't implement it."*

Toolbar: primary "Refresh", the active hostname in 12.5px mono, and a right-aligned
`128 matches · last 60s` in 12px mono `--muted`.

Table: `display:grid`, columns `72px 128px 62px 74px minmax(0,1fr)` —
Time / Ruleset / Rule / Type / URL. Wrapper `border:1px solid --border`, radius 10px,
`overflow:hidden`. Header row `background:--card`, 10.5px/600 uppercase `--muted`.
Body cells 12px mono, `padding:7px 10px`, `border-top:1px solid --hairline`.

Three specifics:
- **Ruleset becomes a chip** — it's the column you scan by. `background:--border`,
  radius 5px, padding 2px 7px, 11px/600, system font (not mono).
- Rules from the daily live update get an `--on`-filled chip reading `live` with
  `--on-fg` text, distinguishing them from bundled rules.
- **Rule ids are right-aligned tabular numerals** (`--muted`); the URL column takes
  `minmax(0,1fr)` with `white-space:nowrap; overflow:hidden; text-overflow:ellipsis`.

Footer note, 12px mono `--muted`: *"Rule ids are grouped by ruleset, not global. A live
tag means the rule came from the daily update, not the bundle."*

---

## Icons (`8d`) — this is a bug fix, not a restyle

The shipped PNGs are broken. Verified against the repo:

1. **The mark is white-on-transparent with no plate.** `icons/logo-banner.svg` has the
   dark `#030307` tile; the PNGs referenced by the manifest do not. On Chrome's default
   light toolbar the icon is white on near-white — effectively invisible.
2. **The nodes are sub-pixel at 16px.** Two circles are `r="1.43"` on a 32-unit grid →
   0.7px radius when rendered at 16. `icon16.png` decodes to an all-but-blank square.
3. **The `feGaussianBlur stdDeviation="1.4"` glow** spans roughly a third of the icon at
   favicon scale and only greys the edges.

`icons/moat-icon.svg` in this bundle is the fix. It keeps the four-node branching
constellation — that fork is the silhouette; reducing it to two nodes turns the mark
into a generic diagonal arrow — and changes only what broke:

- Plate: `<rect width="32" height="32" rx="7" fill="#030307"/>` as the first element,
  present at **every** size.
- Node radii `4 / 2.8 / 2.2 / 2.0` (was `3.12 / 2.21 / 1.43 / 1.43`), so the smallest
  node is 1px at 16px render.
- Strokes `2` (was `0.7`), `rgba(255,255,255,.55)`.
- Node coordinates snapped to the grid: `(24,8) (16,16) (9,25) (5.5,11)`.
- Blur filter and the duplicate blurred circle deleted entirely.

**To do:** regenerate `icon16.png`, `icon32.png`, `icon48.png`, `icon128.png` from this
SVG, and update `icons/logo.svg` / `icons/logo-banner.svg` to the same geometry. Verify
`icon16.png` on a light toolbar before committing. Also replace the inline copies of
the old mark in `src/popup/popup.html` and `src/options/options.html`.

---

## Interactions & behaviour

| Interaction | Behaviour |
| --- | --- |
| Click a settings row (not the switch) | Opens the drawer for that setting. Row gets `background:--card; border:1px solid --selected`. |
| Click the switch | Toggles only; does not open the drawer. |
| Esc / click outside / click the row again | Closes the drawer. List scroll position preserved. |
| Toggle a protection | Row's evidence line appears/disappears, title moves between `--fg` and `--muted`, group "n of 4 on" count updates, rail dot updates. Use the existing 0.15s ease switch transition; no other animation. |
| Click a rail tab | Switches panel. Counts in the rail are always live, including for the tab you're on. |
| Hover a row | `background: rgba(255,255,255,.03)`. Keep it this subtle — the design's grouping is hairlines, and a strong hover fill re-introduces the boxes we removed. |
| Focus | Keep the existing `:focus-visible` outline: `2px solid --accent`, `outline-offset:2px`. Rows must be keyboard-reachable and Enter must open the drawer. |
| "Pick an element" | Existing element-picker flow, unchanged. |
| Stale-rule Remove | Deletes immediately; no confirm dialog (the rule is already doing nothing). |

Responsive: the options page is a fixed-width desktop surface, but the content column
must survive the drawer being open — see the `padding-right:352px` note. Below ~900px
the drawer should become full-width over the content rather than a 330px panel.

---

## Data required

Most of this exists; some is new. Nothing here may be fetched from a server.

| Figure | Source |
| --- | --- |
| Blocked today, and the same-weekday-last-week comparison | Needs a rolling 7-day local counter. The current code only keeps per-tab badge counts. |
| 7-day sparkline series | Same counter, daily buckets. |
| Sites protected today | Count of distinct hostnames with ≥1 match today. |
| "n of 11 protections on" | Derived from existing settings state. |
| Per-setting evidence ("38 of 42 sites") | Per-setting match attribution — new. |
| Per-setting 7-day bars (drawer) | Same, bucketed daily. |
| Rules active / budget % | `declarativeNetRequest.getAvailableStaticRuleCount()` + bundled totals. |
| Per-list "matched n times on this page" | Existing `getMatchedRules` path (the one the logger uses). |
| Custom rule "hidden n times since" and `lastMatchedAt` | New per-rule counters. |
| Tracker companies, counts, reach | Existing tracker attribution, aggregated weekly. |

All counters are local-only and must be included in the existing export/import
settings payload — and, like the fingerprint ID, must **not** sync.

---

## Store listing assets (`7a`–`7e`, `5d`, `5e`)

Export as PNG at exactly these sizes; they are code-free deliverables.

| Design | Size | Content |
| --- | --- | --- |
| `7a` | 1280×800 | Popup over a real page, browser window cropped off the right and bottom edges |
| `7b` | 1280×800 | The privacy claim — "No server. No account. No telemetry." |
| `7c` | 1280×800 | Settings (`9a`) blown up, light per-site card overlapping at the left |
| `7d` | 1280×800 | Per-site pause: badge 0, counter greyed, card flipped to amber "paused" |
| `7e` | 1280×800 | Element picker: page dimmed, one amber selection, block panel alongside |
| `5d` | 440×280 | Small promo tile — logo, name, one line |
| `5e` | 1400×560 | Marquee — wide and short, the three "no" claims on one line |

Constraints baked into these artboards, worth preserving if you re-cut them:
- Store screenshots display at roughly a third scale in the carousel, so **no
  marketing type below 26px and no in-product label below 20px**.
- The `128` in the toolbar badge, the popup hero, and the headline must all agree,
  and `71 + 54 + 3 = 128` must hold.
- Frame chrome (traffic lights, back/forward/reload, address pill) is identical across
  `7a`, `7d`, `7e` — the address field starts at x=430 in all three.

The screenshots embed a real page capture in `uploads/`. Swap in your own capture if
licensing matters for the store submission.

---

## Assets

| Asset | Where |
| --- | --- |
| `icons/moat-icon.svg` | In this bundle — the approved `8d` mark, source of truth for all PNG sizes |
| Existing repo icons | `icons/*` — to be regenerated from the above |
| Page screenshot in store mocks | `uploads/` in the design project; replace for production |
| Fonts | None to add. Product surfaces use the `theme.css` `system-ui` stack; the store artboards use IBM Plex Sans/Mono, which is the marketing site's existing typeface and is not needed in the extension. |

## Files in this bundle

| File | What it is |
| --- | --- |
| `README.md` | This document — self-sufficient; implement from it |
| `moat-surfaces-polish.dc.html` | The full design canvas, all turns and options |
| `support.js` | Runtime the canvas needs; keep it beside the HTML |
| `icons/moat-icon.svg` | Approved extension icon |

## Suggested implementation order

1. **Icons.** Smallest change, fixes a live bug, unblocks the store submission.
2. **`theme.css` tokens** — add `--hairline`, `--caution`, `--selected`, `--plate`.
3. **Warning + logger** (`4a`, `4b`). Self-contained single pages, no new data.
4. **Options shell** — rail, borderless rows, regrouping, permission-chip merge,
   copy trimming. Ships value before any new counters exist: build it with the
   evidence lines omitted, then light them up as the data lands.
5. **Local counters**, then the metric rows and drawer charts.
6. **Filter Lists / Custom Rules / Trackers** tabs.
7. **Store assets** export.
8. Stop. About (`12a`/`12b`) and onboarding (`11a`/`11b`/`11c`) are still open
   decisions — check before building either.

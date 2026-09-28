# Settings page: how settings are grouped into screens (2026-09-28)

Input for the Settings page redesign. The question: is each setting on the right screen, and
would a different grouping be easier to use? This note maps today's structure, flags problems,
compares five products and Chrome, and proposes a new tree.

Moat's own code was read at commit `f504909` plus the uncommitted working tree of 28 Sep 2026.
Line numbers are from that tree and will drift. Other products were checked in their source
repos, help centres and design-system pages. Where a claim could not be confirmed from a primary
source, this note says so.

## 1. Moat today

### Desktop (900px and wider): sidebar screens

`dashboard.ts:7` lists nine screens. Each `<section data-page>` is shown only on its screen.
The sidebar is at `options.html:2251-2264`. Top bar: logo, "Search settings", Help link.

```
Overview                                   #overview
  Week card: total, ads / trackers / pop-ups, today, 7-day chart      (2294)
  Blocking level card: level name, meter, links to Paused, Hidden, "Change level"
  Quick actions: Block an element, Save a backup, Check for filter fixes  (2326-2328)
  Trackers: companies stopped this week; "On the tab you last used"  (2530, inside #advanced)
Protection
  Blocking level                           #blocking
    How much to block: Light / Balanced / Strict cards  (2336)
      note when level is Essential or Custom: "Change it under Advanced settings" (2360)
    Features: Auto-reject cookie banners, Gray out unblockable video ads,
      Hide sponsored posts in feeds, Check passwords against known breaches  (2364; options.ts:400)
  Privacy                                  #privacy  (section "Privacy extras", 2466)
    Stop sites tracking you across the web (third-party cookies)
    Stop IP address leaks (WebRTC)
    Stop sites recognizing your device (fingerprint)
      + Use a new disguise each time you restart (only when fingerprint is on, options.ts:826)
    Catch trackers hiding in disguise (CNAME)
    Firefox only: device-disguise mode (RFP), Stop trackers linking you across sites (FPI)
    Hide low-quality search results
    Block surprise permission requests + Camera / Microphone / Location chips  (options.ts:828)
  Filter lists                             #filters  (2429)
    Rule-budget warning (when lists were dropped)
    Pills: Light / Essential / Balanced / Strict, "Managed by your organization" badge
    Preset hint, rule budget bar
    "Show all lists" details: Check for updates link + one switch per list  (2452-2457)
Your exceptions
  Paused sites                             #paused  (2372)
    List of paused sites, empty state. Lead says: pause from Moat's icon.
  Hidden on pages                          #hidden  (2389)
    Things you've hidden, "Pick an element" button, "Grayed out" list
  Always and never block                   #rules  (section "Block and allow", 2477)
    Pause Moat on a site: text box + Pause  (2483-2489)
    Always block: list + text box  (2491)
    Never block: list + text box  (2502)
    Import from another blocker… (details)  (2513)
Settings
  Backup and sync                          #backup  (2555)
    Save a backup, Restore from a file, last backup date, import preview
    Sync across devices switch
  About Moat                               #about  (2600)
    Version, build, rule count, Check for filter fixes
    What leaves your device (data-flow table)
    Keyboard shortcut + Change
    Help and details: privacy policy, changelog, source, Diagnostics (logger.html), licences
Footer: product links, "Report an issue" (report.html, 2713)
```

### Phones (below 900px): one scrolling page

The sidebar, page heading and Overview cards are hidden (`options.html:1521-1524`). The order is
the DOM order:

1. How much to block (cards)
2. Features
3. Sites you've paused
4. Things you've hidden
5. "Advanced settings" button. Its hint reads "Filter lists, privacy extras, your own rules,
   trackers, backup and version" (`options.html:2416`; `options.ts:143-160`). Opening it shows:
   Filter lists, Privacy extras, Block and allow, Trackers, Backup and sync, About Moat.

On desktop the Advanced button is hidden and `#advanced` is forced open (`options.html:1840-1846`).
Filter-list rows start open on desktop and collapsed on phones (`options.ts:126-128`).

### Outside the Settings page

```
Popup (popup.html)
  Header: Moat mark, Settings link (374)
  Notices: first-run card, "Updated to v…", rule-budget notice with "Open Settings"
  Stats: count on this tab, level name, Ads / Trackers / Popups, "By company" (421)
  Paused banner; site card with on/off switch for this site (439)
  "Customize for this site" (444): per-site switches for fingerprint, cookie banners,
    feed ads, low-quality search results, each with Reset (popup.ts:100-175)
  Permission notice: Allow camera / microphone / location here (450)
  Buttons: Reload page, Block an element…, Clear site data…, Report a problem… (460-480)
Element picker: started from the popup, Overview, or Hidden on pages
Report a problem (report.html): site, category, "did pausing help", note, send / copy / GitHub
Diagnostics (logger.html): reached only from About > Help and details
Welcome tour (welcome.html): 4 steps, opens once on install (background/firstRunTour.ts)
```

## 2. Structural problems in the current tree

1. **The level is chosen in two places with different options.** Blocking level shows three
   cards (`options.html:2344-2358`). Filter lists shows four pills, including Essential
   (`2439-2446`). Essential and "back to a level after Custom" are only reachable from the pills.
   Android's guidance: when a setting must appear twice, give it one screen and link to it
   ([Android settings guidelines](https://source.android.com/docs/core/settings/settings-guidelines)).
2. **The note under the level cards points to a place that doesn't exist on desktop.** It says
   "Change it under Advanced settings" (`options.html:2360`), but desktop has no Advanced button.
3. **"Pause Moat on a site" is on the wrong screen.** The box is on Always and never block
   (`2483-2489`). Paused sites has no way to add one, and its lead tells people to use the popup
   instead (`2375`). The paused list and the pause box are one task split across two screens.
4. **Per-site settings from the popup have no home in Settings.** "Customize for this site"
   writes `perSiteOverrides` (`types.ts:160`). Nothing in `src/options/` reads it. You can't see
   which sites you changed, or reset them, without visiting each site. Permission allowances
   from the popup go into the browser's own site settings (`background/permissionGuard.ts`), and
   Moat doesn't list or link to them either.
5. **"Features" mixes kinds.** It holds three annoyance fixes and a password breach check
   (`options.ts:400`). Meanwhile "Hide low-quality search results", tagged `annoyances` in the
   code (`options.ts:352-372`), sits on Privacy. The code's own groups (`privacy`, `annoyances`,
   `safety`) don't match the screens.
6. **Privacy is one flat list of 6 to 8 rows** covering cookies, IP, fingerprint, CNAME, Firefox
   switches, search results and permissions. Android advises grouping long screens with
   dividers ([Android settings guidelines](https://source.android.com/docs/core/settings/settings-guidelines)).
7. **Trackers is activity, not a setting, and it moves between layouts.** On desktop it is folded
   into Overview (`dashboard.ts:12`, section at `options.html:2530`). On phones Overview is hidden,
   so Trackers appears inside "Advanced settings" between rules and backup.
8. **Import from another blocker sits under rules.** It imports blocked/allowed domains and
   element-hiding rules (`2513-2527`), so it spans Always and never block and Hidden on pages. It
   is a one-off move-in task, closer to Backup.
9. **One action, three buttons, two labels.** "Check for filter fixes" (Overview, About) and
   "Check for updates" (Filter lists) all send `check-for-live-updates`
   (`options.ts:1063-1066`, `1412-1417`, `1840`).
10. **Names don't match between sidebar and section heading.** "Always and never block" vs
    "Block and allow"; "Privacy" vs "Privacy extras"; "Paused sites" vs "Sites you've paused".
    Desktop shows the sidebar name, phones show the heading. NN/g lists inconsistent navigation
    and made-up labels among the top IA mistakes
    ([Nielsen, Top 10 IA mistakes](https://www.nngroup.com/articles/top-10-ia-mistakes/)).
11. **Phone order differs from desktop order.** Phones put Filter lists before Privacy, and split
    "Your exceptions" in two (Paused and Hidden above the fold, rules under Advanced).
12. **Filter lists "hidden behind Show all lists"** is only true on phones. Desktop opens it.
    This one is fine as is.
13. **Keyboard shortcut lives in About.** It is the only control on that screen apart from the
    update check. Minor; see the proposal.

Not a problem: the Overview quick actions duplicate Block an element, Save a backup and Check for
fixes, but each just clicks the canonical button (`options.ts:1838-1840`). That is the "one
screen, several entry points" pattern Android recommends.

## 3. How comparable products group settings

### uBlock Origin Lite (dashboard)

- Tabs: Settings, Filter lists, Custom filters, Develop, About
  ([dashboard.html](https://github.com/uBlockOrigin/uBOL-home/blob/main/chromium/dashboard.html)).
- Settings holds "Default filtering mode" (three radios: basic, optimal, complete), then
  Behavior switches, then Backup/Restore (same file).
- Level vs lists: the mode lives only on Settings. Filter lists has no mode control, just lists
  and a URL import (same file).
- Per-site: the default "will be overridden by per-website filtering modes"
  ([uBOL messages.json](https://github.com/uBlockOrigin/uBOL-home/blob/main/chromium/_locales/en/messages.json)).
  The list of per-site modes is an editor under Develop ("filtering mode details"), not a
  friendly page (dashboard.html, `data-pane="develop"`).

### AdGuard Browser Extension

- Sidebar, from source: General, Filters, Tracking protection, Allowlist, User rules,
  Additional settings, Rule limits (MV3), About
  ([Nav.jsx](https://github.com/AdguardTeam/AdguardBrowserExtension/blob/master/Extension/src/pages/options/components/Nav/Nav.jsx),
  labels from [messages.json](https://github.com/AdguardTeam/AdguardBrowserExtension/blob/master/Extension/_locales/en/messages.json)).
- Filters are grouped by role: "Ad blocking, Privacy, Social widgets, Annoyances, Security,
  Other, Language-specific, Custom". Each group can be switched on whole
  ([AdGuard KB: Filters](https://adguard.com/kb/adguard-browser-extension/features/filters/)).
- Per-site exceptions: their own Allowlist screen. Adding a site there or hiding an element
  "is automatically saved in User rules"
  ([AdGuard KB: Other features](https://adguard.com/kb/adguard-browser-extension/features/other-features/)).
- No overall level. Tracking protection is a separate screen of individual switches grouped by
  method ([AdGuard KB: Tracking protection](https://adguard.com/kb/general/stealth-mode/)).

### Ghostery

- Sidebar, from source: Privacy protection, Websites, Trackers, WhoTracks.Me, My Ghostery
  ([settings.js](https://github.com/ghostery/ghostery-extension/blob/main/src/pages/settings/settings.js)).
- Privacy protection: three main switches (Ad-Blocking, Anti-Tracking, Never-Consent), then
  links to sub-pages Redirect Protection, Distractions, Additional Filters, then "Pause Ghostery"
  ([privacy.js](https://github.com/ghostery/ghostery-extension/blob/main/src/pages/settings/views/privacy.js)).
- Filter lists are a sub-page ("Additional Filters": regional and custom), not top level.
- Per-site: one Websites screen. "All websites with adjusted protection status will be listed
  here", split into "Manually Adjusted" and "Automatically Adjusted"
  ([websites.js](https://github.com/ghostery/ghostery-extension/blob/main/src/pages/settings/views/websites.js)).
  Per-tracker exceptions sit under Trackers.

### Brave Shields

- One Shields page. Its defaults section says: "These are the default Shields settings. They
  apply to all websites unless you change something in the Shields panel on a particular site."
  ([brave_settings_strings.grdp](https://github.com/brave/brave-core/blob/master/app/brave_settings_strings.grdp)).
- Level and switches sit together: "Trackers & ads blocking" (Aggressive / Standard / off), then
  separate controls for HTTPS upgrade, scripts, fingerprinting and cookies
  ([default_brave_shields_page.html](https://github.com/brave/brave-core/blob/master/browser/resources/settings/default_brave_shields_page/default_brave_shields_page.html)).
- Filter lists are a sub-page, "Content filtering", linked from the bottom of Shields (same files;
  path `brave://settings/shields/filters` per the
  [Shields debugging guide](https://github.com/brave/brave-browser/wiki/Shields-Debugging-Guide)).
- Per-site changes are made in the Shields panel on the site (same guide). A settings list of
  per-site changes was not confirmed from a primary source.

### DuckDuckGo Privacy Essentials

- One options page: privacy options (Global Privacy Control, Fire Button), Unprotected Sites,
  Email Protection
  ([templates](https://github.com/duckduckgo/duckduckgo-privacy-extension/tree/main/shared/js/ui/templates),
  labels from [options.json](https://github.com/duckduckgo/duckduckgo-privacy-extension/blob/main/shared/locales/en/options.json)).
- No levels and no filter lists. Exceptions are one list: "These sites will not be enhanced by
  Privacy Protection."

### Chrome: Privacy and security

- Rows: Delete browsing data, Privacy Guide, Third-party cookies, Security, Site settings
  ([privacy_page.html, Chromium](https://github.com/chromium/chromium/blob/main/chrome/browser/resources/settings/privacy_page/privacy_page.html)).
- Level on its own sub-page: Security offers "Enhanced protection", "Standard protection", "No
  protection" ([Chrome Help: Safe Browsing](https://support.google.com/chrome/answer/9890866?hl=en)).
- Defaults and per-site exceptions both live under Site settings. Per-site changes are also made
  from "View site information" on the site
  ([Chrome Help: site permissions](https://support.google.com/chrome/answer/114662?hl=en)).

### What the comparison shows

| | Level shown where | Filter lists | Per-site exceptions |
|---|---|---|---|
| uBOL | Settings tab, once | own tab, no level control | popup; list in Develop |
| AdGuard | no level | own screen, grouped by role | Allowlist screen |
| Ghostery | three main switches | sub-page of Privacy protection | Websites screen, all adjustments |
| Brave | top of Shields | sub-page of Shields | Shields panel on the site |
| DuckDuckGo | none | none | Unprotected Sites list |
| Chrome | Security sub-page | n/a | Site settings |

- Nobody shows the level twice. Where lists sit near the level, the list page links back rather
  than repeating the control (uBOL, Brave).
- Ghostery and Chrome gather every kind of per-site change in one place. Moat splits them over
  three screens and the popup.

## 4. Principles from authoritative sources

- **Two levels of disclosure at most.** "Designs that go beyond 2 disclosure levels typically have
  low usability." Put up front "everything that users frequently need"
  ([Nielsen, Progressive disclosure](https://www.nngroup.com/articles/progressive-disclosure/)).
  On phones Moat has page, then Advanced, then "Show all lists": three.
- **Hide only when it's worth it.** "Use 'Advanced' only when there are at least 3 items to
  hide." Keep 10-15 items per screen at most; frequent settings at the top
  ([Android settings guidelines](https://source.android.com/docs/core/settings/settings-guidelines)).
- **One home per setting, several entry points.** "For duplicate settings, create a separate
  screen for the setting and have entry points from different places" (same page).
- **Cross-list only when users really look in two places.** Polyhierarchy suits items users seek
  under more than one parent, but exhaustive cross-listing adds "significant cognitive strain"
  ([NN/g, Polyhierarchies](https://www.nngroup.com/articles/polyhierarchy/)).
- **Keep names and navigation consistent** ([Nielsen, Top 10 IA mistakes](https://www.nngroup.com/articles/top-10-ia-mistakes/)).
- **Group by the user's model, then test it.** Card sorting finds groups "that make the most
  sense" to participants; open sorts with 15+ people for reasons, 30-50 for numbers
  ([NN/g, Card sorting](https://www.nngroup.com/articles/card-sorting-definition/)).
- **Few settings, good defaults, task options in context.** "Minimize the number of settings you
  offer." Prefer letting people change task options "in the screens they affect". A macOS
  settings window uses a stable toolbar of panes, "each contain[ing] a group of related settings"
  ([Apple HIG, Settings](https://developer.apple.com/design/human-interface-guidelines/settings)).
  For Moat this backs the popup as the place for per-site changes, with Settings as the review
  list.

## 5. Proposed structure

Nine sidebar items, same as today. Three groups.

```
Overview                                   #overview
  Week card, level card, quick actions (unchanged)
  Trackers this week (unchanged)
Protection
  Blocking                                 #blocking   (renamed from "Blocking level")
    How much to block: level cards  (only place to pick a level)
      under the cards: "Choose lists yourself →" link to #filters
    Annoyances: cookie banners, gray video ads, sponsored posts, low-quality search results
  Privacy                                  #privacy
    Tracking: third-party cookies, trackers in disguise (CNAME), Firefox FPI
    Your device: fingerprint (+ new disguise each restart), Firefox RFP, IP leaks
    Permissions and passwords: surprise permission requests, breach check
  Filter lists                             #filters
    Level line: "Using Balanced · Change" (link to #blocking) or "Custom mix · Reset to Balanced"
    Budget bar and warning; list switches; Check for filter fixes
Your exceptions
  Sites                                    #paused     (renamed from "Paused sites")
    Paused: list + "Pause Moat on a site" box
    Changed for one site: list of popup overrides, each with Reset   (new)
    Camera, mic and location allowed: link to browser site settings  (new, optional)
  Hidden on pages                          #hidden     (unchanged)
  Always and never block                   #rules
    Always block, Never block
Settings
  Backup and import                        #backup     (renamed from "Backup and sync")
    Save / restore, Sync across devices, Import from another blocker
  About Moat                               #about      (unchanged, incl. keyboard shortcut)
```

Phone order: Blocking (level, Annoyances), Sites, Hidden on pages, then Advanced: Privacy, Filter
lists, Always and never block, Trackers, Backup and import, About. That matches the sidebar except
for what sits above the Advanced button.

### Moves, reasons, and what each touches

| # | Move | Why | Code it touches | Risk |
|---|---|---|---|---|
| M1 | Pause box from Rules to Paused sites | one task, one screen (problem 3) | `options.html:2483-2489` card into section at `2372`; ids `add-input`, `add-button` stay; lead `optionsExceptionsHint` in 4 locales | low |
| M2 | Drop level pills from Filter lists; add a level line with a link | one home per setting (problem 1) | `options.html:2439-2446`; preset handlers and `PRESET_HINTS` near `options.ts:885-910`; `filters-locked-badge` needs a new spot; `levelCustomNote` text (problem 2) | **owner**: Essential needs a home (4th card, or only via "Reset to…") |
| M3 | "Features" becomes "Annoyances"; search-results row joins it; breach check moves to Privacy | screens match the code's own groups (problem 5) | `FEATURE_IDS`, `options.ts:400`; `renderProtectionGroups`, `813-829`; `featuresTitle`/`featuresLead`; test `options.render.test.ts:79` expects 4 rows | **owner**: breach check leaves the phone's first screen |
| M4 | Sub-headings inside Privacy | long flat list (problem 6) | `renderProtectionGroups` builds 3 groups; reuse `.sub-h`; new strings | low |
| M5 | "Changed for one site" list on Sites | orphaned data (problem 4) | new renderer reading `settings.perSiteOverrides`; reset via existing `set-per-site-override` with `null`; nav count in `dashboard.ts:80-86` | **owner**: new feature, not a move |
| M6 | Import from another blocker to Backup | one-off move-in task (problem 8) | `options.html:2513-2527` into section at `2555`; ids stay; tests at `options.render.test.ts:227-262` use ids only | low |
| M7 | One label for the update check | problem 9 | `optionsCheckForUpdatesLink` → reuse `aboutCheckFixes` | low |
| M8 | Align sidebar names and section headings | problem 10 | `advRulesTitle`, `advPrivacyTitle`, `optionsExceptionsTitle`, `navPaused`, `navBlockingLevel`, `tabBackup` in 4 locales | low; renames need owner sign-off |
| M9 | Phone order: Privacy before Filter lists | problem 11 | swap the two panels inside `#advanced` (`options.html:2427-2474`); update `advancedButtonHint` | low |
| M10 | Trackers on phones | problem 7 | option A: leave it; option B: move its panel out of `#advanced` to the end of the main page | **owner** |

Things that need no change: hash keys stay (`#paused` etc.), so old links and `dashboard.ts`
keep working. Settings search builds its index from the DOM (`settingsSearch.ts:29-42`), so moved
rows are found where they land. The popup opens Settings without a deep link (`popup.ts:339-342`).

Not proposed: moving the keyboard shortcut out of About. It is one control, and Chrome manages
shortcuts in its own page anyway. Not proposed: making Filter lists a sub-page of Blocking as
Brave and Ghostery do. It would save a sidebar slot but add a third disclosure level on phones.

Before building M2, M3 and M5, a small closed card sort (the nine screen names as categories, 30
or so setting cards) would test the grouping cheaply (see NN/g above).

## 6. The empty right column at wide widths

At 1280px and up, screens that have a "How it works" picture use a two-column grid:
`minmax(0, 760px) 320px`; Overview and About use one column up to 1120px
(`options.html:1865-1871`, `1908-1913`). The panel is about 390px tall, but the screens run up to
about 1900px. So most of the right column is empty, and content width jumps between screens.
The owner finds this odd.

What sources say:

- Cloudscape's help panel is one per page, closed by default, and opened by an info link
  ([Cloudscape help panel](https://cloudscape.design/components/help-panel/?tabId=usage);
  see also `settings-icons-and-help-2026-09.md`).
- In Cloudscape's app layout the help panel lives in a tools drawer with an open/closed state
  (`toolsOpen`: "State of the tools drawer"). Content width is its own setting, `maxContentWidth`
  ([app-layout interfaces.ts](https://github.com/cloudscape-design/components/blob/main/src/app-layout/interfaces.ts)).
  So the page does not reserve a column for help that isn't open.
- Android puts an explanatory animation "at the top of the screen", in the flow, not beside it
  ([Android settings guidelines](https://source.android.com/docs/core/settings/settings-guidelines)).
- Apple asks for a stable settings window, which argues for one content width across panes
  ([Apple HIG, Settings](https://developer.apple.com/design/human-interface-guidelines/settings)).

Recommendation:

1. Use one content width on every screen (for example 840px, or 760px if rows get too long to
   scan). Don't reserve a right column.
2. Open the picture on demand. Either a drawer that slides over the right edge when "How it
   works" is pressed (Cloudscape model), or inline under the row, which Moat already has for
   narrow widths (`.ex-inline-body`). Close it with Esc and return focus to the trigger.
3. If the owner wants the panel always visible, at least make it `position: sticky` so it follows
   the row being read. This fixes the empty look, but content widths would still jump between
   screens.

Code touched: the grid rules at `options.html:1865-1913`, `body.has-explainer` in
`explainerPanel.ts:348`, and the panel markup at `options.html:2285-2290`. Owner decision: drawer
vs inline vs sticky.

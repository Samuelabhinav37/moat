# Settings page: colourful nav icons and per-setting help (2026-09-28)

Input for the Settings page redesign. Two questions from the owner:

1. The sidebar icons are thin monochrome lines. He wants them "new and colorful".
2. Every setting row has a "▶ How it works" pill that opens an animated explainer in a side
   panel. The repeated pill looks bad.

Primary sources only: design-system docs, official guideline pages, and platform source code
where no written guideline exists. Where no primary source could be found, this note says so.

## 1. Colourful navigation and settings icons

### Google: Material Design 3

- Nav drawer icons are optional. If used, "they should always be placed before text", and
  "Icons should be used for all destinations, or none." Use "recognizable icons when conventions
  exist" ([M3 navigation drawer guidelines](https://m3.material.io/components/navigation-drawer/guidelines)).
- M3 gives no rule for per-category colour on nav icons. Its drawer spec defines one icon colour
  for all items plus a selected state
  ([M3 navigation drawer specs](https://m3.material.io/components/navigation-drawer/specs)).
- Colour roles come in pairs that "provide an accessible minimum 3:1 contrast". "On" roles are
  for "text or icons on top of its paired parent color". Container roles "should not be used for
  text or icons" ([M3 color roles](https://m3.material.io/styles/color/roles)).
- Icon grade should drop to -25 for a light icon on a dark background, so light glyphs do not
  look heavier than dark ones ([M3 applying icons](https://m3.material.io/styles/icons/applying-icons)).
  The same page warns that colour meaning varies by culture (red vs green for warnings).
- List rows: "A leading icon should provide a quick visual cue that relates to the item's label
  text, helping people scan the list." Supporting text is limited to one to three lines. Use
  switches "to toggle settings on or off"
  ([M3 lists guidelines](https://m3.material.io/components/lists/guidelines)).

### Google: Android Settings (AOSP)

- The written guideline treats row icons as optional: "Using an icon is optional." It says
  nothing about icon colour or shape
  ([Android settings design guidelines](https://source.android.com/docs/core/settings/settings-guidelines)).
- No written guideline was found for the colourful homepage icons. The AOSP source shows how they
  are built. Each homepage icon is a solid-colour adaptive-shape tile with a white glyph on top
  (`AdaptiveIconShapeDrawable` + `ic_settings_wireless_white`)
  ([ic_homepage_network.xml, android12-release](https://github.com/aosp-mirror/platform_packages_apps_settings/blob/android12-release/res/drawable/ic_homepage_network.xml)).
- Each category has its own flat colour, no gradients: network `#2196F3`, battery `#258982`,
  display `#FFA727`, security `#0F9D58`, storage `#C14CE6`, and so on
  ([colors.xml, android12-release](https://github.com/aosp-mirror/platform_packages_apps_settings/blob/android12-release/res/values/colors.xml)).
  The same values are still in `android13-release`.
- White-on-tile contrast in that palette is often low. Computed with the WCAG formula: display
  `#FFA727` 1.94:1, connected devices `#72B70F` 2.47:1, apps `#FF7E0F` 2.55:1, network `#2196F3`
  3.12:1, battery `#258982` 4.22:1, generic `#1A73E8` 4.51:1. So copying Android's palette as-is
  would fail the 3:1 non-text contrast bar for several tiles (see accessibility below).
- The GitHub repo is AOSP's read-only mirror. The canonical host,
  android.googlesource.com, returned HTTP 503 at the time of writing.

### Google: Chrome settings

- Chrome's settings sidebar is monochrome. Every nav item uses one icon colour token,
  `--color-settings-nav-menu-item-icon`, and the selected item switches to the selected
  foreground colour
  ([settings_menu.html, Chromium](https://github.com/chromium/chromium/blob/main/chrome/browser/resources/settings/settings_menu/settings_menu.html),
  last changed 23 Sep 2026).
- No written Chrome design guideline for this was found. Google Account was not checked in
  source form and has no public design guideline.

### Apple: Human Interface Guidelines

- Sidebars: "Make sure any sidebar icon colors you choose serve a clear purpose." By default
  sidebar icons use the app's accent colour. On macOS, people expect all sidebar icons to follow
  the accent colour they choose. "If you use them sparingly, fixed colors can help clarify the
  meaning of an icon or draw attention to it", for example Mail's yellow VIP icon
  ([HIG sidebars](https://developer.apple.com/design/human-interface-guidelines/sidebars)).
- Interface icons "typically [use] streamlined shapes and touches of color". All icons need "a
  consistent size, level of detail, stroke thickness (or weight), and perspective"
  ([HIG icons](https://developer.apple.com/design/human-interface-guidelines/icons)).
- SF Symbols has four rendering modes. Multicolor "applies intrinsic colors to some symbols to
  enhance meaning" (green leaf, red for data loss). Check each mode for legibility at its size
  and against its background
  ([HIG SF Symbols](https://developer.apple.com/design/human-interface-guidelines/sf-symbols)).
- Colour: "Avoid using the same color to mean different things." Don't rely on colour alone to
  "differentiate between objects". Colours must work in light, dark and increased-contrast modes
  ([HIG color](https://developer.apple.com/design/human-interface-guidelines/color)).
- iOS Settings and macOS System Settings use coloured rounded-square tiles. No HIG page describes
  or recommends that pattern for third-party apps. The HIG settings page covers what settings to
  offer, not how they look
  ([HIG settings](https://developer.apple.com/design/human-interface-guidelines/settings)).

### Microsoft: Fluent 2 and Windows

- Fluent 2: "Adding color to an icon may disrupt its visual balance so consider carefully before
  using color on an icon." And: "If including color on an icon, only use one color and keep
  contrast in mind." Regular icons are for wayfinding. Filled icons mark selection or add weight
  at small sizes ([Fluent 2 iconography](https://fluent2.microsoft.design/iconography)).
- Windows: use system icons (Segoe Fluent Icons, monoline) "for items like command bars,
  navigation, or status indicators"
  ([Iconography in Windows](https://learn.microsoft.com/en-us/windows/apps/design/iconography/)).
- Windows colour is "a calming foundation, subtly enhancing user interactions and emphasizing
  significant items only when necessary". Accent colours "are used sparingly". Avoid red and green
  as "the sole differentiator"
  ([Color in Windows](https://learn.microsoft.com/en-us/windows/apps/design/signature-experiences/color)).
- The Windows 11 Settings app uses full-colour nav icons. No Microsoft page documenting that
  choice was found. The Windows icon docs only describe the monochrome system font and app icons
  ([Icons in Windows apps](https://learn.microsoft.com/en-us/windows/apps/develop/ui/controls/icons),
  [App icons](https://learn.microsoft.com/en-us/windows/apps/design/iconography/app-icons)).

### Amazon: Cloudscape

- Icons are 2px-stroke line icons. Custom SVGs must drop inline `fill` and `stroke` so the system
  can set the colour by context
  ([Cloudscape iconography](https://cloudscape.design/foundation/visual-foundation/iconography/)).
- Side navigation: "Don't add icons purely for decoration." Give "every sibling in that level an
  icon". "Don't reuse the same icon for multiple links." Icons are mainly for the collapsed rail,
  where they act as identifiers
  ([Cloudscape side navigation, usage](https://cloudscape.design/components/side-navigation/?tabId=usage)).
- No coloured-icon guidance exists in Cloudscape. No official Amazon app guideline was found.

### What the sources agree on

- Monochrome is the default in every design system (M3, Fluent 2, Cloudscape, Windows, Chrome).
- Where colour appears in shipped settings (Android, iOS, Windows 11), no written guideline
  backs it. The only construction detail found is Android's: solid flat colour per category,
  white glyph, same shape for every tile.
- Every system asks for consistency: all items get an icon or none, and all share one size,
  stroke and style.
- None of the sources recommend gradients on icons. Fluent says to use one colour at most.

## 2. Per-setting help without cluttering every row

### Cloudscape: help system (the most complete written pattern)

- Help is a "content ramp" with three tiers: UI text (headers, descriptions), then the help
  panel, then external docs. Descriptions should "Only share information necessary for the user
  to inform their action"
  ([Cloudscape help system](https://cloudscape.design/patterns/general/help-system/)).
- Info links "should be always anchored to headers or form field labels". "Always place info
  links next to the appropriate header rather than descriptions or other elements" (same page).
- The info link text is "Info". It is "technically a button" that opens the help panel. "You
  can have more than one info link on a page, but use them sparingly to avoid overwhelming the
  user" ([Cloudscape link, usage](https://cloudscape.design/components/link/?tabId=usage)).
- One help panel serves the whole page. It is closed by default. Its header "must match the topic
  header of the Info link". Don't use it for step-by-step task guidance
  ([Cloudscape help panel, usage](https://cloudscape.design/components/help-panel/?tabId=usage)).
- Default panel content is page-level help. Reopening the panel shows what it showed last. Don't
  ship an empty help panel ([Cloudscape help system](https://cloudscape.design/patterns/general/help-system/)).

### Android Settings

- For features that need explaining: "You can use an animation or image along with text. The
  animation or image should be presented at the top of the screen, while the footer text can be
  used to add an explanation." Row subtext should show the setting's status, not restate the
  title. "Using links in settings is not recommended." Hide rarely used settings under "Advanced"
  when at least three items qualify
  ([Android settings design guidelines](https://source.android.com/docs/core/settings/settings-guidelines)).

### Material Design 3

- Plain tooltips label icon-only controls and "aren't needed when the UI element already has
  label text". Rich tooltips suit "definitions or explanations". "Don't hide critical information
  within tooltips" ([M3 tooltips guidelines](https://m3.material.io/components/tooltips/guidelines)).
- Tooltips can open on hover or focus. "Avoid trapping screen reader and keyboard focus on rich
  tooltips" ([M3 tooltips accessibility](https://m3.material.io/components/tooltips/accessibility)).

### Apple HIG

- macOS help button: "Include no more than one help button per window. Multiple help buttons in
  the same context make it hard for people to predict the result of clicking one." In a settings
  pane it goes in the lower-left or lower-right corner. It should open the help topic for the
  current context ([HIG buttons](https://developer.apple.com/design/human-interface-guidelines/buttons)).
- Tooltips: "Describe only the control that people indicate interest in." Avoid repeating the
  control's name. Keep to 60 to 75 characters. Contextual help should be "easy for people to
  dismiss or avoid". Tips suit features of three steps or fewer
  ([HIG offering help](https://developer.apple.com/design/human-interface-guidelines/offering-help)).
- No iOS "info button" guidance was found on the HIG buttons page.

### Fluent 2

- Info label = label + info button that opens a popover. "Avoid cluttering an interface with
  multiple info labels, as this can result in cognitive overload." "Don't repeat information
  that already appears in visible labels." "Don't hide critical info in an info button." The
  button must be in the tab order, and its accessible name combines the label with "more
  information" ([Fluent 2 info label](https://fluent2.microsoft.design/components/web/react/core/infolabel/usage)).
- Tooltips are for non-essential plain text, not interactive content. Show them on hover or
  focus, and link them with `aria-describedby`
  ([Fluent 2 tooltip](https://fluent2.microsoft.design/components/web/react/core/tooltip/usage)).
- The teaching popover usage page returned 404 under both likely URLs, so it is not covered here.

### Not found

- No written guidance from Chrome or Google Account on explaining individual settings.

### What the sources agree on

- The row's own text does the first job. A one-line description is the right first tier
  (Cloudscape, Android, M3).
- Deeper help opens in one shared place: Cloudscape's single panel, Android's single animation
  at the top of the screen, Apple's one help button per window.
- Triggers are small and attach to the title or header, not the description or the control
  (Cloudscape). Several sources warn against repeating triggers everywhere (Cloudscape
  "sparingly", Fluent "avoid cluttering", Apple "no more than one").
- Nothing essential goes behind the trigger (M3, Fluent).

## 3. Implications for Moat

### Nav icons

- **Best fit: solid tiles, one flat colour per section, white glyph, same rounded shape for all.**
  This is the only colourful construction with a primary source behind it (AOSP homepage icons).
  It also keeps Apple's "consistent size, weight" rule and Cloudscape's "every sibling gets an
  icon".
- **Avoid gradient tiles.** No source recommends them, and Fluent says one colour at most.
  Gradients also make white-glyph contrast vary across the tile.
- **Tinted glyphs (coloured line icon, no tile)** are closest to Apple's sidebar default and
  Fluent's one-colour rule. But thin coloured lines on a dark background are the hardest to read
  (M3 grade note), and they add the least "colour", which is what the owner asked for.
- Give each colour one meaning and never reuse it for status (Apple colour rule). Moat already
  saves red and green for real semantic meaning. So keep those out of the tile palette, or use
  them only where they mean "blocked" or "allowed".
- Keep the text label next to every icon. Colour must not be the only way to tell sections apart
  (Apple, Windows).
- Selected state: don't signal it by tile colour alone. Add a row background or bold label, as
  Chrome and M3 do.

### Help trigger

- **Best fit: a small info icon (circled "i" or "?") right after the setting title, opening the
  existing side panel.** This matches Cloudscape's info link almost exactly: next to the header,
  one shared panel, panel title matching the row title.
- Put it only on rows that really need an explainer (Cloudscape "sparingly", Fluent "avoid
  cluttering"). Rows whose one-line description is enough get no trigger.
- A round play button before the switch puts help next to the control. It also looks like an
  action. No source places help triggers by the control. Cloudscape says to anchor them to the
  header.
- A preview thumbnail per row adds a visual to every row. That is the opposite of Android's "one
  animation at the top of the screen".
- A play badge on the row icon hides the trigger inside decoration. No source supports it. It
  would also fight Cloudscape's "don't combine multiple icons into one object or action"
  ([Cloudscape iconography](https://cloudscape.design/foundation/visual-foundation/iconography/)).
- Default panel content can be a short page-level intro, as Cloudscape recommends. That gives
  the panel a use before anyone clicks a row trigger.

### Accessibility checklist

- Tile and glyph contrast: aim for 3:1 minimum between glyph and tile, per
  [WCAG 2.2 SC 1.4.11 Non-text Contrast](https://www.w3.org/WAI/WCAG22/Understanding/non-text-contrast.html)
  and M3's 3:1 colour pairs. Check each tile colour. Android's own palette falls to 1.94:1 on
  amber, so pick darker, more saturated tile colours.
- The tile against the dark page background also needs to read as a shape. Check it at 3:1 or
  give it a subtle border.
- Don't rely on colour alone
  ([WCAG 2.2 SC 1.4.1 Use of Color](https://www.w3.org/WAI/WCAG22/Understanding/use-of-color.html),
  Apple, Windows).
- The info trigger must be a real `<button>` in the tab order. Give it an accessible name built
  from the row title, for example "Strict blocking: more information" (Fluent info label). Keep
  the hit target at 20×20 px or more (Fluent), or 24×24 px to meet
  [WCAG 2.2 SC 2.5.8 Target Size (Minimum)](https://www.w3.org/WAI/WCAG22/Understanding/target-size-minimum.html)
  without relying on spacing.
- If a hover tooltip labels the icon, it must also show on focus (M3, Fluent). It must be
  dismissible, hoverable and persistent per
  [WCAG 2.2 SC 1.4.13 Content on Hover or Focus](https://www.w3.org/WAI/WCAG22/Understanding/content-on-hover-or-focus.html).
- The panel must not trap focus, and focus should return to the trigger on close (M3 "avoid
  trapping" focus).
- The animated explainer should respect `prefers-reduced-motion`. That is standard web practice.
  No design-system page reviewed here states it for this pattern.
- Tile glyphs are decorative when the label is visible. Mark them `aria-hidden="true"`.

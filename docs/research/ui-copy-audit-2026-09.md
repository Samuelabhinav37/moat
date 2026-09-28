# UI copy audit (2026-09-28)

An audit of the English text people see in Moat. It covers the 573 keys in
`src/_locales/en/messages.json`, which include the uncommitted 0.11.166 `explainStep*` lines. It
also covers hard-coded text in the six HTML pages, the `tFallback`/`getMessageOrFallback`
strings in `src/options`, `src/popup`, `src/report`, `src/welcome` and `src/logger`, and the
element picker (`src/content/elementPicker.ts`).

Nothing here has been changed yet. Section 6 lists the rewrites in priority order.

## Standards used

- **Material Design 3.** "All text, including titles, headings, labels, menu items, navigation
  components, app bars, and buttons should use sentence-style capitalization." Avoid "e.g." and
  "etc." Leave out periods and other punctuation you don't need
  ([M3 UX writing best practices](https://m3.material.io/foundations/content-design/style-guide/ux-writing-best-practices),
  [M3 grammar and punctuation](https://m3.material.io/foundations/content-design/style-guide/grammar-and-punctuation)).
  These pages render with JavaScript and could not be fetched directly, so these points come
  from Google's search excerpts of the pages.
- **Apple HIG, Writing.** "Create a list of common terms, and reference that list to keep your
  language consistent." Buttons: "it's almost always best to use a verb." Settings: "Describe
  what it does when turned on, and people can infer the opposite." "If you need to direct
  someone to a setting, provide a direct link or button, rather than trying to describe its
  location." "Use possessive pronouns sparingly." Errors: "be clear about what someone can do to
  fix it", and avoid "robotic error messages … like 'Invalid name.'"
  ([HIG Writing](https://developer.apple.com/design/human-interface-guidelines/writing)).
- **Apple HIG, Menus.** "Append an ellipsis to a menu item's label when the action requires more
  information before it can complete"
  ([HIG Menus](https://developer.apple.com/design/human-interface-guidelines/menus)).
- **Microsoft Writing Style Guide.** Use contractions. "Default to sentence-style
  capitalization." Don't end headings with a period. Use the serial comma. "Most of the time,
  start each statement with a verb"
  ([Top 10 tips](https://learn.microsoft.com/en-us/style-guide/top-10-tips-style-voice)).
  Em dashes are allowed, but "don't overuse them" and use no spaces around them. Don't use
  "multiple hyphens in place of an em dash"
  ([Dashes](https://learn.microsoft.com/en-us/style-guide/punctuation/dashes-hyphens/)).
  Semicolons: "simplify the sentence" to remove them
  ([Semicolons](https://learn.microsoft.com/en-us/style-guide/punctuation/semicolons)).
  "In general, don't use an ellipsis"
  ([Ellipses](https://learn.microsoft.com/en-us/style-guide/punctuation/ellipses)).
  Don't use "a pop-up" as a noun. Say "pop-up window"
  ([pop-up](https://learn.microsoft.com/en-us/style-guide/a-z-word-list-term-collections/p/pop-up)).
- **Fluent 2.** Use second person. "Simplify jargon to be meaningful to a broad audience." Only
  use punctuation when you need it, and don't put periods on headers, buttons or labels
  ([Fluent 2 content design](https://fluent2.microsoft.design/content-design)).
- **Cloudscape.** Use sentence case. "Use end punctuation, except in headers and buttons." Don't
  use "please, thank you, ellipsis". "Avoid directional language." Use "choose or select not
  click". For empty states, "Don't repeat heading or button text in the description"
  ([Cloudscape empty states](https://cloudscape.design/patterns/general/empty-states/)).
- **GOV.UK.** "Try to split up sentences that are over 25 words long." If you use specialist
  terms, "you just need to explain what they mean." Use active voice
  ([Clear language](https://guidance.publishing.service.gov.uk/writing-to-gov-uk-standards/writing-guidelines/clear-language/)).
  "Avoid negative contractions like can't and don't." "Do not use semicolons." Don't use round
  brackets "to refer to something that could either be singular or plural." Use "and" instead
  of "&". Say "select" instead of "click"
  ([A to Z](https://guidance.publishing.service.gov.uk/writing-to-gov-uk-standards/style-guides/a-to-z-style-guide/)).
- **Chrome.** Chrome's own help and settings say "pop-ups", with a hyphen, in
  "Pop-ups and redirects" ([Chrome Help](https://support.google.com/chrome/answer/95472)).
- **Owner's rule.** Don't lean on any one punctuation crutch: em dashes, " -- ", semicolons or
  colon-then-reveal. Write plain, short sentences with no jargon. Name things the way users know
  them, not the way the system is built.

### Where the sources disagree

- **Contractions.** Microsoft and Fluent encourage them. GOV.UK says avoid *negative*
  contractions. Moat uses "Couldn't…" in 13 errors and also "doesn't", "isn't", "can't" and
  "won't". Recommendation: keep contractions, since that matches the friendly voice Microsoft,
  Fluent and Apple describe. Where a negative decides a choice, say it in full, for example
  "does not unblock the site".
- **Em dashes.** Microsoft allows them in moderation. The owner's rule says no. The owner's rule
  wins.
- **Ellipses.** Apple adds "…" to commands that need more input. Cloudscape bans them and
  Microsoft mostly does too. Moat uses the Apple convention. Keep it, but only where more input
  really follows. "Clear site data…" breaks Apple's own rule because it opens no further view.
  It just arms a second click.
- **"Click".** GOV.UK and Cloudscape say "select" or "choose". Apple says to name the right
  gesture for the device. Moat is a desktop extension, so "click" is accurate and fine.
- **"Your".** Fluent says use second person. Apple says use possessives sparingly. Moat has
  "Your exceptions", "Your own mix", "your own rules" and "Your browser vendor". Cut the ones
  that add nothing.
- **Serial comma.** Microsoft requires it and GOV.UK says nothing. Moat mixes both:
  `levelLightDesc` "ads, pop-ups, and scam…" vs `tourLegend1Sub` "ads, trackers and pop-ups".
  Pick one. This note uses no serial comma, because most strings already work that way.
- **Periods on headings.** Microsoft, Fluent and Cloudscape say no. Apple only says to be
  consistent. Moat's tour mixes both (see fix 33).

## 1. Consistency of terms

The same idea often has three or four names. The worst cases are pausing, hiding and the
blocking level, because those are the ideas people use most.

### Pause vs Never block (a real overlap, not only wording)

These are two different features. **Pause** (`buildPauseRule`, `allowAllRequests` for the site's
pages) turns Moat off on that site. **Never block** (`buildCustomAllowRules`) lets one address
load wherever it appears, while other ads on the page stay blocked. But the copy describes them
almost the same way:

- `pausedEmptyHint`: "Pause a site you trust to let its ads and trackers load. Known dangerous
  sites stay blocked."
- `optionsAllowedSitesHint`: "Never block these sites, even when a filter list matches. Known
  dangerous sites stay blocked."

Both sit on the same Block and allow page, one above the other (`advPauseSite` uses
`pausedEmptyHint` as its hint). Nothing tells a user which one to use. Say where each one
applies. Pause means "on this site's pages". Never block means "this address, on every site".
See fixes 21 and 22.

### "Popup" means two different things

The word means both an ad window and Moat's own toolbar panel. Examples are `popupPopups`
"Popups" (ads), `popupLoadError` "Try reopening the popup" (Moat) and
`optionsPermissionGuardMergedDesc` "Allow a site from the popup" (Moat). Users don't call the
panel a "popup". Name it by what they click: "Moat's icon".

### Proposed glossary

| Concept | One term | Where it varies now (keys) |
|---|---|---|
| Turn Moat off for one site | **Pause** / **Paused sites** / **Resume** | `tourLegend2Title` "Switch Moat off here"; `reportPausedHint` "Turn Moat back on"; `optionsImportChangeExceptions` "Site exceptions"; `navGroupExceptions` "Your exceptions"; `optionsExceptionsTitle` "Sites you've paused" vs `navPaused` "Paused sites"; `popupPausedSuffix` "see it unblocked" |
| Let one address load everywhere | **Never block** (use this for the button too) | `commonAllow` "Allow"; `advRulesTitle` "Block and allow" vs `navRules` "Always and never block" |
| Hide part of a page | **Hide** (verb), **Hidden items** | `popupBlockElement` "Block an element…"; `ovBlockElement` "Block an element"; `optionsPickElementButton` "Pick an element"; `optionsHiddenElementsTitle` "Things you've hidden" vs `navHidden` "Hidden on pages"; `toastRuleRemoved` "Removed an element"; `optionsPickElementFailed` "the picker"; `optionsImportChangeRules` "Custom rules" |
| Picker option to fade an item | **Gray out** | `optionsDimmedElementsTitle` "Grayed out"; `optionsNothingSelected` "Nothing selected yet." |
| YouTube ads that can't be blocked | **Dim** (a different verb from the picker's) | `optionsGrayscaleToggleHint` "grayed out"; `explainGrayscale`, `explainStepGrayscale2` "fades … to gray"; metric "dimmed" |
| Blocking level | **Blocking level** | `levelTitle` "How much to block"; `optionsIndividualListsHint` quotes "How much to block"; `pageLeadBlocking` |
| Custom level | **Custom** | `ovLevelCustom` "Your own mix"; `presetHintCustom` "A mix you've set up yourself"; `levelCustomNote` "your own mix of filter lists" |
| Level names | **Light, Balanced, Strict** | `presetEssential` "Essential" appears only on the Filter lists page and is never explained there; `popupProtectionLight` "Light tracking blocked" reuses a level name |
| What lists contain | **rules** | `aboutRulesUnit`, `advBudgetLine` "filter entries"; `explainLists` "shared blocklists"; `optionsLiveStatusOk` "domains"; `optionsLiveStatusFailed` "the built-in list" |
| Chrome's rule cap | **browser limit** | `popupBudgetNotice` "shared rule limit"; `optionsFilterBudgetDetail` "rule slots"; `optionsBudgetPercentUsed` "budget"; `advBudgetLine` "blocking rules in total" |
| Ad windows | **pop-ups** (Chrome's spelling) | `popupPopups` "Popups"; `presetHintEssential` "popups"; `extDescription` "popup/redirect tabs" |
| Moat's toolbar panel | **Moat's icon** | `popupLoadError`, `optionsPermissionGuardMergedDesc`, `tourPopupHint` "popup" |
| Cookie consent dialogs | **cookie banners** | `optionsConsentRejectToggleHint` "consent pop-ups"; `popupOverrideCookieBannerSub` "cookie pop-ups"; `levelStrictDesc`, `explainLevels`, `explainStepLevels1/4` "cookie notices"; `diagnosticsSilentConsent` "consent banner" |
| Cookie-banner feature name | **Reject cookie banners** | `popupOverrideCookieBanner` "Auto-reject cookie banners" vs `optionsConsentRejectToggleLabel` "Say no to cookie banners" |
| Third-party cookies | **cross-site cookies** (Firefox's term; Chrome says "third-party") | `levelStrictDesc`, `explainLevels` "third-party cookies" |
| Fingerprinting | **Stop sites recognizing your device** | `popupOverrideFingerprint` "Block fingerprinting"; `optionsFingerprintToggleLabel` "Block device fingerprinting"; `optionsFirefoxRFPCaution` "fingerprint protection"; `levelStrictDesc` "fingerprinting"; metric "randomised" |
| Harmful sites | **dangerous sites** (scams, fake login pages, malware) | `levelLightDesc` "scam and malware sites"; `levelBalancedDesc` "phishing sites"; `presetHintEssential` "known-malicious sites"; `explainPaused` "Known phishing and malware sites" |
| Web address | **site** (field label: "site address") | `optionsAddDomainInvalid`, `optionsAddDomainFailed` "domain"; `reportNeedSite` "site's address"; `reportIncludeUrl` "page address" |
| Filter-list refresh | **Check for updates** | `aboutCheckFixes` "Check for filter fixes" vs `optionsCheckForUpdatesLink` "Check for updates"; `optionsLiveStatusOk` "Last updated" vs `aboutFixesLast` "Last downloaded" |
| Problem report page | **Report a problem** | `footerReportIssue` "Report an issue" opens the same `report.html` |
| Low-quality results | **Hide low-quality search results** | `popupOverrideSeoSpam` drops "search" |

Spelling is mostly US, with some UK spellings mixed in: `optionsFingerprintDrawerDesc`
"recognise" and `optionsFingerprintMetricLabel` "randomised". The logger fallback also says
"randomising". The popup's own string says "recognize". Use US spelling everywhere.

## 2. Voice and tone

The copy is mostly good. It speaks to "you", uses active voice and contractions, and mostly uses
sentence case. Only one string goes over 25 words in a sentence: `optionsFilterBudgetWarning`,
with 29 words in its second sentence. Terms like DNR, CNAME and WebRTC never appear in the normal
UI. The problems are smaller ones.

- **Buttons that aren't verbs.** Picker: `pickerBigger` "Bigger", `pickerSmaller` "Smaller",
  `pickerJustOnce` "Just this time". Warning page: `warningSubmit` "Submit" is generic, so say
  what it sends.
- **Title case.** `tabCustom` "Custom Rules" is a dead key. Hard-coded titles: `options.html:6`
  "Moat Settings", `logger.html:25` "Moat Diagnostics" and `warning.html:6` "Moat — Site
  blocked". `tourMenuPinToolbar` "Pin to Toolbar", `tourMenuManageOne` and `tourMenuRemove` copy
  Firefox's real menu, so title case is right there. Filter list names such as "Cookie Notices"
  in `optionsFilterBudgetDetail` come from the ruleset manifest and are never translated.
- **Lowercase status words.** `popupProtected` "protected" and `popupPaused` "paused" are
  status labels, so they should start with a capital letter.
- **Directional words.** Cloudscape says avoid them. Examples: `popupOnboardingCard` "the switch
  below", `featuresLead` "the level you chose above", `optionsFirefoxRFPCaution` "fingerprint
  protection above", `aboutFlowsSome` "listed below", and `optionsFilterBudgetWarning` and
  `optionsFilterBudgetDetail` "a list below".
- **Telling people where to go instead of linking.** Apple says link instead.
  `levelCustomNote` says "Change it under Advanced settings." `optionsExceptionsHint` says
  "click Moat's icon while you're on it and flip the switch."
- **Jargon and where it is first explained:**

| Term | First seen | Explained? |
|---|---|---|
| element | `popupBlockElement` (popup, on every page) | No. It's a web-developer word. Use "something on this page". |
| filter list | `tourHow2Sub` (welcome) | Only in `explainLists`, behind a How it works button. OK in context. |
| fingerprinting | `levelStrictDesc` | No. The popup sub-line explains it, but Blocking level does not. |
| third-party cookies | `levelStrictDesc`, `explainLevels` | No. The Privacy row calls them "cross-site cookies". |
| phishing, malware | `levelBalancedDesc`, `levelLightDesc` | No. Use "dangerous sites". |
| content farm | `optionsSearchSlopDrawerDesc`, `explainSearchSlop` | No. |
| IP address, VPN | `optionsWebrtcToggleHint` | Partly. "video-call features" helps. Acceptable. |
| CAPTCHA | `optionsFingerprintCaution` | No, but widely known. Acceptable. |
| rule slots, budget, cap | budget strings | No. Use "browser limit" only. |
| permission guard | `popupPermissionGuardIntro` | No. It's an internal feature name. |
| embedded frame | `pickerKindFrame` | No. Use "Embedded content". |
| signed files, GitHub Pages | `optionsDisclosureUpdatesSent`/`Recipient` | Fine on About, which is for people who want details. |
| heuristics, content scripts, markup, unpacked builds, `onRuleMatchedDebug` | Diagnostics page (`logger.html`) | Fine for a diagnostics page. It is linked from About. |

## 3. Redundancy

The layers are page lead, row description, How it works caption, step lines and empty state.
Each layer should add something new. Right now several of them say the same thing.

- **"Known dangerous sites stay blocked"** appears in 5 places: `optionsExceptionsHint`,
  `pausedEmptyHint` (shown twice, on Paused sites and as the `advPauseSite` hint),
  `optionsAllowedSitesHint`, `explainPaused` and `explainStepPaused3`. Keep it once in the Paused
  sites lead and once in the caption and step pair. Drop it from the empty state.
- **Hiding.** `optionsHiddenElementsHint`, `hiddenEmptyHint`, `explainHidden`,
  `explainStepHidden1-3` and `tourLegend3Sub` all say "point, click, it's gone". The empty state
  should give only the next action. Cloudscape: don't repeat the heading or button in the
  description. The caption carries the "how".
- **Blocking level.** `ovLevelSub` "Applies to every site" and `levelLead` "This applies to every
  site you visit." say the same thing. Each level description already says what it adds, so
  `explainLevels` repeats all three. Keep the level descriptions and make the caption about the
  idea that each level contains the one before it.
- **Cookie banners.** `optionsConsentRejectToggleHint` "sharing as little as possible",
  `explainConsentReject` "picks the choice that shares the least" and `explainStepConsent2`
  "picks the choice that shares the least" are three versions of one sentence.
- **Permission guard.** `optionsPermissionGuardMergedDesc` and `explainPermissionGuard` are the
  same two sentences reworded.
- **Low-quality results.** `optionsSearchSlopCaution` "one click away behind a "Show" link" and
  `explainSearchSlop` "behind a Show link, so they're still one click away" say the same thing,
  and quote "Show" in one but not the other.
- **Backup.** `explainBackup` "a plain text file you can open and read" is repeated in the
  hard-coded `options.html:2565`.

The rule to adopt: the **row description** says what the setting does when on (Apple). The
**caption** says how it works, in one new fact. The **step lines** are short frame labels for the
animation and add no new facts. The **page lead** carries any caveat that covers the whole page,
once.

## 4. Punctuation crutches

Counts are for `en/messages.json`. Live means the key is used somewhere in `src`.

- **Em dash (3 live, 1 dead):** `warningLede` "…filter list — it's a domain…",
  `warningOverrideNote` "…for review — it does not unblock…", `optionsMigrationImportHint`
  "…or similar — blocked/allowed domains…". The dead one is `optionsDrawerBarsCaption`. There
  are also hard-coded ones: `warning.html:6` "Moat — Site blocked" and the logger fallback
  `diagnosticsOffTag` "— off".
- **" -- " (2 live, plus 1 in a fallback):** `popupUpdateSeparator` " -- " and
  `warningReportedError` "Couldn't send the report -- try again". The fallback is
  `optionsMigrationImportNothingNew` "Nothing new to add -- every recognized rule…". Microsoft
  says don't use hyphens in place of a dash.
- **Semicolons: 0.** Good.
- **Parentheses (9 live):** `optionsFilterBudgetDroppedBadge`, `optionsSyncStatusFailed`,
  `optionsLiveStatusOk`, `optionsLiveStatusFailed`, `optionsLiveStatusQuickFixes`,
  `optionsLiveStatusCosmeticFixes`, `optionsLiveStatusYoutubeFixes` ("fix(es)"),
  `optionsDisclosureUpdatesRecipient` and `reportNoteLabel`. Fallbacks also use "domain(s)",
  "line(s)" and "rule(s)" (`optionsMigrationImport*`). GOV.UK rules out singular-or-plural
  brackets. chrome.i18n has no plural support, so rephrase instead, for example "Extra fixes: 3".
- **Colon-then-reveal (4 live, excluding alt text):** `optionsFilterBudgetDropped` "…rule limit:
  $NAMES$.", `optionsFirefoxRFPToggleHint` "…on its own: window size, fonts…", `tourSeeLede`
  "loaded twice in Chrome: once on its own…" and `optionsDisclosureReportsSent` "Only when you
  press Send: the site…". Hard-coded: `popupPermissionGuardIntro` ends in a colon, and there is
  `options.html:2618` "Managed install: your organization…". The four tour alt texts
  ("weather.com without Moat: …") are fine as alt text.
- **Other:** " · " separators (`advTrackersSummary`, `optionsFilterMatchedOnPage`), slashes
  (`extDescription` "popup/redirect", `optionsMigrationImportHint` "blocked/allowed") and "&"
  (`categoryAds` which is dead, `optionsDisclosureBlockingName` "Blocking & filtering").

The es, fr and de files copied every crutch: 4 em dashes, 2 " -- " and 9 or 10 parentheses each.

## 5. Error, empty and confirmation messages

**Good ones:** `reportSendFailed`, `reportBusy`, `optionsSyncStatusFailed` (except for the
brackets), `diagnosticsMatchesEmpty`, `ovWeekEmpty` and `hiddenEmptyHint`. Each says what
happened and what to do next.

**Needs work:**

- `popupFreshStartConfirm` "Click again to clear" doesn't warn about the consequence. Clearing a
  site's cookies signs the user out. This is the most important confirmation in the popup.
- `popupFreshStartError` "Couldn't clear site data.", `optionsLoadListsError` "Couldn't load
  filter lists." and `optionsImportReadError` "Couldn't read that file." give no next step.
- `optionsAddDomainInvalid` "That doesn't look like a valid domain." is the kind of robotic
  message Apple warns about. `reportNeedSite` already has the better pattern: "Enter the site's
  address, like example.com."
- `optionsPickElementFailed` "Couldn't start the picker there." doesn't say why. The likely
  cause is a browser or store page, where extensions can't run.
- `reportInvalid` "Something in this report can't be sent." is vague.
- `optionsNoSitesAdded` "No sites added." and `optionsNothingSelected` "Nothing selected yet."
  give no next step. The second one sits under "Grayed out", where "selected" means nothing.
- `toastResumed` "Resumed $HOST$" reads like system talk. Say "Moat is back on for $HOST$."
- `popupLoadError` "Couldn't load status." "Status" is vague, and "popup" has the double-meaning
  problem described above.

## 6. Top 40 fixes

This list is ordered by how often people see each string: popup, then Overview, then Blocking
level, then Privacy, then the picker, then the welcome tour, then everything else.

| # | Key | Current | Problem | Suggested |
|---|---|---|---|---|
| 1 | `popupBlockElement` (+ `ovBlockElement`) | "Block an element…" | "Element" is jargon. "Block" clashes with the picker's "Hide". | "Hide something on this page…" |
| 2 | `popupPopups` | "Popups" | Doesn't match `ovKindPopups` "pop-ups" or Chrome's spelling | "Pop-ups" |
| 3 | `popupProtectionLight`/`Moderate`/`Heavy` | "Light tracking blocked" | "Light" is also a level name | "A few trackers blocked" / "Some trackers blocked" / "Lots of trackers blocked" |
| 4 | `popupOnboardingCard` | "…Use the switch below to pause it on a site, or Settings to fine-tune." | Directional word, and "fine-tune" is vague | "Moat blocks ads and trackers on every site. If a site breaks, pause Moat there with this site's switch." |
| 5 | `popupPausedPrefix`+`Suffix` | "Paused on " … ". Reload the page to see it unblocked." | One sentence split across two keys, so translators can't reorder it. "Unblocked" is vague. | One key: "Moat is paused on $HOST$. Reload the page to apply it." |
| 6 | `popupProtected` / `popupPaused` | "protected" / "paused" | Lowercase status label | "Protected" / "Paused" |
| 7 | `popupUpdatePrefix`+`Separator`+`LinkText` | "Updated to v" " -- " "see what's new" | " -- " crutch and three fragments | "Moat updated to version $VERSION$." plus a link: "See what's new" |
| 8 | `popupBudgetNotice` | "Some filter lists are off. The browser's shared rule limit is full." | "Shared rule limit" is jargon | "Some blocking is off. Your browser's limit for blocking extensions is full." |
| 9 | `popupPermissionGuardIntro` | "Moat's permission guard is blocking prompts on this site:" | Internal name and a colon | "This site asked for your camera, microphone or location. Moat stopped it." |
| 10 | `popupFreshStartConfirm` | "Click again to clear" | Hides the consequence | "Click again to clear. You'll be signed out of this site." |
| 11 | `popupFreshStartError` | "Couldn't clear site data." | No next step | "Couldn't clear this site's data. Reload the page and try again." |
| 12 | `popupFreshStartButton` | "Clear site data…" | The "…" doesn't lead to more input (Apple) | "Clear site data" |
| 13 | `popupOverrideCookieBanner` / `optionsConsentRejectToggleLabel` | "Auto-reject cookie banners" / "Say no to cookie banners" | Two names for one setting | Use "Reject cookie banners" in both places |
| 14 | `popupOverrideFingerprint` / `optionsFingerprintToggleLabel` | "Block fingerprinting" / "Block device fingerprinting" | Jargon, and two names | "Stop sites recognizing your device" in both places |
| 15 | `popupOverrideSeoSpam` | "Hide low-quality results" | Different from the Settings name | "Hide low-quality search results" |
| 16 | `popupLoadError` | "Couldn't load status. Try reopening the popup." | "Status" and "popup" | "Couldn't load this page's details. Click Moat's icon again." |
| 17 | `ovWeekLabel` | "ads and trackers stopped this week" | The breakdown under it also counts pop-ups | "ads, trackers and pop-ups stopped this week" |
| 18 | `ovKindUnsorted` / `popupUnsorted` | "$COUNT$ not sorted" / "not sorted yet" | Internal idea, and two wordings | "$COUNT$ other" in both places |
| 19 | `ovLevelCustom` (+ `presetHintCustom`) | "Your own mix" | The Filter lists page calls it "Custom" | "Custom" / "Filter lists you picked yourself." |
| 20 | `levelTitle` | "How much to block" | The nav says "Blocking level" | "Blocking level" (keep the nav, heading and Overview card the same) |
| 21 | `optionsAllowedSitesHint` | "Never block these sites, even when a filter list matches. Known dangerous sites stay blocked." | Reads the same as Pause | "Lets this address load on every site, even if a list blocks it. Other ads on the page stay blocked." |
| 22 | `commonAllow` (Never block button) | "Allow" | The list is called "Never block" | "Never block" |
| 23 | `levelLead` | "This applies to every site you visit. Balanced suits almost everyone. Choose Strict…" | Repeats `ovLevelSub` | "Balanced suits most people. Pick Strict for more privacy. Pick Light if sites keep breaking." |
| 24 | `levelStrictDesc` | "…plus cookie notices, social buttons, fingerprinting and third-party cookies. A few sites may not work right." | Jargon. It also leaves out that Strict turns on IP-address protection (`PRESETS.strict.webrtcLeakProtection`). | "Everything in Balanced, plus cookie banners and social media buttons. It also stops sites recognizing your device or following you between sites. A few sites may break." |
| 25 | `levelLightDesc` / `levelBalancedDesc` | "scam and malware sites" / "phishing sites" | Three words for one idea | "…and dangerous sites like scams and malware" / "…and fake login sites" |
| 26 | `explainLevels` | "…Strict also hides cookie notices and blocks third-party cookies." | Repeats the level descriptions and is incomplete | "Each level includes the one before it, then blocks a bit more." |
| 27 | `levelCustomNote` | "…Change it under Advanced settings." | Describes where instead of linking (Apple) | "You picked your own filter lists." plus a link: "Open filter lists" |
| 28 | `featuresLead` | "Extra protections that work on top of the level you chose above. Turn on the ones you want." | Directional word | "Extras that work with any level. Turn on the ones you want." |
| 29 | `optionsConsentRejectToggleHint` | "Answers consent pop-ups for you, sharing as little as possible." | Third name for cookie banners | "Picks the option that shares the least, so you don't have to." |
| 30 | `optionsGrayscaleToggleHint` / `explainGrayscale` | "…grayed out while they play." / "fades them to gray" | Mixes "dim", "gray out" and "fade", and "gray out" is also a picker feature | "Video ads Moat can't block are dimmed while they play." / "…Moat dims them while they play." |
| 31 | `optionsFingerprintDrawerDesc` / `optionsFingerprintMetricLabel` | "recognise" / "randomised" | UK spelling, and "randomised" is jargon | "Makes it harder for sites to recognize your device." / "sites that saw a disguised device this week" |
| 32 | `optionsCnameChromeDohHint` | "On Chrome, this checks disguised trackers using Cloudflare's public lookup service. It may miss the very first one it finds…" | 3 long sentences with a confusing middle | "On Chrome, Moat asks Cloudflare where hidden trackers point. It can miss the first one on a site. Firefox does this privately by itself." |
| 33 | `tourSeeTitle`, `tourPinTitle`, `tourPopupTitle` | "Moat is already on." etc. | Periods on headings, while `tourHowTitle` has none | Drop the period |
| 34 | `tourLegend2Title` | "Site broken? Switch Moat off here" | Should use "pause" | "Site broken? Pause Moat here" |
| 35 | `tourHow2Sub` | "Against about 310,000 rules from public filter lists like AdGuard's. Nothing is sent anywhere to decide." | A fragment, and the number is written into the string (it will go stale) | "It uses about $COUNT$ rules from public filter lists. Nothing leaves your device." |
| 36 | `pickerHint` | "Click anything to hide it. Esc to cancel." | The second sentence has no verb | "Click anything to hide it. Press Esc to cancel." |
| 37 | `pickerBigger` / `pickerSmaller` | "Bigger" / "Smaller" | Not verbs, and could be read as zoom | "Select more" / "Select less" |
| 38 | `pickerJustOnce` | "Just this time" | Not a verb | "Hide until reload" |
| 39 | `optionsAddDomainInvalid` | "That doesn't look like a valid domain." | Robotic message (Apple). "Domain" is jargon. | "Enter a site address like example.com." |
| 40 | `warningReportedError` / `warningLede` / `warningSubmit` | "…report -- try again…" / "…list — it's a domain…" / "Submit" | Crutches and a generic button | "Couldn't send the report. Try again in a moment." / "…This isn't one of Moat's lists. Your organization chose to block this site." / "Send to IT" |

Also worth doing but lower priority: `extDescription` "…silently closes popup/redirect tabs,
without nag screens." → "Blocks ads, trackers and pop-up tabs, with no nag screens." This is
the store listing. `footerReportIssue` → "Report a problem". `aboutCheckFixes` → "Check for
updates". `optionsFilterBudgetWarning` should be split so no sentence runs past 25 words.
`optionsLiveStatus*Fixes` should drop "fix(es)".

## 7. Translation impact (es, fr, de)

- All 573 English keys also exist in es, fr and de. **Every rewrite above changes a shared key**,
  so each one needs three translation updates.
- `src/_locales/localeParity.test.ts` checks only that keys and `$PLACEHOLDER$` tokens match. A
  reworded English string with old translations still passes CI. When the *meaning* changes
  (fixes 3, 5, 9, 10, 21, 24, 26), consider renaming the key so stale translations show up.
- Merging keys means adding the new key to all four files and deleting the old keys. This
  applies to fix 5 (`popupPausedPrefix`+`Suffix`) and fix 7 (the three `popupUpdate*` keys). Fix
  35 needs a new `$COUNT$` placeholder in all four files.
- The glossary changes spread widely. For example, "pop-ups" touches `popupPopups`,
  `presetHintEssential` and `extDescription`, and "dangerous sites" touches five keys.
- **Hard-coded English with no key at all.** No other language can show these today.
  - `options.html`: 2565 "Saves moat-settings.json…", 2618 "Managed install: …", 2583/2654
    "your browser vendor" / "Your browser vendor" (the capitalization differs between the two)
  - page `<title>`s in `options.html`, `logger.html` and `warning.html`
  - the `logger.html:360` note
  - `searchSlopFilter.ts:177` "Show"
  - logger `diagnosticsSilent*`, `diagnosticsOffTag`, `diagnosticsFiredTimes`,
    `diagnosticsLastAt` and `diagnosticsScopeNote`
  - options `optionsMigrationImport*` results, `commonNever`, `commonMozilla`/`Google`/
    `Firefox`/`Chrome`
- **Fallbacks have drifted from en.json.** Examples: `optionsCookiesToggleLabel` has the
  fallback "Stop sites tracking you across the web" but en.json says "Block cross-site cookies".
  The same kind of drift affects `optionsWebrtcToggleLabel`, `optionsCnameToggleLabel`,
  `optionsGrayscaleToggleLabel`, `optionsConsentRejectToggleHint` and
  `optionsLeakedPasswordCaution` ("hash"). `shared/heuristicScope.ts` repeats the old labels.
  `mockExtensionBrowser.ts` returns "" for every message, so tests and mock screenshots show this
  outdated copy.
- **61 keys in en.json are never used in `src`.** Examples: `optionsTagline`, `tabCustom`,
  `category*`, `optionsDrawer*`, `optionsBackup*`, `optionsCustomRulesDesc`. `extName` and
  `extDescription` are not in this count because the manifest uses them. That is 183 dead
  translations to keep up across es, fr and de. Delete them before retranslating anything.

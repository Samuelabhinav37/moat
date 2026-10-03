// Privacy page, layered: the answer first (an Apple-style privacy label), every connection in
// one table that opens for detail (Firefox's notice), what stays local, your choices, then the
// full text for anyone who wants every word. Content follows the repo's PRIVACY.md.
const I = {
  shield: '<path d="M12 3l7.5 3v5.5c0 4.7-3.2 8.3-7.5 9.5-4.3-1.2-7.5-4.8-7.5-9.5V6z"/><path d="M8.8 12l2.2 2.2 4.2-4.4"/>',
  nouser: '<circle cx="12" cy="8" r="3.5"/><path d="M5 20c1-4 4-6 7-6s6 2 7 6"/><path d="M4 4l16 16"/>',
  nochart: '<path d="M6 20V11M12 20V5M18 20v-6"/><path d="M4 4l16 16"/>',
  notarget: '<circle cx="12" cy="12" r="8.5"/><circle cx="12" cy="12" r="4"/><path d="M4 4l16 16"/>',
  download: '<path d="M12 4v11M7 10l5 5 5-5M5 20h14"/>',
  search: '<circle cx="11" cy="11" r="6.5"/><path d="M16 16l4 4"/>',
  key: '<circle cx="8" cy="15" r="3.5"/><path d="M10.5 12.5L19 4M16 7l2 2M13.8 9.2l2 2"/>',
  sync: '<path d="M20 11a8 8 0 00-14.5-4M4 13a8 8 0 0014.5 4M5 3v4h4M19 21v-4h-4"/>',
  flag: '<path d="M5 21V4M5 4h11l-2 4 2 4H5"/>',
  building: '<path d="M4 20.5V6l8-3v17.5M12 9h6a2 2 0 012 2v9.5M2.5 20.5h19M7.5 8.5h1.5M7.5 12h1.5M7.5 15.5h1.5"/>',
  sliders: '<path d="M4 7h9M17 7h3M4 17h3M11 17h9"/><circle cx="15" cy="7" r="2"/><circle cx="9" cy="17" r="2"/>',
  bars: '<path d="M6 20V11M12 20V5M18 20v-6"/>',
  eye: '<path d="M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12z"/><circle cx="12" cy="12" r="3"/>',
  trash: '<path d="M4 7h16M9 7V4.5h6V7M6.5 7l1 13h9l1-13"/>',
  off: '<rect x="2.5" y="7" width="19" height="10" rx="5"/><circle cx="8" cy="12" r="3"/>',
  box: '<path d="M4 7.5l8-4 8 4v9l-8 4-8-4z"/><path d="M4 7.5l8 4 8-4M12 11.5v9"/>',
  chev: '<path d="M9 6l6 6-6 6"/>',
  ext: '<path d="M14 4h6v6M20 4l-9 9M18 14v5a1 1 0 01-1 1H5a1 1 0 01-1-1V7a1 1 0 011-1h5"/>',
  lock: '<rect x="5" y="10.5" width="14" height="10" rx="2.5"/><path d="M8 10.5V8a4 4 0 018 0v2.5"/>',
};
const ic = (k, s = 20) => `<svg viewBox="0 0 24 24" width="${s}" height="${s}" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${I[k]}</svg>`;

// Every way Moat touches the network. [icon, name, what is sent, who receives it, when, state class, detail paragraphs]
const CONNECTIONS = [
  ["download", "Daily list updates", "Nothing about you", "GitHub Pages (a public file host)", "Once a day", "on",
    ["Moat downloads a few public files: fixes for broken filters and today's lists of phishing, malware and scam sites. It's a plain file download, like opening a web page.",
     "Every file is checked against a signature before Moat uses it. If the check fails, Moat keeps the lists it already has.",
     "GitHub sees your IP address, as with any web request. Nothing else is sent."]],
  ["search", "Catch hidden trackers", "Some web addresses your browser is about to load", "Cloudflare (on Chrome only)", "Off by default", "off",
    ["Some trackers hide behind a site's own address. To catch them, Moat asks where those addresses really point.",
     "Only addresses that look like part of the site you're on are checked, never your whole history. Nothing is checked on paused sites.",
     "Firefox does this through its own resolver, so nothing extra leaves your browser."]],
  ["key", "Warn about leaked passwords", "The first 5 characters of a scrambled password", "Have I Been Pwned", "Off by default", "off",
    ["When you type a password, Moat scrambles it on your device (SHA-1) and sends only the first 5 characters of the result.",
     "Have I Been Pwned answers with a list, and Moat checks for a match on your device. Your password and its full scrambled form never leave it."]],
  ["sync", "Settings sync", "Your Moat settings, no browsing data", "Your browser account (Google or Mozilla)", "Off by default", "off",
    ["Your settings are copied to your browser's own sync, under the account you're already signed into. Moat runs no server for this."]],
  ["flag", "Problem reports", "The site, what went wrong, your note, Moat's version and settings", "Moat's developer, privately", "When you press Send", "send",
    ["Nothing is sent until you press Send, and the report page shows you the whole report first.",
     "It includes the site's name (the full address only if you tick that box), the problem you picked, whether pausing helped, your note, Moat's version, your browser and its major version, your blocking level and which lists are on. Nothing else.",
     "It goes through a Cloudflare Worker that keeps no logs into a private GitHub repository only Moat's developer can read. Your IP address is used only to limit how many reports one address can send a minute."]],
  ["building", "Organization security events", "A category, risk level, time and blocked domain", "Your organization's own server", "Set up by your IT team", "org",
    ["This can't be turned on by a person. It only exists when an organization's device-management policy sets it up, pointing at that organization's own server, never Moat's developer.",
     "It never sends full addresses, page content or browsing history. If you installed Moat yourself, this doesn't apply to you."]],
];

const LOCAL = [
  ["sliders", "Your settings", "Lists, paused sites and when you paused them, your rules and hidden parts of pages."],
  ["bars", "This week's numbers", "What was blocked, on which sites and when, and which list stopped a whole page. Deleted after 14 days."],
  ["eye", "Everything Moat does on a page", "Blocking, hiding ads, rejecting cookie banners and the rest all happen in your browser."],
  ["trash", "Clear site data", "Deletes a site's cookies and storage on your device, only when you confirm twice."],
];

const CHOICES = [
  ["off", "Turn features off", "Every optional connection above is off by default and has a switch in Settings."],
  ["sync", "Keep settings on this device", "Leave Settings › Backup and sync › Sync off, and nothing leaves your browser."],
  ["trash", "Remove everything", "Removing Moat from your browser deletes its settings and numbers with it."],
];

export function buildPrivacyBody({ fullHtml, version, updated }) {
  const state = { on: "Always", off: "Off by default", send: "When you send", org: "Organizations only" };
  return `
<section class="pv-label" id="summary" aria-labelledby="pv-label-title">
  <div class="pv-badge">${ic("shield", 34)}</div>
  <div class="pv-label-text">
    <p class="pv-eyebrow">Privacy label</p>
    <h2 id="pv-label-title">Data not collected</h2>
    <p>Moat's developer doesn't collect anything about you or your browsing. Moat works inside your browser.</p>
  </div>
  <ul class="pv-facts">
    <li>${ic("nouser", 22)}<span><b>No account</b>Nothing to sign up for</span></li>
    <li>${ic("nochart", 22)}<span><b>No analytics</b>No usage tracking or crash reports</span></li>
    <li>${ic("notarget", 22)}<span><b>Never sold or shared</b>No ads, no data brokers</span></li>
  </ul>
</section>

<section class="pv-sec" id="connections">
  <div class="pv-h"><h2>Every connection Moat makes</h2><p>Six in total. Only the first is on by default, and it carries nothing about you.</p></div>
  <div class="pv-table" role="list">
    <div class="pv-head" aria-hidden="true"><span></span><span>What</span><span>What's sent</span><span>Who receives it</span><span>When</span><span></span></div>
    ${CONNECTIONS.map(([icon, name, sent, who, when, st, detail]) => `
    <div class="pv-item" role="listitem"><details class="pv-row">
      <summary>
        <span class="pv-ico">${ic(icon, 18)}</span>
        <span class="pv-name">${name}</span>
        <span class="pv-sent"><small>What's sent</small>${sent}</span>
        <span class="pv-who"><small>Who receives it</small>${who}</span>
        <span class="pv-when"><span class="pv-pill ${st}">${when}</span></span>
        <span class="pv-chev">${ic("chev", 16)}</span>
      </summary>
      <div class="pv-detail">${detail.map((p) => `<p>${p}</p>`).join("")}</div>
    </details></div>`).join("")}
  </div>
  <p class="pv-note">${ic("lock", 16)} Nothing else in Moat uses the network. The filter lists ship inside the extension.</p>
</section>

<section class="pv-sec" id="on-device">
  <div class="pv-h"><h2>What stays on your device</h2><p>Kept in your browser's own storage. Never synced unless you turn sync on, never sent.</p></div>
  <div class="pv-grid">${LOCAL.map(([icon, t, d]) => `<div class="pv-tile"><span class="pv-ico">${ic(icon, 18)}</span><b>${t}</b><p>${d}</p></div>`).join("")}</div>
</section>

<section class="pv-sec" id="choices">
  <div class="pv-h"><h2>Your choices</h2></div>
  <div class="pv-grid three">${CHOICES.map(([icon, t, d]) => `<div class="pv-tile"><span class="pv-ico">${ic(icon, 18)}</span><b>${t}</b><p>${d}</p></div>`).join("")}</div>
</section>

<section class="pv-sec" id="more">
  <div class="pv-h"><h2>Changes and questions</h2></div>
  <div class="pv-grid two">
    <div class="pv-tile"><b>When this changes</b><p>This page changes in the same update as any change to what Moat sends. Every edit is public in the project's history.</p><a href="https://github.com/Samuelabhinav37/moat/commits/master/PRIVACY.md" target="_blank" rel="noopener">See every change ${ic("ext", 12)}</a></div>
    <div class="pv-tile"><b>Questions</b><p>Open an issue on Moat's GitHub page, or use Report a problem in Moat.</p><a href="https://github.com/Samuelabhinav37/moat/issues" target="_blank" rel="noopener">Ask on GitHub ${ic("ext", 12)}</a></div>
  </div>
</section>

<section class="pv-sec" id="full">
  <details class="pv-full">
    <summary><span><b>Full policy text</b><small>Every word, including permissions and the technical details</small></span>${ic("chev", 16)}</summary>
    <div class="prose">${fullHtml}</div>
  </details>
</section>`;
}

export const PRIVACY_TOC = [["summary", "Privacy label"], ["connections", "Every connection"], ["on-device", "Stays on your device"], ["choices", "Your choices"], ["more", "Changes and questions"], ["full", "Full text"]];

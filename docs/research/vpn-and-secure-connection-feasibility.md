# VPN and Secure-Connection Feasibility for Moat

Researched 2026-08-25. This document investigates whether, and how, a Manifest V3
WebExtension like Moat could offer anything honestly describable as a "VPN," using
primary sources only (official Chrome extension API docs, MDN WebExtensions docs, the
named VPN providers' own support/developer pages, and platform VPN API references). It
does **not** re-describe Moat's existing architecture, and it makes **no build
recommendation** — it lays out what the platform APIs actually allow, how existing
"VPN extension" products are actually built, and what three realistic architecture
shapes would cost and require, so a decision can be made separately by someone who
reads this later.

The short version, stated up front and argued in detail below: a WebExtension can
point the browser at a proxy server. It cannot create a VPN. Those are different
capabilities, documented as different capabilities, and conflating them is the single
most common inaccuracy in how "VPN browser extension" products market themselves.

---

## 1. What a WebExtension can and cannot do under Manifest V3

### PAC scripts vs. `fixed_servers`

Chrome's `chrome.proxy` API exposes exactly one behavioral surface for setting a
proxy: `chrome.proxy.settings.set()`, which takes a `mode` of `direct`, `auto_detect`,
`pac_script`, `fixed_servers`, or `system`. In `pac_script` mode "the proxy
configuration is determined by a PAC script that is either retrieved from the URL
specified in the `proxy.PacScript` object or taken literally from the `data`
element"; in `fixed_servers` mode "the proxy configuration is codified in a
`proxy.ProxyRules` object" — i.e. a static per-scheme server assignment rather than a
script that can branch on the destination URL.
([chrome.proxy API reference](https://developer.chrome.com/docs/extensions/reference/api/proxy))
Firefox's `browser.proxy` API additionally exposes a third, more dynamic surface with
no Chrome equivalent: `proxy.onRequest`, a live per-request event "fired when a web
request is about to be made, giving the extension an opportunity to proxy it," whose
listener runs "before any of the `webRequest` events for the same request" and can
return a `ProxyInfo` object, an array of them (for failover), or a `Promise` resolving
to either.
([MDN: proxy.onRequest](https://developer.mozilla.org/en-US/docs/Mozilla/Add-ons/WebExtensions/API/proxy/onRequest))
MDN notes the specific advantage of this model: "the code that implements your proxy
policy runs in your extension's background script, so it gets full access to the
WebExtension APIs available to your extension (including, for example, access to your
extension's `storage` and networking APIs like `dns`)."
([MDN: proxy](https://developer.mozilla.org/en-US/docs/Mozilla/Add-ons/WebExtensions/API/proxy))

### Supported proxy schemes, and whether the browser-to-proxy hop can be encrypted

Chrome's `ProxyServer.scheme` field accepts five values: `"http"`, `"https"`,
`"quic"`, `"socks4"`, `"socks5"`, defaulting to `"http"` if unset.
([chrome.proxy: ProxyServer](https://developer.chrome.com/docs/extensions/reference/api/proxy))
Firefox's equivalent `ProxyInfo.type` field is more precisely documented per value:
`"direct"` (no proxy), `"http"` — "HTTP proxy (or SSL CONNECT for HTTPS)", `"https"` —
**"HTTP proxying over TLS connection to proxy"**, `"masque"` — "MASQUE proxy (tunnel
over QUIC as defined in RFC 9298)", `"socks"` — "SOCKS v5 proxy", and `"socks4"` —
"SOCKS v4 proxy."
([MDN: proxy.ProxyInfo](https://developer.mozilla.org/en-US/docs/Mozilla/Add-ons/WebExtensions/API/proxy/ProxyInfo))

This answers the specific question directly: **yes, the browser-to-proxy hop itself
can be encrypted, but only via the `https` scheme, not via a documented
"SOCKS5-over-TLS" variant.** Chromium's own design documentation for this scheme
(what it calls a "secure web proxy") is explicit that this is TLS to the proxy
itself, not just tunneled HTTPS traffic: "A secure web proxy is a web proxy that the
browser communicates with via SSL, as opposed to clear text," and "since the
communication between Chrome and the proxy uses SSL, next protocol negotiation will be
used."
([Chromium: Secure Web Proxy design doc](https://www.chromium.org/developers/design-documents/secure-web-proxy/))
Plain `"http"`-scheme proxying already tunnels HTTPS *site* traffic end-to-end via a
CONNECT request (per MDN's own gloss, "HTTP proxy (or SSL CONNECT for HTTPS)") — but
that only encrypts the site traffic *inside* the tunnel; it does not encrypt the
browser-to-proxy control channel the way the `https` scheme does. There is no `socks5`
variant that adds TLS to the browser-to-proxy leg in either API's documented scheme
list — SOCKS5 appears only as plain `socks5`/`socks` with no TLS-wrapped counterpart
alongside it. Firefox's `masque` scheme (QUIC-tunneled, per RFC 9298) is the newest
addition and is itself an encrypted transport by construction, but it is a distinct,
separately-specified proxy protocol, not a TLS wrapper on SOCKS5.

### Permissions required

Chrome requires only the `"proxy"` permission in the manifest — "You must declare the
`'proxy'` permission in the extension manifest to use the proxy settings API" — with
no additional host permissions documented for using `chrome.proxy.settings.set()`.
([chrome.proxy API reference](https://developer.chrome.com/docs/extensions/reference/api/proxy))
Firefox requires the `"proxy"` permission too, but *additionally* requires host
permissions for any URLs the extension wants to intercept via `proxy.onRequest`
("where you want to intercept requests, you also need host permission for the URLs of
intercepted requests"), and gates the whole `"proxy"` permission behind a manifest
`strict_min_version` of `"91.1.0"` or above.
([MDN: proxy](https://developer.mozilla.org/en-US/docs/Mozilla/Add-ons/WebExtensions/API/proxy))

### MV3-specific execution-context effects

This is a genuine, sourced architectural divergence between the two browsers that is
easy to miss:

**Chrome's `chrome.proxy` is purely declarative and has no per-request callback at
all.** Its only methods are `proxy.settings.get()` / `.set()` / `.clear()` (via the
shared `ChromeSetting` prototype) and its only event is `onProxyError`, which
"notifies about proxy errors." There is nothing resembling Firefox's `onRequest`.
Practically, this means Chrome's proxy configuration is applied by the browser's
network stack once set, and does **not** depend on the extension's service worker
being alive for any individual request the way a live callback would — the MV3
service-worker-lifecycle concern that affects `webRequest`-style blocking (per the
existing [ad-blocker architecture research](./ad-blocker-architecture-and-roadmap.md))
does not apply the same way to a `fixed_servers`/`pac_script` proxy config, precisely
because Chrome never re-invokes extension code per request to answer "which proxy for
this URL" — only the PAC script content itself (fetched or literal) is evaluated by
Chrome's own network stack.
([chrome.proxy API reference](https://developer.chrome.com/docs/extensions/reference/api/proxy))

**Firefox's `proxy.onRequest` is a live per-request callback, and Firefox's MV3
background-script model changed in a way that is relevant but not proxy-specific.**
Mozilla's own Extension Workshop states plainly that "MV3 removes support for
persistent background pages," replacing them with non-persistent "Event Pages" —
"using non-persistent background scripts significantly reduces your extension's use
of browser resources" — the same event-driven model change MV3 Chrome made with
service workers, just implemented differently (Firefox continues using
`background.scripts`/`background.page` rather than adopting
`background.service_worker`, which MDN confirms "is not supported" in Firefox).
([Firefox Extension Workshop: Manifest V3 migration guide](https://extensionworkshop.com/documentation/develop/manifest-v3-migration-guide/); [MDN: manifest.json background](https://developer.mozilla.org/en-US/docs/Mozilla/Add-ons/WebExtensions/manifest.json/background))
**No primary source found in this research states explicitly whether an unloaded
Firefox Event Page reliably wakes up in time to answer a live `proxy.onRequest` call
for the very request that would wake it**, as opposed to the well-documented general
behavior that event pages "are restarted automatically when [the browser] calls one
of their WebExtensions API events listeners." This is flagged as an evidence gap
rather than asserted either way — Moat would need to verify this behavior directly
against a real Firefox build before depending on `onRequest` for anything
correctness-sensitive, rather than trusting inference from the general event-page
model.

### The proxy-vs-VPN boundary, precisely

Chrome's full extension API surface is indexed at
[developer.chrome.com/docs/extensions/reference/api](https://developer.chrome.com/docs/extensions/reference/api).
That index does list one VPN-shaped API — `chrome.vpnProvider`, described as letting
an extension "implement a VPN client" — but it comes with a hard, explicit,
single-platform restriction stated on its own reference page: **"This API works only
on ChromeOS,"** available since Chrome 43, gated behind the `"vpnProvider"`
permission.
([chrome.vpnProvider API reference](https://developer.chrome.com/docs/extensions/reference/api/vpnProvider))
Its mechanism confirms it is a genuinely different capability class from
`chrome.proxy`: the extension calls `createConfig()`, then exchanges raw IP packets
with the OS via `sendPacket()` and the `onPacketReceived` event once ChromeOS reports
the VPN session `"connected"` — i.e. the extension is handed a real virtual network
tunnel *by ChromeOS itself* and becomes the userspace packet handler for it, rather
than the extension conjuring a tunnel into existence unassisted. It has no
counterpart on Windows, macOS, Linux, Android Chrome, iOS, or Firefox on any
platform — meaning it cannot be used by a cross-browser extension like Moat even in
principle, and even on ChromeOS it is ChromeOS's own network stack doing the actual
tunnel plumbing, not the extension.

Android's `VpnService`, by contrast, is what an *actual* platform VPN API looks like,
and the contrast is instructive. A VPN app's service "call[s]
`VpnService.Builder` methods to establish a new local interface" — a real TUN device —
by calling `addAddress()` ("the system assigns as the local TUN interface address"),
`addRoute()` (e.g. `0.0.0.0/0` "to accept all traffic"), and `establish()`. Before any
of this can happen, "the system displays a connection request dialog. The dialog
prompts the person using the device to confirm that they trust the VPN and accept the
request," triggered by `VpnService.prepare()`. The app must "protect the service with
the `BIND_VPN_SERVICE` permission so that only the system can bind to your service,"
and once active, "the status bar includes a VPN (key) icon" and a "non-dismissible
notification." Functionally, the app then "reads outgoing IP packets from the local
interface's file descriptor, encrypts them, and sends them to the VPN gateway" and
"writes incoming packets... to the local interface's file descriptor" — this is
**system-wide** traffic capture (all apps, not just one browser) unless the app
explicitly scopes it down via `addAllowedApplication()` / `addDisallowedApplication()`.
([Android: VpnService](https://developer.android.com/reference/android/net/VpnService); [Android: Support VPN connections guide](https://developer.android.com/guide/topics/connectivity/vpn))

The distinction this research needs to state plainly: **"the extension can point the
browser at a proxy" and "the extension operates a VPN" are different capabilities,
and no combination of documented WebExtension APIs collapses that difference.** A
proxy config (`chrome.proxy` / `browser.proxy`) changes where *this browser's*
requests go, application-layer, for the lifetime of that setting. A VPN
(`android.net.VpnService`, and by the same architectural pattern Windows'
WinTun/TAP-Windows-style virtual adapters, macOS/iOS's `NEPacketTunnelProvider` under
`NetworkExtension`, or ChromeOS's own `chrome.vpnProvider` plumbing) creates a
system-level virtual network interface that captures traffic below the
browser-vs-other-apps distinction entirely, requires explicit OS-level user consent
UI, and is not something any WebExtension API on Chrome (outside the ChromeOS-only,
non-cross-browser exception above) or Firefox exposes a path to create.

---

## 2. How existing products that market a browser "VPN" extension actually work

Findings differ meaningfully product to product — they are not generalized here.

### Cloudflare (1.1.1.1 / WARP)

**Cloudflare does not offer a browser extension for WARP at all.** Cloudflare's own
developer docs describe "the Cloudflare One Client" (formerly branded WARP) as a
native application with two components — a GUI control panel and a background
"WARP daemon/service" — that "encrypts and routes your device's internet and private
network traffic through Cloudflare, using the WireGuard or MASQUE protocol," with
platform-specific installer documentation for Windows, macOS, and Linux (mobile
clients are documented separately by Cloudflare as native iOS/Android apps, not
covered on this page).
([Cloudflare: About the Cloudflare One Client](https://developers.cloudflare.com/cloudflare-one/connections/connect-devices/warp/))
There is no mention of a browser-extension delivery form anywhere in Cloudflare's own
WARP/Cloudflare One documentation tree. (A third-party Chrome Web Store listing
literally named "warp" exists, but its own listing shows an unrelated individual
developer and an unrelated bookmark-management extension — it is not Cloudflare's
product and is irrelevant to this research.) Cloudflare's "VPN" is architecturally
the real thing — WireGuard/MASQUE tunnels via a native client — but it is
categorically not a browser extension, which makes it a useful contrast case rather
than a fourth "how the extension does it" data point.

### NordVPN

NordVPN's own support content is explicit that the browser extension and the full app
are different products with different scope. Their support page comparing the two
states of the extension: **"Secures only your browser traffic"** — contrasted with the
app's device-wide Kill Switch, which "prevent[s] your device from making unprotected
connections."
([NordVPN Support: Should I choose NordVPN app or NordVPN extension?](https://support.nordvpn.com/hc/en-us/articles/20321910029585-Should-I-choose-NordVPN-app-or-NordVPN-extension))
NordVPN's setup page for the extension itself describes its mechanism as routing
"traffic through the proxy server," i.e. a proxy-configuration model, and lists
extension-specific features (WebRTC blocking, split-tunnel exclusions, a browser-scoped
kill switch that blocks browser access on disconnect) that are consistent with an
extension operating entirely within the `chrome.proxy`/`browser.proxy` capability
envelope described in §1, not a system tunnel.
([NordVPN Support: What is a NordVPN browser extension and why do I need it?](https://support.nordvpn.com/hc/en-us/articles/20322621196945-What-is-a-NordVPN-browser-extension-and-why-do-I-need-it))
NordVPN's own support content also explicitly warns against running the app and
extension "simultaneously, as it causes connection interference" — consistent with
them being two independent, non-cooperating mechanisms rather than the extension being
a thin remote control for the app.

### ExpressVPN

ExpressVPN's extension is the one product among the four that is explicitly
documented as **two different architectures selectable within the same extension**.
Their own support page names the modes directly: **"Remote Control Mode"** requires a
native app — "To use Remote Control Mode, you need to download and activate at least
one of these ExpressVPN apps" — and in that mode the extension "Controls the
ExpressVPN desktop app. All internet traffic on your device is encrypted through a VPN
tunnel," i.e. the extension is a UI surface for a real, native, device-wide VPN it
does not itself implement. **"Proxy Mode,"** by contrast, needs no native app at all —
"You do not need to install the ExpressVPN app to use the browser extension in Proxy
Mode" — and "runs independently to the desktop app and provides limited privacy
protection. Only your browser traffic is encrypted."
([ExpressVPN Support: How to Use the ExpressVPN Browser Extension](https://www.expressvpn.com/support/vpn-setup/browser-extension-plugin/))
The extension's own permissions documentation corroborates the Remote Control
mechanism concretely: it requests the `nativeMessaging` permission, described as
"Used to securely communicate with the ExpressVPN desktop app" — i.e. Remote Control
Mode is built on the standard [native messaging](https://developer.chrome.com/docs/extensions/develop/concepts/native-messaging)
WebExtension capability to talk to the already-installed native VPN client, not on
any proxy or tunnel API run from inside the extension itself.
([ExpressVPN Support: Browser Extension Permissions](https://www.expressvpn.com/support/troubleshooting/expressvpn-browser-extension-permissions/))
ExpressVPN's own blog names this combination "the industry-first hybrid" browser
extension specifically because it can operate as "a browser-only proxy" and, when a
desktop app is present, hand off to "full VPN protection" — their own marketing frames
this as a genuine architectural first, which is a useful signal that the
proxy-plus-optional-native-app combination is not a solved, commoditized pattern
elsewhere in the market as of this writing.
([ExpressVPN blog: Hybrid VPN browser extension](https://www.expressvpn.com/blog/hybrid-vpn-browser-extension/))

### Proton VPN

Proton's own support documentation is direct about the extension being proxy-only and
weaker than the app by design, in a page literally titled "Browser extension
limitations": **"Unlike the full VPN app, which routes all your device's connections
through the same VPN tunnel, each instance of the browser extension creates a new
HTTPS connection"** — i.e. the extension's mechanism is an HTTPS-scheme proxy
connection per the `https` scheme described in §1, not a tunnel. Proton states the
extension "uses HTTPS to secure your browser's internet connections," and is explicit
that "connections made by your device's operating system, other apps, and browsers
not running the browser extension aren't encrypted or routed through Proton VPN's VPN
servers." Proton also documents the extension as fully standalone — "the browser
extension is a stand-alone product and doesn't require the Proton VPN app" — and
flags a fingerprinting-relevant limitation specific to the per-connection proxy model:
because "the browser extension creates a new HTTPS connection" per session rather than
one persistent tunnel, this makes browsing "slightly more vulnerable to
fingerprinting attacks than using the full VPN app." Proton's own conclusion: "you
should use our full VPN app if security is a high priority for you."
([Proton VPN Support: Browser extension limitations](https://protonvpn.com/support/browser-extension-limitations))

**Summary across the four:** Cloudflare has no browser extension at all — its "VPN" is
a native WireGuard/MASQUE client. NordVPN's extension is proxy-only with no
documented native-app cooperation. ExpressVPN's extension is dual-mode: a real,
optional bridge (via native messaging) to a native VPN app for full device-wide
protection, or a standalone browser-only proxy. Proton's extension is proxy-only and
its own documentation is the most explicit of the four that this is a materially
weaker guarantee than their real VPN app, down to naming a specific fingerprinting
tradeoff. None of the three that do ship a browser extension operate or terminate a
system-level VPN tunnel *from inside the extension itself* — the tunnel, where one
exists at all (ExpressVPN Remote Control Mode), is always the native app's job, reached
via native messaging, exactly as §1 predicts is the only path available given the
WebExtension API surface.

---

## 3. Realistic architecture options for Moat specifically

Moat is one maintainer, non-commercial, with no existing server infrastructure and no
native messaging host today. Three shapes are considered below, each against that
starting point.

### (a) Extension-only pass-through to a user-supplied third-party proxy/VPN endpoint

Moat configures `chrome.proxy.settings.set()` / `browser.proxy.settings` (or, on
Firefox, optionally `proxy.onRequest`) pointed at whatever proxy server details
(`host`, `port`, `scheme`) the user types into a settings UI — an account and backend
the user already has with some other provider entirely. Moat never operates, sees, or
routes traffic through any exit node it controls; it is purely a configuration
surface over an API that already exists and is already documented in §1, requiring
only the `"proxy"` permission (plus, on Firefox, host permissions for whatever the
user wants proxied).

**This is the only one of the three options directly buildable, by one maintainer,
entirely inside the existing WebExtension repo, using only already-documented,
already-stable APIs.** It requires no server Moat operates, no partnership, no
liability for traffic content (Moat's code never receives or forwards the traffic
itself — the browser's network stack talks directly to the user's own proxy per
§1's `fixed_servers`/`pac_script`/`onRequest` mechanisms), and no account system. Its
honest ceiling is exactly what §1 already established: it can encrypt the
browser-to-proxy hop if the user's proxy supports the `https` scheme (or Firefox's
`masque` scheme), and it can select `socks5`/`socks4` where the user's proxy is a
SOCKS endpoint — but it cannot itself add TLS to a SOCKS5 hop that the target proxy
doesn't already terminate in TLS by some other means, per §1's scheme-list finding.
It also inherits every limitation Proton VPN's own documentation names for its own
proxy-mode extension (§2): browser-only scope, not device-wide, and (if implemented
via a live per-request callback on Firefox) the same per-connection-fingerprinting
caveat Proton flags for its own extension.

### (b) Partnering with / reselling an existing proxy or VPN backend provider

This means Moat contracting with (or reselling access to) a company that operates
actual exit infrastructure — the same relationship NordVPN's and Proton's *own*
backend has to their *own* extensions, just with Moat standing in a customer/reseller
role rather than a first-party vendor role. Concretely this requires: an account
relationship and billing pipeline with the backend provider (none of the four
providers researched in §2 documents a self-serve wholesale/reseller API for their
consumer VPN backend — NordVPN, ExpressVPN, and Proton VPN's cited pages are all
end-user support content, not partner/reseller developer documentation, and no such
program page surfaced in this research for any of them); a support and abuse-handling
relationship, since Moat's users' traffic would now be flowing through a paid
commercial backend under Moat's arrangement; and a nontrivial trust/liability shift —
a non-commercial, one-maintainer open-source project would be the intermediary
responsible for a paid backend relationship covering other people's live traffic,
which is a materially different risk and support-burden profile than shipping a
build-time-compiled filter list, the risk profile Moat's other features (per the
[ad-blocker architecture doc](./ad-blocker-architecture-and-roadmap.md)) currently
operate under. No primary source among the four researched providers documents a
program shaped for a project like Moat to plug into as a backend; this option is
flagged as unresearched-because-evidently-not-offered rather than confirmed
impossible — a provider could in principle offer this, but this research surfaced no
public program for it from any of the four.

**This is not directly buildable by one maintainer inside the WebExtension repo** —
the blocking work (contracting, billing, support, abuse-handling, and finding a
provider that even offers this kind of relationship) is entirely outside the
repository and outside what a WebExtension's code can do regardless of maintainer
time, and nothing in §1 or §2 changes that calculus even if such a partnership were
secured — the extension-side mechanism would still be the same `chrome.proxy` /
`browser.proxy` configuration surface as option (a), just pointed at Moat-provisioned
credentials instead of user-supplied ones.

### (c) A native companion app or OS-level VPN profile

This is the ExpressVPN Remote Control Mode shape (§2): a genuinely separate native
application — reached from the extension, if at all, via
[native messaging](https://developer.chrome.com/docs/extensions/develop/concepts/native-messaging) —
that itself calls a real platform VPN API (Android `VpnService`, iOS
`NEVPNManager`/`NEPacketTunnelProvider` under `NetworkExtension`, or the Windows/macOS
equivalents) to establish an actual system-level tunnel, per the mechanism detailed in
§1's Android `VpnService` walkthrough.

This is **not a WebExtension feature at all** — it is a different project with a
different codebase, different install surface, and different distribution model:

- **Different codebase entirely.** A native VPN client is platform-specific systems
  code (Kotlin/Java against `VpnService` on Android, Swift against `NetworkExtension`
  on iOS/macOS, a Windows service against WinTun or a comparable virtual-adapter
  driver) — none of it is JavaScript/TypeScript running in a WebExtension context, and
  none of Moat's existing DNR-compilation, content-script, or cosmetic-filtering code
  is reusable for it.
- **Different install surface and store model.** It ships through each platform's
  native app store (Google Play, the App Store, direct Windows/macOS distribution)
  rather than the Chrome Web Store / addons.mozilla.org, each with its own review
  process, signing requirements, and update mechanism, entirely separate from Moat's
  existing extension packaging.
- **Real, ongoing operational cost regardless of who writes the client code.** Even a
  perfectly-written native client needs *something* to be the VPN gateway/exit node it
  tunnels to — this option does not eliminate the backend question in (b), it just
  adds a second, larger engineering surface (the native client itself) on top of it.
- **The only plausible code-sharing with the existing extension is shared blocklists**
  (the compiled filter data itself), not any of Moat's actual WebExtension
  architecture — the native app would need to independently reimplement or otherwise
  obtain a request-filtering mechanism, since MV3 DNR and WebExtension content-script
  cosmetic filtering are browser-extension-specific mechanisms with no native-app
  equivalent.

**This is categorically not buildable as an incremental addition to the existing
WebExtension repo by one maintainer** — it is a second product, in a second set of
languages, on a second set of distribution platforms, that additionally still
requires solving option (b)'s backend question (or requires the user to already have
their own, per option (a)'s pattern, just fed to a native client instead of the
extension's own `chrome.proxy` call).

---

## 4. Prior art for open-source ad-blocker + DNS/proxy privacy combos

### Is DNS-over-HTTPS something a WebExtension can configure?

No. Both browsers document DoH as a **browser-level, not extension-level**, setting.
Chrome's own help documentation describes "Use secure DNS" as a toggle under
Settings → Privacy and security → Security, defaulting to "automatic mode" (falls
back to unencrypted lookup on failure unless a custom provider is selected, in which
case it does not fall back), configurable per-device, and explicitly *not*
configurable at all "if your device is managed or parental controls are turned on."
([Google Chrome Help: Manage Chrome safety and security](https://support.google.com/chrome/answer/10468685))
Firefox's equivalent is documented at length in its own support knowledge base as a
browser preference set under Settings → Privacy & Security → DNS over HTTPS, backed
by Mozilla's **Trusted Recursive Resolver (TRR)** program — all of Firefox's DoH
preferences live under the `network.trr` prefix internally, and Mozilla requires any
DoH provider that can be selected in Firefox's UI to sign a "legally-binding contract"
limiting data retention and use.
([Mozilla Support: DNS over HTTPS (DoH) FAQs](https://support.mozilla.org/en-US/kb/dns-over-https-doh-faqs))

Checked directly rather than inferred: this research fetched **both** browsers' full
extension API indexes and confirmed neither lists a DoH-configuration surface.
Chrome's complete API index
([developer.chrome.com/docs/extensions/reference/api](https://developer.chrome.com/docs/extensions/reference/api))
lists exactly one DNS-shaped API, `chrome.dns`, whose own reference page states it is
"only available in Chrome Dev" (never stable) and that "there are no foreseeable plans
to move this API from the dev channel into Chrome stable" — and even in that
restricted form it exposes only a `resolve()` method, i.e. plain hostname-to-IP
lookup, with no mention of DoH, TLS, or any transport-security control.
([chrome.dns API reference](https://developer.chrome.com/docs/extensions/reference/api/dns))
MDN's complete WebExtensions API index
([developer.mozilla.org/.../WebExtensions/API](https://developer.mozilla.org/en-US/docs/Mozilla/Add-ons/WebExtensions/API))
lists the analogous `browser.dns`, described identically as enabling "an extension to
resolve domain names" via `browser.dns.resolve()` — again plain resolution, with no
DoH-adjacent method, property, or event anywhere in the index. Neither index lists
anything named `secureDns`, `doh`, `trr`, or similar. **The absence is confirmed by
directly enumerating both indexes, not inferred from silence elsewhere.**

This confirms and sharpens the framing given in the task: `chrome.dns`/`browser.dns`
are read-only hostname-resolution APIs, unrelated to the browser's *own* DoH transport
setting, which lives entirely in browser preferences/policy and has no extension
control surface on either browser. Moat's existing use of this API family is
consistent with that scope, not an exception to it: `src/background/cnameUncloak.ts`
calls `browser.dns.resolve(hostname, ["canonical_name"])` purely to read the CNAME
chain for a hostname the browser is already about to visit (CNAME-cloaking
uncloaking), and the file's own comments correctly frame this as unrelated to
encrypted DNS transport — "Firefox's own dns.resolve() already sits in front of the
OS/network DNS," i.e. Moat is asking Firefox's already-established resolver
(whatever transport it uses) a read-only question about an existing name, not
choosing or configuring how DNS queries are transported. `src/types.ts` documents the
same feature the same way: "Firefox-only real CNAME uncloaking via
`browser.dns.resolve()`."

### What this means for a Moat DoH feature

Given the confirmed absence of any extension-facing DoH-configuration API, the only
way a Moat feature could interact with encrypted DNS at all is the same one already
named as exploratory (not a default-yes candidate) in the
[ad-blocker architecture doc](./ad-blocker-architecture-and-roadmap.md#candidates-for-moat):
Moat's own background service worker/script issuing its own DoH `fetch()` calls to a
hardcoded resolver (e.g. Cloudflare's `1.1.1.1/dns-query`) as an *application-level*
HTTP request Moat makes on its own behalf — not configuring the browser's built-in DoH
setting, which stays entirely outside extension reach, but Moat separately doing its
own encrypted lookups for its own purposes (e.g. CNAME-chain inspection on Chrome,
where `browser.dns.resolve()` doesn't exist at all). This carries the same tradeoffs
already named there: which resolver to hardcode/trust, added per-navigation latency,
and sending every hostname Moat inspects to a third-party resolver as a side effect of
a privacy feature — worth restating here because it is the *only* DoH-adjacent lever
available to a WebExtension at all, given the confirmed API-index absence above.

---

## Terminology: what's honestly buildable, and what to call it

Given everything above, "VPN" is not an honest word for anything buildable inside
Moat's current WebExtension repo by its current maintainer. Every path in §1 and §3
that stays inside the WebExtension model tops out at **proxy configuration**:
pointing the browser at a server the user or a partner already operates, over
`chrome.proxy`/`browser.proxy`, with the scheme-level encryption ceiling documented in
§1 (an `https`-scheme or Firefox `masque`-scheme hop can be TLS/QUIC-encrypted
browser-to-proxy; a bare `socks5` hop is not). Nothing in the documented WebExtension
API surface creates a system-level virtual network interface, captures traffic outside
the browser, or requires the OS-level user-consent UI that real platform VPN APIs
(Android `VpnService`, and by the same pattern iOS/macOS `NetworkExtension`,
ChromeOS's own `chrome.vpnProvider`) mandate. Proton VPN's and NordVPN's own support
documentation independently describe their *own* browser-only proxy extensions using
exactly this more modest, more accurate vocabulary — "secures only your browser
traffic," "each instance of the browser extension creates a new HTTPS connection" —
reserving the word "VPN" specifically for their separate native apps.

More honest, available terminology for what §3's option (a) actually is: a **proxy
configuration UI** — or, borrowing the term of art the (self-hosted proxy /
self-hosted VPN) community already uses for exactly this shape, **"bring-your-own-proxy."**
Option (b) is **a hosted-proxy reseller relationship**, a business and support
commitment, not an engineering one, layered on top of the same proxy-configuration
mechanism. Option (c) is, honestly, **a second product** — a native VPN client, built
and distributed the way Android/iOS/desktop VPN clients are actually built and
distributed, that happens to be affiliated with Moat rather than being a feature of
it, exactly as ExpressVPN's own architecture (§2) demonstrates in production today.

# Enterprise web-access control: how it actually works, and what Moat is not

Researched 2026-08-29. This document answers a question from the project owner: *how do
enterprise organizations manage website surfing, how do they stop employees visiting
sites, how do they send logs to administrators, how do these systems work, and what is
Moat lacking?* It is written against primary sources -- vendor administration guides,
Chrome Enterprise policy documentation, IETF drafts and RFCs, Apple/Microsoft developer
documentation -- and is deliberately honest about the size of the gap between what Moat
is (one browser extension) and what an enterprise web-control programme expects.

Vendor product details drift fast in this space. Category names, policy knobs, connector
lists, and default behaviours change release to release; every vendor-specific claim
below carries the source it came from and should be re-checked before being relied on.
Confidence is flagged where a claim rests on secondary summary rather than a primary doc.

---

## 1. Enforcement architectures: where the control actually sits

Enterprise web control is layered. No single mechanism does the whole job; a typical
organisation runs three or four of the following at once, each covering a different slice
of the traffic path and a different failure mode of the others.

### 1.1 Secure Web Gateway (SWG) / forward proxy

A SWG is a forward proxy that every outbound web request is made to pass through, so it
can apply an allow/block/inspect decision before the request reaches the internet.
Gartner's own framing, quoted by multiple vendors, is that a SWG "acts as a checkpoint
preventing unauthorized traffic from entering an enterprise's network"
([Cisco, *What is SSE*](https://umbrella.cisco.com/secure-access-service-edge-sase/what-is-security-service-edge-sse)).
It sits **in the traffic path**, not on the endpoint's application layer, which is the
structural difference from a browser extension.

Traffic gets to the proxy one of several ways:

- **Explicit proxy** -- the browser or OS is configured with a proxy host:port, either
  by hand, by policy (`ProxySettings` in Chrome Enterprise), or by a PAC file.
- **PAC (proxy auto-config) file** -- a JavaScript file containing a
  `FindProxyForURL(url, host)` function that the browser calls for every request and
  that returns a string such as `"PROXY proxy.corp:8080; DIRECT"`. The format was
  designed by Netscape in 1996 and is still supported browser-wide; the file is served
  with MIME type `application/x-ns-proxy-autoconfig`
  ([MDN: PAC file](https://developer.mozilla.org/en-US/docs/Web/HTTP/Guides/Proxy_servers_and_tunneling/Proxy_Auto-Configuration_PAC_file)).
  PAC files can branch on destination host, so they are used to send corporate SaaS
  direct and everything else through the proxy.
- **WPAD (Web Proxy Auto-Discovery)** -- the client finds the PAC URL automatically via
  DHCP option 252 or a `wpad.<domain>` DNS lookup for `wpad.dat`
  ([Wikipedia: WPAD](https://en.wikipedia.org/wiki/Web_Proxy_Auto-Discovery_Protocol),
  secondary; the original `draft-ietf-wrec-wpad` expired without becoming an RFC).
- **Transparent proxy / tunnel** -- the network (a router doing WCCP/PBR, or a
  GRE/IPsec tunnel from a branch office) redirects port 80/443 to the proxy with no
  client configuration at all.
- **Endpoint forwarding client** -- see 1.6.

**TLS/SSL interception ("break and inspect").** A proxy can only see the hostname (from
the TLS SNI / the CONNECT target) unless it terminates TLS itself. To inspect the URL
path, headers, and body of an HTTPS request, the proxy generates a leaf certificate for
the destination on the fly, signed by an intermediate CA the enterprise controls, and
the endpoint must already trust that CA. Zscaler's documentation is explicit that "to
enable SSL/TLS Inspection, first deploy the Zscaler or custom intermediate root
certificate," and that the CA cert is pushed "using Microsoft Active Directory (AD),
Microsoft's Group Policy Object (GPO), or another Mobile Device Management (MDM)
solution," or via the endpoint client's own app profile
([Zscaler: Deploying SSL Inspection](https://help.zscaler.com/zia/deploying-ssl-inspection);
[Zscaler: Choosing the CA Certificate](https://help.zscaler.com/zia/choosing-ca-certificate-ssl-inspection)).
This is the capability that lets a SWG do URL-path filtering, DLP, and antivirus on
encrypted traffic, and it is not something any browser extension can obtain.

### 1.2 DNS-layer filtering

A recursive resolver refuses to resolve, or rewrites the answer for, domains on a
policy list. The mechanism most implementations use is **Response Policy Zones (RPZ)**,
specified in the Vixie/Schryver IETF drafts (`draft-vixie-dns-rpz`, later
`draft-ietf-dnsop-dns-rpz`), which describe "a method for expressing DNS response policy
inside a specially constructed DNS zone" so that "DNS resolution for low-reputation DNS
data can be made to deliberately fail or to return local data such as an alias to a
'walled garden'"
([draft-ietf-dnsop-dns-rpz-00](https://www.ietf.org/archive/id/draft-ietf-dnsop-dns-rpz-00.txt)).
The NSA/CISA information sheet *Selecting a Protective DNS Service* describes Protective
DNS (PDNS) as "a policy-implementing DNS resolver ... often called Response Policy Zone
(RPZ) functionality" that "leverag[es] various open source, commercial, and governmental
threat feeds to categorize domain information and block queries to identified malicious
domains"
([CSI: Selecting a Protective DNS Service, v1.3](https://media.defense.gov/2025/Mar/24/2003675043/-1/-1/0/CSI-SELECTING-A-PROTECTIVE-DNS-SERVICE-V1.3.PDF)).
Cisco Umbrella is the best-known commercial example.

DNS filtering is cheap and catches malware callbacks early, but it is coarse (whole
domain, not path) and is bypassed by encrypted DNS. Cisco's own guidance acknowledges
that "DNS over HTTPS changes the picture: the browser encrypts the lookup and sends it
to its own DoH provider over port 443, looking like ordinary web traffic," and
recommends countering it by enabling the "Proxy / Anonymizer" and "DoH / DoT" content
categories, "block[ing] the IP addresses of known DoH providers on your firewall," and
hosting the Mozilla canary domain `use-application-dns.net` to suppress Firefox's
automatic DoH
([Cisco: Configure Web Browsers and DNS over HTTPS](https://www.cisco.com/c/en/us/support/docs/security/umbrella/224912-configure-web-browsers-and-dns-over.html);
[Cisco: Enforce Umbrella DNS and Prevent Bypass](https://www.cisco.com/c/en/us/support/docs/security/umbrella/224758-enforce-umbrella-dns-and-prevent-bypass.html)).
On managed browsers the more direct control is the Chrome Enterprise `DnsOverHttpsMode`
policy set to `off`, which "will disable DNS-over-HTTPS"
([Chrome Enterprise: DnsOverHttpsMode](https://chromeenterprise.google/policies/dns-over-https-mode/)).

### 1.3 Firewall / NGFW app-ID + URL filtering

A next-generation firewall classifies each flow by application regardless of port or
protocol ("App-ID") and by URL category, and applies a policy rule. Palo Alto's
PAN-DB is "the authoritative source for URL classification ... whenever a user requests
a URL, the firewall compares the URL to entries in PAN-DB," doing "local lookups" and
"only quer[ying] the cloud when necessary"; a single URL "can have up to four URL
categories," and unknown sites get "real-time analysis by machine learning models"
([Palo Alto: How Advanced URL Filtering Works](https://docs.paloaltonetworks.com/advanced-url-filtering/administration/url-filtering-basics/how-url-filtering-works);
[Palo Alto: URL Categories](https://docs.paloaltonetworks.com/advanced-url-filtering/administration/url-filtering-basics/url-categories)).
Combined with App-ID, the firewall can, for example, allow a SaaS app's core function
but block its file-upload sub-application.

### 1.4 CASB and the SASE/SSE convergence

Gartner coined **SASE** in 2019 for "converged network and security as a service
capabilities, including SD-WAN, SWG, CASB, NGFW and Zero Trust Network Access (ZTNA),"
and **SSE** in 2021 for the security half of that -- "a collection of integrated,
cloud-centric security capabilities" (SWG + CASB + ZTNA, usually plus DLP and FWaaS)
"that facilitates safe access to websites, software-as-a-service (SaaS) applications and
private applications" regardless of user, device, or app location
([Palo Alto: What Is SSE](https://www.paloaltonetworks.com/cyberpedia/what-is-security-service-edge-sse);
[Zscaler: Gartner's SSE](https://www.zscaler.com/blogs/product-insights/what-you-need-know-about-gartner-s-new-security-service-edge)).
Zscaler ZIA, Netskope, Palo Alto Prisma Access, and Cloudflare Gateway are the SSE
platforms that now deliver web filtering for most large organisations, on-network and
off, from cloud PoPs rather than on-premise appliances.

A **CASB** specifically governs cloud-app usage and has two deployment modes:

- **Inline (forward/reverse proxy)** -- "sits directly between the user and the cloud
  application ... inspecting and controlling data in real time," which "can prevent the
  upload in real-time." It needs the traffic steered to it, via an endpoint client or
  proxy chaining
  ([Netskope: Deployment Options](https://www.netskope.com/products/deployment-options)).
- **API / out-of-band** -- "operates outside the direct traffic path and integrates
  with cloud service providers via APIs, monitoring cloud activity post-event" and
  scanning data at rest in sanctioned apps
  ([Netskope: Real-time Control ... via Out-of-Band API](https://www.netskope.com/blog/real-time-control-data-protection-via-band-api)).

### 1.5 Endpoint agents / roaming clients

The piece that makes all of the above work for a laptop at home is a small OS-level
agent -- Zscaler Client Connector, Netskope Client, Cisco Umbrella roaming client,
Cloudflare WARP -- that steers the device's traffic to the cloud service "even off
network" and, in the SWG case, also installs the interception CA and the forwarding
profile. Netskope describes its client as "the lightweight endpoint agent that steers
traffic to Netskope's cloud for forward proxy inspection"
([Netskope: Deployment Options](https://www.netskope.com/products/deployment-options)).
Without this agent, off-network traffic simply does not pass any corporate control point.

### 1.6 Browser-level controls

- **Chrome Enterprise `URLBlocklist` / `URLAllowlist`.** A managed policy list of URL
  patterns (`scheme://host:port/path`, with a `[*.]` subdomain wildcard and schemes
  `http`, `https`, `file`, `chrome-extension`, ...)
  ([Chrome Enterprise: URL pattern format](https://chromeenterprise.google/policies/url-patterns/)).
  Allowlist wins over blocklist, most-specific pattern wins. **Both lists are capped at
  1,000 entries** -- the stated reason is that "URLBlocklist policy only accepts 1000
  URLs because we need to scan the list for every navigation request"
  ([Chrome Enterprise: URLBlocklist](https://chromeenterprise.google/policies/url-blocklist/);
  [Chrome Enterprise: URLAllowlist](https://chromeenterprise.google/policies/url-allowlist/)).
  It "does not apply to in-page JavaScript URLs with dynamically loaded data"
  ([Google: Allow or block access to websites](https://support.google.com/chrome/a/answer/7532419?hl=en)).
  It is enforced only inside that managed Chrome profile -- not another browser, not a
  non-browser process.
- **Chrome Enterprise Premium (CEP).** A paid tier that adds "real-time threat
  protection, data loss prevention, content inspection, and URL filtering that work
  alongside identity and device-based access controls," including an "audit-only mode
  for URL filtering" and DLP rules that trigger on "File uploaded, File downloaded,
  Content pasted, Content printed, URL visited" and "scan up to 10 MB of text content in
  a file"
  ([Google Cloud: New ways to protect your sensitive data with Chrome Enterprise](https://cloud.google.com/blog/products/chrome-enterprise/new-ways-to-protect-your-sensitive-data-with-chrome-enterprise);
  [Google: Use Chrome Enterprise Premium to integrate DLP with Chrome](https://support.google.com/chrome/a/answer/10104358?hl=en)).
- **Dedicated "enterprise browsers" (Island, Palo Alto Prisma Access Browser -- the
  former Talon).** Chromium builds whose selling point is "last mile" governance: the
  vendor markets control over "copy, paste, download, upload, and screenshot capture ...
  data redaction, watermarking" enforced "at the browser layer" and "even outside the
  browser," "before data ever leaves the secure context"
  ([Island: Enterprise Browser](https://www.island.io/enterprise-browser)).
  This is the category Moat's "Athena integration" gestures at, done as a whole browser
  rather than an extension.
- **`ExtensionInstallForcelist` / `ExtensionSettings`.** Force-install an extension so it
  "install[s] silently, without user interaction, and ... users can't uninstall or turn
  [it] off"; `ExtensionSettings` overrides the forcelist and additionally supports
  per-extension `runtime_blocked_hosts` / `runtime_allowed_hosts`. Chrome's own docs
  caveat that "some operating systems make it impossible for Google Chrome to defend
  robustly against extensions being modified externally, so this prevention is best
  efforts," and that removing an extension from the list makes Chrome "automatically
  uninstall[]" it
  ([Chrome Enterprise: ExtensionInstallForcelist](https://chromeenterprise.google/policies/extension-install-forcelist/);
  [Google: Set Chrome app and extension policies](https://support.google.com/chrome/a/answer/7532015?hl=en)).

### 1.7 OS-level controls

- **Windows Group Policy** distributes proxy settings, the interception CA, browser
  policy, and (crudely) `hosts`-file entries. The `hosts` file
  (`%SystemRoot%\System32\drivers\etc\hosts`) maps a hostname to an IP with no wildcards
  and no path granularity; it is a last-resort, per-host block, bypassed by hardcoded
  IPs and encrypted DNS.
- **Microsoft Intune + Defender for Endpoint "Network protection" and "Web content
  filtering."** Enforced per device at the OS/network layer -- "Microsoft Defender
  Antivirus must be in active mode," and blocking works only when network protection is
  in "block mode" (there is also an "audit mode" that "logs whenever end users connect
  to an address or site that would otherwise be blocked")
  ([Microsoft: Turn on network protection](https://learn.microsoft.com/en-us/defender-endpoint/enable-network-protection);
  [Microsoft: Use network protection to help prevent connections to malicious or suspicious sites](https://learn.microsoft.com/en-us/defender-endpoint/network-protection)).
- **Apple Web Content Filter framework (`NetworkExtension`).** An
  `NEFilterDataProvider` subclass "decides if a network flow should be blocked or
  allowed" for "TCP and UDP flows, as well as other IP protocol traffic." Since iOS 16
  it "can [be] deploy[ed] ... to a managed device, but only in per-app mode"; broader
  filtering needs a supervised device
  ([Apple WWDC25: Filter and tunnel network traffic with NetworkExtension](https://developer.apple.com/videos/play/wwdc2025/234/)).

### 1.8 Category / reputation feeds

The "gambling / social media / malware / newly-registered domain" labels every one of
these products filters on come from a continuously-updated classification database --
PAN-DB, Zscaler's, Cisco Talos, Google Safe Browsing, plus commercial and government
threat feeds -- populated by crawlers, ML classifiers, sandbox detonation (Palo Alto's
WildFire, Unit 42 research), passive DNS, and customer telemetry
([Palo Alto: How Advanced URL Filtering Works](https://docs.paloaltonetworks.com/advanced-url-filtering/administration/url-filtering-basics/how-url-filtering-works)).
Owning or licensing one of these feeds is a core part of being a web-filtering vendor.
Moat has none of its own -- it ships static AdGuard filter lists refreshed at build time.

---

## 2. Blocking mechanics: what the user experiences, and bypass

**The block page.** A blocked navigation is usually redirected to a vendor- or
admin-branded interstitial ("this site is blocked, category X, contact the service
desk") -- either served by the proxy, or, at DNS layer, reached by the resolver
returning a "walled garden" CNAME/A record
([draft-ietf-dnsop-dns-rpz-00](https://www.ietf.org/archive/id/draft-ietf-dnsop-dns-rpz-00.txt)).
Common variants: **coaching / "proceed anyway"** pages that let the user continue after
acknowledging a warning (the click is logged), **SSO-gated allowlists**, **time
quotas** ("30 minutes of news sites per day"), and **bandwidth throttling** of
recreational categories rather than an outright block.

**Bypass and how it is countered.** This is an arms race, and the enterprise generally
wins only because it holds the network path and the endpoint:

- **VPN / proxy apps, anonymisers** -- countered by URL/app categories ("Proxy /
  Anonymizer"), App-ID signatures for known VPN clients, and default-deny egress
  firewalling so only the corporate tunnel leaves the machine.
- **DoH / DoT** -- countered by disabling it via browser policy, blocking public
  resolver IPs, and the canary domain (see 1.2).
- **IP literals / hardcoded IPs** -- countered by the proxy resolving and
  categorising the destination anyway, and by firewall geo/ASN rules.
- **ESNI / ECH / domain fronting** -- ECH (encrypting the inner ClientHello, including
  SNI and ALPN) was published as **RFC 9849 in March 2026**
  ([RFC 9849](https://datatracker.ietf.org/doc/rfc9849/)). Enterprises "lose visibility
  into which sites employees are accessing" when it is used, so SWGs and NGFWs
  increasingly detect and strip or drop the ECH extension (FortiOS added explicit ECH
  blocking in 7.4.4 and ECH-aware inspection in 7.6.3)
  ([Enea: TLS 1.3 ECH](https://www.enea.com/insights/tls-1-3-ech-how-to-preserve-critical-traffic-visibility-for-enterprise-and-network-security-while-safeguarding-privacy/);
  [Fortinet community: block TLS 1.3 ECH](https://community.fortinet.com/t5/FortiGate/Technical-Tip-How-to-block-TLS-1-3-Encrypted-Client-Hello-ECH-in/ta-p/176334)).
  With break-and-inspect in place, ECH does not help the user -- the proxy is the TLS
  endpoint.
- **A different browser or a portable browser** -- countered only by controls that live
  below the browser: the proxy, the roaming client, DNS, the firewall. Browser policy
  and force-installed extensions do nothing here.

---

## 3. Logging and reporting to administrators

This is a first-class part of every product above, and the part where Moat is furthest
from parity.

### 3.1 What gets logged

A SWG/NGFW/CASB access log record typically carries: timestamp; **named user** and
device; source IP; **full URL** (host + path + often query) or at minimum the TLS SNI
host; HTTP method; URL category; policy rule and **verdict** (allowed / blocked /
warned / quarantined); bytes sent and received; file names and hashes for
uploads/downloads; and DLP match details (which rule, which data pattern, which
disposition). Chrome Enterprise's own event schema is a good concrete example -- see
3.4.

### 3.2 Transport to the SIEM

Standardised, machine-readable, and continuous:

- **Syslog**, usually carrying **CEF** (ArcSight's "Common Event Format ... a syntax for
  log records comprised of a standard header and a variable extension, formatted as
  key-value pairs", with "Syslog as a transport mechanism") or **LEEF** ("a customized
  event format for IBM Security QRadar")
  ([Micro Focus: CEF Implementation Standard](https://www.microfocus.com/documentation/arcsight/arcsight-smartconnectors-8.4/pdfdoc/cef-implementation-standard/cef-implementation-standard.pdf)).
- **Log streaming APIs / cloud buckets** -- the SSE platforms stream NDJSON to an S3 /
  GCS bucket or an HTTPS endpoint (Splunk HTTP Event Collector, a webhook, a Pub/Sub
  topic).
- **Native SIEM connectors** -- vendor-built apps for Splunk, Microsoft Sentinel, and
  Google Security Operations (Chronicle) that normalise the vendor's events into the
  SIEM's data model.

### 3.3 Identity binding

Every record is tied to a real person. The mechanisms:

- **Proxy authentication** (Kerberos / NTLM / Basic) on an explicit proxy.
- **SAML / IdP federation** -- the SWG is a SAML SP against the corporate IdP. Zscaler
  "recommends using an Identity Federation using SAML"
  ([Zscaler: Understanding User Provisioning and Authentication](https://help.zscaler.com/zia/about-provisioning-authenticating-users)).
- **Surrogate IP** -- after one browser authentication, Zscaler "map[s] a user to a
  private IP address" so "the user's policies" (and the user's identity on every log
  line) apply "to traffic that it cannot authenticate," including non-browser apps and
  other browsers on the same machine
  ([Zscaler: About Surrogate IP](https://help.zscaler.com/zia/about-surrogate-ip)).
- **Endpoint-agent identity** -- the roaming client knows the logged-in OS user and
  stamps it on forwarded traffic.

### 3.4 Chrome-specific reporting

Chrome browser, when enrolled in Chrome Browser Cloud Management (or CEP), emits
security events to the Admin console and onward to a SIEM through **Chrome Enterprise
Reporting Connectors**. Supported connector targets are "CrowdStrike Falcon LogScale,
CrowdStrike Falcon Next-Gen, Google Cloud Pub/Sub, Google Security Operations, Palo Alto
Networks, Splunk"
([Google: Manage Chrome Enterprise reporting connectors](https://support.google.com/chrome/a/answer/11375053?hl=en)).
The Splunk path uses the HTTP Event Collector and maps events to the Splunk Common
Information Model models "Authentication, Change, DLP, Data Access, Endpoint, Malware and
Web"
([Google Cloud: Security insights from Chrome browser delivered with Splunk](https://cloud.google.com/blog/products/chrome-enterprise/security-insights-chrome-browser-delivered-splunk)).
The event catalogue (Chrome log events) includes, with per-version support notes:

- **Unsafe site visit** -- "The URL visited by the user is considered to be deceptive or
  malicious." (Chrome 104+)
- **Malware transfer** -- "The content uploaded or downloaded by the user is considered
  to be malicious, dangerous, or unwanted." (104+)
- **Password reuse** -- "The user entered a password into a URL that's outside of the
  list of allowed enterprise login URLs." (104+)
- **Password breach** (105+); **Extension install** -- "A browser extension was
  installed, either by user action or by the administrator." (110+)
- **Content transfer** and **Sensitive data transfer** -- content "sent for Malware or
  Sensitive data scanning" / "considered to contain sensitive data." (CEP)

Common fields include "URL, User agent, Remote IP, Device name, Event result, and Event
reason," plus for file events "Content hash, Content name, Content type, and Content
size"
([Google Workspace: Chrome log events](https://knowledge.workspace.google.com/admin/reports/chrome-log-events?hl=en)).
The Chronicle ingest path is documented as including "accessed domain, downloaded file
hash, and username"
([Google Cloud Community: Chrome Enterprise and Google Chronicle](https://security.googlecloudcommunity.com/community-blog-42/supercharge-your-security-visibility-with-chrome-enterprise-and-google-chronicle-3867), secondary).
Underneath, these are surfaced to Google's own management stack via the private
`chrome.enterprise.reportingPrivate` / `safeBrowsingPrivate` extension APIs plus the
built-in reporting client -- **private surfaces, not available to a Web Store
extension** ([Chrome API reference index](https://developer.chrome.com/docs/extensions/reference/api)).
Admins can also query visited-URL and security history interactively in the Google
Admin console's Security Investigation Tool.

### 3.5 Retention, privacy, and works-council constraints

What may be collected is legally bounded, and in parts of Europe collectively bounded.
GDPR Article 88 lets member states "provide more specific rules ... for the processing of
employees' personal data in the employment context"
([Oxford Academic, *IDPL*: The role of Article 88 GDPR](https://academic.oup.com/idpl/article/12/4/276/6668508)).
In Germany the Betriebsverfassungsgesetz gives the works council (Betriebsrat) a
co-determination right that "requires works council consent before introducing or
substantially modifying monitoring systems ... even where the monitoring has a valid
GDPR basis," typically settled in a `Betriebsvereinbarung` that fixes purpose, scope,
retention, and access
([eMonitor: Germany Employee Monitoring Laws](https://www.employee-monitoring.net/compliance/employee-monitoring-laws-germany), secondary).
The practical effect: full-URL logging with per-user attribution is often deployed in a
reduced form (host-only, aggregated, shortened retention, break-glass access to
raw data), and "audit-only" modes exist partly for this reason.

### 3.6 DLP overlap

Web control and DLP are increasingly the same product. Once a SWG or CEP terminates
TLS it inspects the request/response body -- not just the URL -- against data patterns,
on upload, download, paste, and print, and blocks, redacts, watermarks, or just logs.
Moat sees none of this surface.

---

## 4. How the pieces fit: a typical deployment

1. **Policy authoring.** An admin defines rules in a cloud console: category-based
   allow/block, per-group and per-time exceptions, TLS-inspection scope, DLP data
   rules, and the logging/SIEM destination.
2. **Distribution.** Browser and OS policy via GPO / Intune / Jamf / Chrome Browser
   Cloud Management; the interception CA and the forwarding client to every managed
   endpoint; PAC/WPAD for unmanaged-but-on-network devices.
3. **Enforcement point.** On-network: a tunnel or PAC sends traffic to the SSE cloud or
   an on-prem proxy/NGFW; DNS points at the filtering resolver. **Off-network (SASE):
   the endpoint roaming client forces the same path from anywhere** -- this is the
   difference that makes the whole model hold for remote workers.
4. **Verdict.** The enforcement point classifies (App-ID + URL category + reputation +
   inline DLP/AV), consults identity (SAML / surrogate IP / agent), applies the rule,
   and returns allow / block-page / coach / redact.
5. **User experience.** Transparent allow, or an interstitial with a category and often
   a "proceed / request access" path.
6. **Telemetry.** Every request produces a structured log line (user, URL, category,
   verdict, bytes, file hashes, DLP hits).
7. **SIEM.** Logs stream continuously via syslog/CEF, a streaming API, a bucket, or a
   native connector into Splunk / Sentinel / Chronicle.
8. **Admin review.** Dashboards, investigation tooling, and alerts on policy hits and
   anomalies.
9. **Policy change.** Findings feed back into step 1.

The on-network vs remote-worker distinction runs through all nine steps: legacy designs
enforce at the datacentre edge and lose the remote user; SASE/SSE moves steps 3-7 into a
cloud the endpoint agent always routes through.

---

## 5. Gap analysis: what Moat lacks

Moat is a single MV3 browser extension. It has no proxy, no network device, no OS agent,
no TLS termination, and on Chrome no blocking `webRequest` -- only
`declarativeNetRequest` URL-pattern block/allow/redirect/header rules over the requests
that one browser profile makes, plus content scripts in pages that already loaded
(`README.md` "How it works"; Chrome's `GUARANTEED_MINIMUM_STATIC_RULES` is 30,000 and
the rest of Moat's ~271k rules come from a browser-wide shared pool, per `README.md`
"Known limitations"). Its enterprise surface is the managed-policy schema
(`src/managed_schema.json`) and the optional, org-provisioned Athena client
(`src/background/athenaIntegration.ts`, `athenaPolicySync.ts`, `athenaPolicyRules.ts`).
Measured against sections 1-4, here is where it sits.

### 5.1 No network-path enforcement (won't fix -- outside the model)

Everything in section 1 that actually *stops* a determined user sits in the traffic path
or below the browser. Moat sits inside one browser profile's extension sandbox. It is
bypassed by: opening a different browser, a portable browser, or an unmanaged device;
using an incognito window where the extension is not enabled; disabling the extension
(force-install is "best efforts" by Chrome's own admission and has no self-distributed
equivalent on Firefox --
[ExtensionInstallForcelist](https://chromeenterprise.google/policies/extension-install-forcelist/));
or a page loading blocked content via in-page JavaScript, which even Chrome's own
`URLBlocklist` does not catch
([Google: Allow or block access to websites](https://support.google.com/chrome/a/answer/7532419?hl=en)).
There is **no off-network guarantee** because there is no endpoint agent forcing a path.
This is the single biggest structural gap and it is not closeable within an extension --
an extension is the wrong layer for guaranteed enforcement. Moat's honest enterprise
positioning is "defence in depth inside the browser," never "the web-access control."

### 5.2 No TLS/DLP/content inspection (won't fix -- privacy tool by design)

Moat has no view of request bodies, response bodies, uploads, downloads, pasted or
printed content. MV3 `declarativeNetRequest` decides on URL patterns and a small set of
headers, nothing more. It cannot make data-classification decisions the way CEP (10 MB
text scan on upload/download/paste/print --
[Chrome Enterprise Premium DLP](https://support.google.com/chrome/a/answer/10104358?hl=en))
or Island (copy/paste/screenshot/watermark --
[Island](https://www.island.io/enterprise-browser)) do. An extension cannot obtain a
break-and-inspect CA, and doing content inspection would contradict Moat's stated
first-principle of being a privacy tool with zero telemetry for normal installs
(`PRIVACY.md`). This is a deliberate non-goal, not a backlog item.

### 5.3 No per-user identity binding or authenticated logging

Enterprise logging binds every verdict to a named person (section 3.3; Chronicle ingest
includes `username`). Athena events carry **no user or device identity at all**. The
`agentId` in the managed policy is "the immutable Athena agent id returned during
enrollment" (`src/types.ts` `AthenaConfig`) -- an install/enrolment identifier for the
org, not a person. There is no SAML/IdP integration, no proxy auth, no surrogate-IP
equivalent, nothing that answers "*who* visited this." The bootstrap exchange
authenticates the *agent* to Athena with a shared `bootstrapSecret`
(`athenaIntegration.ts:68-102`); the event POST is a bearer token on that agent session
(`athenaIntegration.ts:135-150`). An extension genuinely cannot reach OS or IdP
identity; the most it could add is an admin-supplied device/org label in managed policy,
which still is not a user. Treat this as a hard limitation to disclose, not a gap to
quietly close.

### 5.4 Athena is a narrow, batched, security-only event queue -- not web-access logging

Characterised exactly, from the code:

- **What it sends.** One event per request already blocked by the
  `malicious-urls` / `phishing-urls` / `scam` / `badware` filter lists specifically; one
  per popup/redirect-firewall catch; one per "Report mistake" override on the Athena
  warning page (`athenaIntegration.ts` header comment; `src/types.ts`
  `AthenaSecurityEvent.category` is `"security-rule" | "popup-redirect" | "override"`).
  **Ordinary ads/trackers never generate an event, and neither does any allowed
  navigation or any normal browsing.** There is no "URL visited" event, no allow-verdict
  record, no bytes, no path, no history.
- **Event shape.** `source_event_id` (a random UUID, for idempotency), `occurred_at`,
  `action` (`blocked` or `allowed_override`), `severity` (`high` / `medium` / `low`
  risk tier), `rule_id` (`rulesetId:ruleId` or the category), `target_indicator` (the
  matched domain -- "Never the full URL, page content, or browsing history"), and
  `evidence.category` plus an optional free-text `override_reason` that only ever comes
  from a user's own typed note on the warning interstitial
  (`athenaIntegration.ts:138-150`; `src/types.ts`).
- **Transport and cadence.** Individual `POST`s to one `eventsUrl`, driven by a
  `browser.alarms` tick every **5 minutes** (`PERIOD_MINUTES = 5`,
  `athenaIntegration.ts:164`). Not syslog, not CEF/LEEF, no streaming API, no bucket, no
  Splunk/Sentinel/Chronicle connector. `eventsUrl` and `bootstrapUrl` must be HTTPS or
  the integration refuses to activate (`athenaIntegration.ts:21-28`).
- **Durability.** The queue lives in `browser.storage.session` -- in-memory, "gone on
  browser/extension restart" (`athenaIntegration.ts:63-67`) -- and is capped at
  **200 events**, dropping the oldest first (`MAX_QUEUE_LENGTH = 200`,
  `athenaIntegration.ts:44`, `120`). A multi-hour Athena outage, or a service-worker
  restart, silently loses events. There is no delivery guarantee and no backfill.

So Athena is a minimised **security-signal** feed, closer in spirit to a Safe-Browsing
hit counter than to a SWG access log, and it should be described that way. It cannot
answer "what sites did this team visit last week," feed a SIEM as a browsing record, or
survive a restart intact.

### 5.5 No category feed, thin policy model, minimal block-page/coaching UX

- **Org blocking is literal domains only.** `managedCustomBlockedDomains` (additive,
  lock-independent -- `managedPolicyMerge.ts:29-33`) and the Athena signed policy's
  `blockedDomains` are exact hostname lists. The Athena list is capped at **1,000 rules**
  (`MAX_ATHENA_POLICY_RULES`, `athenaPolicyRules.ts:14`), applied as `main_frame`
  redirects to `/warning.html` in a reserved dynamic-rule id range
  (`athenaPolicyRules.ts:64-71`) -- coincidentally the same 1,000-entry ceiling Chrome's
  native `URLBlocklist` has, and for a similar per-navigation-scan reason. There is **no
  category model** ("gambling", "social media"), no reputation score, no
  newly-registered-domain heuristic, no per-user / per-group / per-time policy, no
  quota, no bandwidth control.
- **No category database of Moat's own** (section 1.8). It ships static AdGuard lists
  refreshed at build time; it has no crawler, classifier, or threat-feed pipeline.
- **Block-page UX is one interstitial.** `warning.html` with a "Report mistake" flow
  that "remains an audited request rather than an immediate local bypass" (`README.md`).
  No admin-branded coaching page, no "proceed anyway" with policy-controlled
  justification beyond that single override note, no per-category messaging.
- **No reporting-connector integration and no `enterprise.reportingPrivate`** -- those
  are Chrome-private and unavailable to a Web Store extension (section 3.4). Moat cannot
  emit into the Admin console event stream or a Chrome reporting connector; Athena is
  its only outbound channel.
- **Policy signing is solid.** Where Moat does something enterprise-grade, credit it:
  the Athena policy artifact is Ed25519-verified before any dynamic rule changes, and an
  invalid or unreachable update keeps the last-known-good rules
  (`athenaPolicySync.ts:34-68`). That is a better supply-chain posture than the live
  redirect-domain channel, which is TLS + GitHub-account-security only (`README.md`).

### 5.6 Tamper resistance

Moat has no tamper resistance of its own beyond what Chrome policy provides:
`ExtensionInstallForcelist` / `ExtensionSettings` `force_installed` to block
disable/uninstall, which Chrome itself calls "best efforts" and which has no
self-distributed Firefox analogue
([ExtensionInstallForcelist](https://chromeenterprise.google/policies/extension-install-forcelist/)).
An enterprise-browser vendor ships a hardened binary; Moat cannot. This is inherent to
being an extension and should be stated, not engineered around.

### 5.7 Where the model *could* stretch (grounded, MV3-realistic)

Not recommendations -- options a maintainer could weigh, each within what an extension
can actually do:

- **Make Athena telemetry more log-like without changing its privacy stance.** Persist
  the queue to `storage.local` so a restart does not lose it (the tradeoff -- `local`
  is not encrypted at rest -- is already documented for the bootstrap secret in
  `src/types.ts` and would need the same treatment); raise or make configurable the
  200-event cap and the 5-minute interval; add a monotonic sequence number and a
  "queue overflowed, N events dropped" marker so the server can detect loss. None of
  this adds new data categories.
- **Emit a CEF-shaped JSON body option** for `eventsUrl` so an org can point it at a
  syslog-to-SIEM shim without Athena in the middle. Still batched by alarm, still
  security-events-only, but closer to something a SOC can ingest.
- **Add a category layer to the managed schema.** `managedFilterGroups` already maps
  filter-group slugs to on/off; a sibling key could let an admin force specific AdGuard
  *category* lists (e.g. the Social Media list) on as a blunt "block social media"
  control, reusing machinery that already exists.
- **A coaching / allow-with-logged-reason mode on `warning.html`,** gated by a managed
  policy flag, where "proceed" is permitted but always produces an `override` event.
  This is a small extension of the existing warning-page flow.
- **Document the tamper-resistance story explicitly** in the README's enterprise
  section -- exactly what `force_installed` + `runtime_blocked_hosts` give and where
  "best efforts" ends -- rather than leaving it implied.

### 5.8 What Moat deliberately is not

Worth stating plainly so a future pass does not read these as unfinished work: Moat is a
**privacy tool first**, zero-server and zero-telemetry for every non-enterprise install,
with **no user-facing way to enable Athena at all** -- only an org's own device
management can provision it (`README.md` "Athena integration"). It intentionally does
not do content inspection, per-user tracking, full-URL logging, or network-path
enforcement. The "won't fix" gaps (5.1, 5.2, 5.3, 5.6) are consequences of that stance
and of the extension model; the "could stretch" items (5.4, 5.5 via 5.7) are the only
ones a maintainer should treat as open questions.

---

## Sources

Primary sources are linked inline throughout. Key references:
[Chrome Enterprise URLBlocklist](https://chromeenterprise.google/policies/url-blocklist/) /
[URLAllowlist](https://chromeenterprise.google/policies/url-allowlist/) /
[URL pattern format](https://chromeenterprise.google/policies/url-patterns/) /
[ExtensionInstallForcelist](https://chromeenterprise.google/policies/extension-install-forcelist/) /
[DnsOverHttpsMode](https://chromeenterprise.google/policies/dns-over-https-mode/);
[Google: Chrome reporting connectors](https://support.google.com/chrome/a/answer/11375053?hl=en) /
[Chrome log events](https://knowledge.workspace.google.com/admin/reports/chrome-log-events?hl=en) /
[Allow or block access to websites](https://support.google.com/chrome/a/answer/7532419?hl=en) /
[Chrome Enterprise Premium DLP](https://support.google.com/chrome/a/answer/10104358?hl=en);
[Zscaler: Deploying SSL Inspection](https://help.zscaler.com/zia/deploying-ssl-inspection) /
[Choosing the CA Certificate](https://help.zscaler.com/zia/choosing-ca-certificate-ssl-inspection) /
[Surrogate IP](https://help.zscaler.com/zia/about-surrogate-ip) /
[User Provisioning and Authentication](https://help.zscaler.com/zia/about-provisioning-authenticating-users);
[Cisco Umbrella: DNS over HTTPS](https://www.cisco.com/c/en/us/support/docs/security/umbrella/224912-configure-web-browsers-and-dns-over.html) /
[Prevent Bypass](https://www.cisco.com/c/en/us/support/docs/security/umbrella/224758-enforce-umbrella-dns-and-prevent-bypass.html);
[Palo Alto: How Advanced URL Filtering Works](https://docs.paloaltonetworks.com/advanced-url-filtering/administration/url-filtering-basics/how-url-filtering-works);
[Netskope: Deployment Options](https://www.netskope.com/products/deployment-options) /
[Out-of-Band API](https://www.netskope.com/blog/real-time-control-data-protection-via-band-api);
[NSA/CISA: Selecting a Protective DNS Service](https://media.defense.gov/2025/Mar/24/2003675043/-1/-1/0/CSI-SELECTING-A-PROTECTIVE-DNS-SERVICE-V1.3.PDF);
[IETF draft-ietf-dnsop-dns-rpz](https://www.ietf.org/archive/id/draft-ietf-dnsop-dns-rpz-00.txt);
[RFC 9849 (ECH)](https://datatracker.ietf.org/doc/rfc9849/);
[MDN: PAC file](https://developer.mozilla.org/en-US/docs/Web/HTTP/Guides/Proxy_servers_and_tunneling/Proxy_Auto-Configuration_PAC_file);
[Micro Focus: CEF Implementation Standard](https://www.microfocus.com/documentation/arcsight/arcsight-smartconnectors-8.4/pdfdoc/cef-implementation-standard/cef-implementation-standard.pdf);
[Microsoft: network protection](https://learn.microsoft.com/en-us/defender-endpoint/network-protection);
[Apple WWDC25: NetworkExtension filtering](https://developer.apple.com/videos/play/wwdc2025/234/);
[Island: Enterprise Browser](https://www.island.io/enterprise-browser);
[Oxford Academic IDPL: Article 88 GDPR](https://academic.oup.com/idpl/article/12/4/276/6668508).
Moat internals cited as `path:line` against the working tree at the date above.

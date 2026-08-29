# Enterprise deployment

Managed-policy deployment for Moat, and the optional, enterprise-only Athena integration. None of
this affects a normal personal or open-source install — Moat behaves exactly as the
[README](../README.md) describes with all of it absent.

## Managed policy

An admin can push policy via Chrome's `ExtensionSettings` policy (Group Policy / Chrome Browser
Cloud Management) or Firefox's `policies.json` `3rdparty` key, targeting this extension's id and
setting values matching `src/managed_schema.json`. Chrome example (`ExtensionSettings` policy
value, keyed by extension id):

```json
{
  "<extension-id>": {
    "installation_mode": "force_installed",
    "update_url": "https://clients2.google.com/service/update2/crx",
    "policy": {
      "forceEnabled": true,
      "lockFilterGroups": true,
      "managedFilterGroups": { "ads": true, "trackers": true, "malicious-urls": true },
      "managedCustomBlockedDomains": ["known-bad-domain.example"]
    }
  }
}
```

The Firefox equivalent goes under `3rdparty.Extensions["<extension-id>"]` in `policies.json` with
the same `policy` object shape. This was built and unit-tested against the documented policy
mechanism but not verified against a real managed browser profile — worth a manual check
(`chrome://policy` shows whether Chrome picked up the value) before relying on it in production.

Locked controls show a "Managed by your organization" badge in Settings instead of silently
overriding the user.

## Athena integration (enterprise-only, off for every other install)

Moat ships the client half of an optional integration with
[Athena](https://github.com/Samuelabhinav37/Athena), a self-hosted identity-governance platform.
It has **no Settings toggle** and cannot be turned on by a user at all; it only exists to be
provisioned by an organization's own device-management policy, and every normal, personal, or
open-source install of Moat behaves exactly as documented in the README with it entirely absent.

Background on where this fits a wider design, and why network-path enforcement, TLS inspection,
per-user authenticated logging, and tamper resistance are deliberately *not* in scope for a
browser extension:
[`research/enterprise-web-control-landscape.md`](research/enterprise-web-control-landscape.md).

Add an `athena` object (see `src/managed_schema.json`) to the same managed policy shown above:

```json
"policy": {
  "athena": {
    "tenantId": "acme",
    "agentId": "<agent id returned by Athena enrollment>",
    "bootstrapUrl": "https://athena.acme.example/v1/security/agent-token",
    "bootstrapSecret": "<provisioned by your Athena deployment, scoped to this org only>",
    "eventsUrl": "https://athena.acme.example/v1/security/events",
    "policyUrl": "https://athena.acme.example/v1/security/policies/latest",
    "policyPublicKey": { "kty": "OKP", "crv": "Ed25519", "x": "<base64url key>" }
  }
}
```

Once present, `src/background/athenaIntegration.ts` exchanges `bootstrapSecret` for a short-lived
session token (cached in `browser.storage.session` — in-memory, never `local`/`sync`) and every
five minutes flushes a bounded local queue as individual idempotent security events: one for each
request already blocked by the malicious-urls/phishing-urls/scam/badware lists specifically (not
ordinary ads/trackers, which never generate an event), one for each popup/redirect-firewall catch
(the one source that also works on Firefox), and one for every "Report mistake" override on the
warning page. Every event carries a category, a risk tier, a timestamp, and the matched domain —
resolved from the bundled ruleset (`background/securityRuleDomain.ts`), read off the intercepted
request, or the policy-known hostname Athena itself named; never the full URL, page content, or
browsing history. Blocking itself never waits on any of this: by the time an event is queued, the
block it describes has already happened locally, and a flush failure just leaves the queue for the
next attempt. Policy artifacts are verified with the managed Ed25519 public key before Moat
changes any dynamic rule; invalid or unreachable updates retain the last-known-good rules, and an
Athena-sourced block uses a separate warning page where a reported mistake stays an audited
request rather than an immediate local bypass.

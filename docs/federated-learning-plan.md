# Federated learning in Moat: the plan

Status: plan only, nothing built. Written 2026-10-06. The research behind it is in the Cluster repo:
`cluster-inspect/research/2026-10-06-founder-strategy-open-source-ethics-federated.md` (§1.2 to §1.6,
§5.5, §5.15). Read that for the sources. This file is the build guide.

## Why Moat and not Cluster

Google's Workspace policy forbids training a model on Gmail data "beyond that specific user's
personalized model". That blocks shared learning in Cluster, even with privacy noise or secure
aggregation. Moat sees web pages, not Gmail. The Chrome Web Store user data policy has no AI/ML clause
and allows sending data "to protect against malware, spam, phishing, or other fraud or abuse". So real
federated learning is allowed in Moat, as long as it is opt-in and clearly disclosed.

Moat and Cluster work as one body like this:

- **Moat learns from everyone** on the web, opt-in, through federated learning.
- **Cluster protects each person's email** privately, with a personal model on their device.
- **Gmail data never enters Moat's training.** This is a hard rule (see "The Gmail firewall").

## What the model does

It scores how likely a page host is a scam: a fake shop, a fake login page or a fake payment page.

**Model:** logistic regression over 50 to 300 hand-made features. One update is a few hundred numbers,
about 1 KB. Small linear models average well, train fast in the browser and explain themselves: every
weight maps to a plain reason ("the address pretends to be PayPal").

**Features (host and page shape only, never page text or form values):**

| Group | Examples |
|---|---|
| Host | TLD class, punycode, length, digit ratio, brand word in the host, lookalike distance to a known brand |
| Reputation | Age bucket from public lists, on the signed security list, on a known-good list |
| Page shape | Password field on a non-HTTPS page, a form posting to another domain, a payment form on a new host |
| Context | Arrived from a held email (only as a local warning input, never for training: see the firewall) |

**Labels:** the user's own taps on Moat's warning page ("This is a scam" and "This site is fine"), plus
Moat blocks from the signed list that the user did not override.

## Phases

### Phase 0: simulate offline (no users involved)

- Build a public training set from licensed sources: the founder's own data, public phishing URL
  feeds that allow it, and a known-good set of top sites. Check every licence first. OpenPhish's
  community terms forbid "customer protection" use without written consent, so leave it out.
- Simulate federated rounds with [Flower](https://github.com/flwrlabs/flower) (Apache-2.0), using
  skewed splits so each simulated user sees different sites.
- Go on only if federated training beats a model trained on the public set alone.

### Phase 1: personal model on the device (no upload)

- Ship global starting weights inside the signed daily files, next to `live/security-domains.json`.
  Verify them with the same Ed25519 check as today (`src/background/liveSignature.ts`).
- Each user's taps fine-tune a personal copy in `chrome.storage.local`. Plain TypeScript SGD is
  enough. No new library.
- The personal model can only **raise** a warning above the global one. It can never silence a
  domain that is on the signed security list.
- Value on day one, and no change to Moat's privacy promise.

### Phase 2: opt-in federated learning

Only after Phase 1 is stable, and only with the founder's decision to change the privacy promise.

1. **Opt-in screen.** Off by default. Equal-weight "Yes" and "No" buttons. It shows exactly what is
   sent (an example update) before the first send. It never re-asks more than once per major version.
   Turning it off deletes anything queued.
2. **On the device:** train on local labels for a few passes, compute the weight change, clip it to a
   fixed size and add calibrated privacy noise.
3. **Send:** split the clipped update into two secret shares, one for each of two aggregators run by
   **different organisations**. Neither can see an individual update. Use the IETF Distributed
   Aggregation Protocol with ISRG's open implementations (`divviup/janus`, `divviup/divviup-ts`,
   MPL-2.0). Its validity proof rejects any update outside the clip bound, which limits what one
   attacker can push.
4. **Round rules:** at most one round a week. No round with fewer than 1,000 contributors. Never
   publish a statistic computed from fewer than 100.
5. **Our aggregator** runs as a Cloudflare Worker with a Durable Object, next to `report-worker/`.
   The free tier covers about 1,000 users. About $5 a month covers 100,000.
6. **The second aggregator** must be someone else: ISRG/Divvi Up or a university partner. If no
   partner is found, Phase 2 does not launch. A single aggregator would see every user's update.

### Phase 3: release gate (every new global model)

A new model ships only if all of these hold:

1. It does not lower the score of any domain on the signed known-bad list.
2. It does not raise false positives on a fixed public known-good set.
3. It beats the current model on a held-out public test set.
4. A human reviews the numbers and signs the release. ("ML recommends, a human approves.")

Each release is a file with: version, training-data manifest, round size, privacy budget (epsilon) and
evaluation results. It is signed with the existing key scheme, and its hash goes into a public
transparency log (Sigstore Rekor). Moat refuses unsigned models and older versions.

## Defending against poisoning

Scammers will opt in and try to teach the model that their sites are safe.

- Bounded inputs (validity proof), clipping and noise limit any one user.
- A clean public root set checks every round's direction ("FLTrust" style, Cao et al.,
  arXiv 2012.13995).
- The release gate means the model can only add protection automatically. Removing a block needs
  a human.
- Fast-changing scam domains belong in the signed daily list, not in the model. The model learns
  lasting patterns ("brand name plus a new host plus a login form").

## The Gmail firewall

Cluster may tell Moat which domains appeared in held scam email, so Moat can warn if the user visits
one. That data is Gmail-derived.

- It travels only between the two extensions on the same computer (`externally_connectable` with
  fixed extension ids, `chrome.runtime.onMessageExternal`).
- Moat tags it `source: "cluster"` at the boundary. Tagged data can trigger a local warning. It must
  never enter the training buffer, the label set or any upload.
- A unit test asserts that no tagged item can reach the federated client.
- Each extension must work fully on its own.

## Privacy and store changes needed before Phase 2

- `PRIVACY.md` today promises "Nothing is ever sent automatically." Rewrite it for opted-in users:
  what is sent, how often, who runs each aggregator, and how to turn it off.
- Update the Chrome Web Store data disclosures (`docs/store-listing.md`).
- Exclude under-13s from any upload feature.

## Open decisions for the founder

1. Is changing Moat's "nothing is sent automatically" promise acceptable for people who opt in?
2. Who runs the second aggregator?
3. Which public training sources are allowed? Each needs a licence check.
4. What is the smallest round size we accept before launch (1,000 is the floor)?

// Fetches, verifies, and applies the signed policy artifact from
// ManagedPolicy.athena.policyUrl -- see athenaPolicyRules.ts for the pure
// rule-building/validation this wraps, and shared/athenaPolicySignature.ts
// for the actual verification. Runs on the same alarm as
// athenaIntegration.ts's event flush; entirely inert (isPolicySyncConfigured
// false) unless both policyUrl and policyPublicKey are set, which nothing
// but an org's own managed policy can do.
import browser from "webextension-polyfill";
import { matchesKnownRedirectDomain } from "./redirectDomainMatch";
import { allAthenaPolicyRuleIds, buildAthenaPolicyRules, parsePolicyArtifact } from "./athenaPolicyRules";
import { canonicalPolicyPayload, verifyPolicySignature } from "../shared/athenaPolicySignature";
import { isHttpsUrl } from "../shared/httpsUrl";
import type { AthenaConfig, SignedAthenaPolicy } from "../types";

export function isPolicySyncConfigured(config: AthenaConfig): boolean {
  if (!config.policyUrl || !config.policyPublicKey) return false;
  return isHttpsUrl(config.policyUrl);
}

// The domain set from the last policy that fetched, verified, and applied
// successfully -- used by index.ts's webNavigation.onBeforeNavigate
// listener to record *why* a tab is about to be redirected to warning.html,
// since the DNR redirect action itself carries no reason back to the
// extension. Module-level and in-memory only: a service-worker restart
// clears it, but the next alarm tick (at most PERIOD_MINUTES away, same as
// athenaIntegration.ts) repopulates it from the same source of truth
// (policyUrl) rather than needing its own persistence.
let currentBlockedDomains = new Set<string>();

export function isPolicyBlockedHostname(hostname: string): boolean {
  return matchesKnownRedirectDomain(hostname, currentBlockedDomains);
}

export async function fetchAndApplyPolicy(config: AthenaConfig, token?: string): Promise<void> {
  if (!isPolicySyncConfigured(config)) return;
  if (!token) return;

  try {
    const response = await fetch(config.policyUrl!, {
      cache: "no-store",
      headers: { authorization: `Bearer ${token}` },
    });
    if (!response.ok) return;
    const responseBody = (await response.json()) as {
      policy?: unknown;
      signature?: unknown;
    };
    if (typeof responseBody.policy !== "object" || responseBody.policy === null || typeof responseBody.signature !== "string") return;
    const envelope: SignedAthenaPolicy = {
      payload: canonicalPolicyPayload(responseBody.policy),
      signature: responseBody.signature,
    };

    const verified = await verifyPolicySignature(envelope, config.policyPublicKey!);
    if (!verified) return; // Discarded outright -- see athenaPolicyRules.ts's header comment.

    const artifact = parsePolicyArtifact(envelope.payload);
    if (!artifact) return;

    await browser.declarativeNetRequest.updateDynamicRules({
      removeRuleIds: allAthenaPolicyRuleIds(),
      addRules: buildAthenaPolicyRules(artifact.blockedDomains),
    });
    currentBlockedDomains = new Set(artifact.blockedDomains);
  } catch {
    // Unreachable, malformed response, quota hit -- keep whatever policy
    // (if any) was last successfully verified and applied.
  }
}

// Whether a page's Content-Security-Policy lets it start a worker from a
// blob: URL. The fingerprint guard runs page-made workers through a blob:
// bootstrap (see fingerprintGuard.ts's patchWorkers), and a CSP that forbids
// that doesn't throw: the worker just fails later with an error event. So the
// guard asks first, from the policy text, and leaves those pages' workers
// alone.
//
// Report-only policies count too. They don't block, but a violation sends the
// site a report, which would tell it this visitor runs the guard.

// CSP3 fallback order for a worker's script (worker-src's "effective
// directive" chain).
const WORKER_DIRECTIVES = ["worker-src", "child-src", "script-src", "default-src"];

function policyAllowsBlobWorkers(policy: string): boolean {
  const directives = new Map<string, string[]>();
  for (const part of policy.split(";")) {
    const [name, ...sources] = part.trim().split(/\s+/);
    if (!name) continue;
    const key = name.toLowerCase();
    // The first occurrence of a directive wins; later duplicates are ignored.
    if (!directives.has(key)) directives.set(key, sources.map((s) => s.toLowerCase()));
  }
  const name = WORKER_DIRECTIVES.find((d) => directives.has(d));
  if (!name) return true;
  const sources = directives.get(name)!;
  // 'strict-dynamic' drops scheme sources like blob: from script-src. "*"
  // never matches blob: in CSP3.
  if (sources.includes("'strict-dynamic'")) return false;
  return sources.includes("blob:");
}

/** `policies`: each Content-Security-Policy(-Report-Only) header value or
 * <meta http-equiv> content. A header value can carry several policies
 * separated by commas; every one of them must allow blob: workers. */
export function cspAllowsBlobWorkers(policies: readonly string[]): boolean {
  return policies.every((value) => value.split(",").every(policyAllowsBlobWorkers));
}

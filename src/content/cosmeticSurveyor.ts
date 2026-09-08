// Progressive generic-cosmetic injection. cosmeticFilter.ts injects the
// always-on generic slice (genericHigh) and the domain-scoped rules up
// front; this surveys the DOM for the class/id tokens that actually appear
// on the page and asks the service worker for the token-anchored generic
// selectors filed under them -- so a page's style engine evaluates the
// handful of generic selectors relevant to it, not the whole ~17k set.
//
// Mirrors uBlock Origin's low-level-token surveyor: an initial pass, then a
// batched MutationObserver, self-disabling once it stops finding anything
// new or once it has walked MAX_SURVEY_NODES nodes (the backstop against a
// pathological mutation flood).
//
// The token -> selector lookup lives in the service worker
// (background/cosmeticIndex.ts, reached via get-cosmetic-generics) so the
// ~684 KB generic index is never fetched or parsed on the page thread; this
// module only collects tokens, hashes them, and applies what comes back.
import { tokenHash } from "../shared/tokenHash";

const MAX_SURVEY_NODES = 100_000;
const FLUSH_DELAY_MS = 250;
// Stop after this many consecutive flushes that turned up no new selector.
// Mutations may still be arriving -- a busy SPA feed that never adds an
// ad-relevant class shouldn't keep the observer alive forever.
const QUIET_FLUSHES_TO_STOP = 8;

/** The class and id tokens on one element. */
export function tokensOfElement(el: Element): string[] {
  const out: string[] = [];
  if (el.id) out.push(el.id);
  const classList = el.classList;
  for (let i = 0; i < classList.length; i += 1) {
    const token = classList[i];
    if (token) out.push(token);
  }
  return out;
}

/** Every class/id token on `root` and its descendants (only elements that
 * carry a class or id are visited). */
export function collectTokens(root: Element | Document | DocumentFragment): string[] {
  const out: string[] = [];
  if (root instanceof Element && (root.id || root.classList.length)) {
    out.push(...tokensOfElement(root));
  }
  const withAttr = root.querySelectorAll("[class],[id]");
  for (let i = 0; i < withAttr.length; i += 1) {
    const el = withAttr[i];
    if (el) out.push(...tokensOfElement(el));
  }
  return out;
}

export interface SurveyorHandle {
  stop(): void;
}

export interface SurveyorOptions {
  flushDelayMs?: number;
  maxSurveyNodes?: number;
  quietFlushesToStop?: number;
}

/** Resolve a batch of class/id token hashes to the bundled generic selectors
 * filed under them (minus the current hostname's exceptions). Wired by
 * cosmeticFilter.ts to a get-cosmetic-generics message; rejects if the
 * service worker is momentarily unreachable. */
export type ResolveHashes = (hashes: string[]) => Promise<string[]>;

/**
 * Start surveying `doc` for cosmetic-relevant tokens. `alreadyInjected` is
 * the set of generic selectors cosmeticFilter.ts has already put on the page
 * (the genericHigh slice) so they're never re-emitted. `resolveHashes` turns
 * a batch of token hashes into selectors; `onNewSelectors` is called,
 * batched, with each new group to add.
 */
export function startSurveyor(
  doc: Document,
  alreadyInjected: Iterable<string>,
  resolveHashes: ResolveHashes,
  onNewSelectors: (selectors: string[]) => void,
  options: SurveyorOptions = {}
): SurveyorHandle {
  const flushDelayMs = options.flushDelayMs ?? FLUSH_DELAY_MS;
  const maxSurveyNodes = options.maxSurveyNodes ?? MAX_SURVEY_NODES;
  const quietFlushesToStop = options.quietFlushesToStop ?? QUIET_FLUSHES_TO_STOP;

  const seenHashes = new Set<string>();
  const injected = new Set(alreadyInjected);
  let nodesSurveyed = 0;
  let quietFlushes = 0;
  let stopped = false;
  // One resolveHashes call in flight at a time: keeps seenHashes / injected
  // bookkeeping and the quiet-flush count race-free across the await.
  let flushing = false;
  let pending: string[] = [];
  let timer: ReturnType<typeof setTimeout> | undefined;

  function stop(): void {
    if (stopped) return;
    stopped = true;
    if (timer !== undefined) {
      clearTimeout(timer);
      timer = undefined;
    }
    observer.disconnect();
  }

  /** Not-yet-seen token hashes from `tokens`, marked seen as they're pulled. */
  function newHashesFrom(tokens: string[]): string[] {
    const fresh: string[] = [];
    for (const token of tokens) {
      const hash = tokenHash(token);
      if (!seenHashes.has(hash)) {
        seenHashes.add(hash);
        fresh.push(hash);
      }
    }
    return fresh;
  }

  /** Resolve `hashes` to selectors and inject the ones not already on the
   * page. Returns whether anything new was added. Holds `flushing` for the
   * duration so only one request is in flight at a time. */
  async function consume(hashes: string[]): Promise<boolean> {
    if (hashes.length === 0) return false;
    flushing = true;
    try {
      const selectors = await resolveHashes(hashes);
      if (stopped) return false;
      const fresh = selectors.filter((selector) => !injected.has(selector));
      if (fresh.length === 0) return false;
      for (const selector of fresh) injected.add(selector);
      onNewSelectors(fresh);
      return true;
    } catch {
      // A dropped message (service worker restarting) just means this
      // batch's generics don't land this round. The tokens stay marked seen
      // so we don't hammer a struggling worker with the same request;
      // genericHigh and the domain-scoped rules are already on the page.
      return false;
    } finally {
      flushing = false;
    }
  }

  async function flush(): Promise<void> {
    timer = undefined;
    if (stopped || flushing) return;
    const batch = pending;
    pending = [];
    const added = await consume(newHashesFrom(batch));
    if (stopped) return;
    quietFlushes = added ? 0 : quietFlushes + 1;
    if (quietFlushes >= quietFlushesToStop || nodesSurveyed >= maxSurveyNodes) {
      stop();
      return;
    }
    if (pending.length > 0) schedule();
  }

  function schedule(): void {
    if (timer === undefined && !stopped && !flushing) timer = setTimeout(() => void flush(), flushDelayMs);
  }

  const observer = new MutationObserver((records) => {
    if (stopped) return;
    for (const record of records) {
      if (record.type === "attributes") {
        if (record.target instanceof Element) {
          pending.push(...tokensOfElement(record.target));
          nodesSurveyed += 1;
        }
        continue;
      }
      for (const node of record.addedNodes) {
        if (!(node instanceof Element)) continue;
        pending.push(...collectTokens(node));
        nodesSurveyed += 1 + node.querySelectorAll("*").length;
      }
    }
    schedule();
  });

  // Initial pass over whatever the parser has produced so far (at
  // document_start that's usually just <html><head>; the rest arrives as
  // mutations). Kicked immediately rather than after flushDelayMs, and
  // outside the quiet-flush accounting -- an empty first pass isn't a "quiet
  // flush". If mutations land while it's in flight, pick them up after.
  void consume(newHashesFrom(collectTokens(doc))).then(() => {
    if (!stopped && pending.length > 0) schedule();
  });
  observer.observe(doc.documentElement, {
    childList: true,
    subtree: true,
    attributes: true,
    attributeFilter: ["class", "id"],
  });

  return { stop };
}

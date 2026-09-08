// Progressive generic-cosmetic injection. cosmeticFilter.ts injects the
// always-on generic slice (genericHigh) and the domain-scoped rules up
// front; this surveys the DOM for the class/id tokens that actually appear
// on the page and asks for the token-anchored generic selectors
// (genericByHash) that match them -- so a page's style engine evaluates the
// handful of generic selectors relevant to it, not the whole ~17k set.
//
// Mirrors uBlock Origin's low-level-token surveyor: an initial pass, then a
// batched MutationObserver, self-disabling once it stops finding anything
// new or once it has walked MAX_SURVEY_NODES nodes (the backstop against a
// pathological mutation flood).
import { tokenHash } from "../shared/tokenHash";
import { genericSelectorsForTokens, type CosmeticIndex } from "./cosmeticSelectors";

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
}

/**
 * Start surveying `doc` for cosmetic-relevant tokens. `alreadyInjected` is
 * the set of generic selectors cosmeticFilter.ts has already put on the
 * page (the genericHigh slice) so they're never re-emitted. `onNewSelectors`
 * is called, batched, with each new group of token-anchored generic
 * selectors to add.
 */
export function startSurveyor(
  doc: Document,
  index: CosmeticIndex,
  hostname: string,
  alreadyInjected: Iterable<string>,
  onNewSelectors: (selectors: string[]) => void,
  options: SurveyorOptions = {}
): SurveyorHandle {
  const flushDelayMs = options.flushDelayMs ?? FLUSH_DELAY_MS;
  const maxSurveyNodes = options.maxSurveyNodes ?? MAX_SURVEY_NODES;

  const seenHashes = new Set<string>();
  const injected = new Set(alreadyInjected);
  let nodesSurveyed = 0;
  let quietFlushes = 0;
  let stopped = false;
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

  function consume(tokens: string[]): void {
    const newHashes: string[] = [];
    for (const token of tokens) {
      const hash = tokenHash(token);
      if (!seenHashes.has(hash)) {
        seenHashes.add(hash);
        newHashes.push(hash);
      }
    }
    if (newHashes.length === 0) return;
    const fresh = genericSelectorsForTokens(index, hostname, newHashes).filter((s) => !injected.has(s));
    if (fresh.length === 0) return;
    for (const selector of fresh) injected.add(selector);
    onNewSelectors(fresh);
  }

  function flush(): void {
    timer = undefined;
    if (stopped) return;
    const before = injected.size;
    const batch = pending;
    pending = [];
    consume(batch);
    quietFlushes = injected.size > before ? 0 : quietFlushes + 1;
    if (quietFlushes >= QUIET_FLUSHES_TO_STOP || nodesSurveyed >= maxSurveyNodes) stop();
  }

  function schedule(): void {
    if (timer === undefined && !stopped) timer = setTimeout(flush, flushDelayMs);
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
  // mutations).
  consume(collectTokens(doc));
  observer.observe(doc.documentElement, {
    childList: true,
    subtree: true,
    attributes: true,
    attributeFilter: ["class", "id"],
  });

  return { stop };
}

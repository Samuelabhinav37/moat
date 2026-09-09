// Runtime engine for procedural (extended-selector) cosmetic rules --
// :has-text(), :matches-css(), :xpath(), :upward(), :min-text-length(),
// :remove(). A plain <style> can't express these: they depend on the live
// DOM's text / computed style / structure, so they need JS re-evaluating as
// the page mutates.
//
// The rules come from cosmetics-meta.json via the get-procedural-rules
// message (background/cosmeticIndex.ts), built from the filter lists by
// scripts/lib/parseProceduralSelector.mjs. Every rule is re-validated here
// (isSafeProcedural*) before it runs, and each rule's whole evaluation is
// wrapped so a bad one can't break the page or the other rules.
//
// Budgeted like cosmeticSurveyor.ts: an initial pass, then a batched
// MutationObserver that self-disables once it stops finding anything or hits
// a hard pass cap.
import { isSafeProceduralPrefix, isSafeProceduralTask } from "../shared/proceduralSafety";
import type { ProceduralRule, ProceduralTask } from "../types";

const FLUSH_DELAY_MS = 300;
const QUIET_FLUSHES_TO_STOP = 6;
const MAX_PASSES = 60;
const HIDDEN_ATTR = "data-moat-proc-hidden";

function toRegExp(pattern: string): RegExp | null {
  const m = pattern.match(/^\/(.*)\/([a-z]*)$/is);
  if (!m) return null;
  try {
    return new RegExp(m[1] ?? "", m[2] ?? "");
  } catch {
    return null;
  }
}

function textMatches(text: string, pattern: string): boolean {
  const re = toRegExp(pattern);
  return re ? re.test(text) : text.includes(pattern);
}

function xpathFrom(doc: Document, context: Node, expr: string): Element[] {
  const out: Element[] = [];
  const result = doc.evaluate(expr, context, null, XPathResult.ORDERED_NODE_SNAPSHOT_TYPE, null);
  for (let i = 0; i < result.snapshotLength; i += 1) {
    const node = result.snapshotItem(i);
    if (node instanceof Element) out.push(node);
  }
  return out;
}

function runTask(task: ProceduralTask, els: Element[], doc: Document): Element[] {
  switch (task[0]) {
    case "has-text":
      return els.filter((el) => textMatches(el.textContent ?? "", task[1]));
    case "min-text-length":
      return els.filter((el) => (el.textContent ?? "").trim().length >= task[1]);
    case "upward": {
      const seen = new Set<Element>();
      for (const el of els) {
        let cur: Element | null = el;
        for (let i = 0; i < task[1] && cur; i += 1) cur = cur.parentElement;
        if (cur) seen.add(cur);
      }
      return [...seen];
    }
    case "upward-sel": {
      const seen = new Set<Element>();
      for (const el of els) {
        // Strictly an ancestor -- start the closest() search at the parent.
        const found = el.parentElement?.closest(task[1]) ?? null;
        if (found) seen.add(found);
      }
      return [...seen];
    }
    case "matches-css": {
      const pseudo = task[1] || null;
      const spec = task[2];
      const colon = spec.indexOf(":");
      const prop = spec.slice(0, colon).trim();
      const wantRaw = spec.slice(colon + 1).trim();
      const wantRe = toRegExp(wantRaw);
      return els.filter((el) => {
        const got = getComputedStyle(el, pseudo).getPropertyValue(prop).trim();
        return wantRe ? wantRe.test(got) : got === wantRaw;
      });
    }
    case "xpath": {
      const seen = new Set<Element>();
      for (const el of els) for (const found of xpathFrom(doc, el, task[1])) seen.add(found);
      return [...seen];
    }
    default:
      return [];
  }
}

/** The elements a rule currently selects, or [] on any error. */
function selectFor(rule: ProceduralRule, doc: Document): Element[] {
  try {
    let els: Element[];
    if (rule.s === "") {
      // Parser guarantees a prefix unless the chain starts with :xpath().
      const first = rule.t[0];
      if (!first || first[0] !== "xpath") return [];
      els = xpathFrom(doc, doc, first[1]);
      for (let i = 1; i < rule.t.length; i += 1) {
        const task = rule.t[i];
        if (!task) break;
        els = runTask(task, els, doc);
        if (els.length === 0) return [];
      }
      return els;
    }
    els = [...doc.querySelectorAll(rule.s)];
    for (const task of rule.t) {
      els = runTask(task, els, doc);
      if (els.length === 0) return [];
    }
    return els;
  } catch {
    return [];
  }
}

const NEVER_REMOVE = new Set(["HTML", "HEAD", "BODY"]);

function isValid(rule: ProceduralRule): boolean {
  if (rule.s !== "" && !isSafeProceduralPrefix(rule.s)) return false;
  if (!Array.isArray(rule.t)) return false;
  // Empty task chain is only meaningful as a bare `selector:remove()`.
  if (rule.t.length === 0) return rule.r === 1 && rule.s !== "";
  return rule.t.every((task) => Array.isArray(task) && isSafeProceduralTask(task));
}

export interface ProceduralHandle {
  stop(): void;
}

export interface ProceduralOptions {
  flushDelayMs?: number;
  quietFlushesToStop?: number;
  maxPasses?: number;
}

/**
 * Start applying `rules` to `doc` and keep them applied as it mutates.
 * Returns a handle whose stop() disconnects everything. A no-op (returns an
 * inert handle) when there are no valid rules.
 */
export function startProceduralCosmetic(
  doc: Document,
  rules: ProceduralRule[],
  options: ProceduralOptions = {}
): ProceduralHandle {
  const flushDelayMs = options.flushDelayMs ?? FLUSH_DELAY_MS;
  const quietFlushesToStop = options.quietFlushesToStop ?? QUIET_FLUSHES_TO_STOP;
  const maxPasses = options.maxPasses ?? MAX_PASSES;

  const active = rules.filter(isValid);
  if (active.length === 0) return { stop() {} };

  let stopped = false;
  let quietFlushes = 0;
  let passes = 0;
  let timer: ReturnType<typeof setTimeout> | undefined;

  function actOn(rule: ProceduralRule, els: Element[]): number {
    let acted = 0;
    for (const el of els) {
      try {
        if (rule.r) {
          if (el !== doc.documentElement && !NEVER_REMOVE.has(el.tagName) && el.isConnected) {
            el.remove();
            acted += 1;
          }
        } else if (!el.hasAttribute(HIDDEN_ATTR)) {
          el.setAttribute(HIDDEN_ATTR, "");
          (el as HTMLElement).style.setProperty("display", "none", "important");
          acted += 1;
        }
      } catch {
        // one element failing shouldn't abort the rest of the rule
      }
    }
    return acted;
  }

  function pass(): number {
    let acted = 0;
    for (const rule of active) acted += actOn(rule, selectFor(rule, doc));
    return acted;
  }

  function stop(): void {
    if (stopped) return;
    stopped = true;
    if (timer !== undefined) {
      clearTimeout(timer);
      timer = undefined;
    }
    observer.disconnect();
  }

  function flush(): void {
    timer = undefined;
    if (stopped) return;
    passes += 1;
    const acted = pass();
    quietFlushes = acted > 0 ? 0 : quietFlushes + 1;
    if (quietFlushes >= quietFlushesToStop || passes >= maxPasses) stop();
  }

  function schedule(): void {
    if (timer === undefined && !stopped) timer = setTimeout(flush, flushDelayMs);
  }

  const observer = new MutationObserver(() => {
    if (!stopped) schedule();
  });

  // First pass now; then watch for the DOM changing under it.
  passes += 1;
  pass();
  observer.observe(doc.documentElement, {
    childList: true,
    subtree: true,
    characterData: true,
    attributes: true,
    attributeFilter: ["class", "style"],
  });

  return { stop };
}

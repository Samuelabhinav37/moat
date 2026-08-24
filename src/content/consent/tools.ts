/**
 * Element-finding engine, ported from Consent-O-Matic's Tools.js
 * (https://github.com/cavi-au/Consent-O-Matic/blob/master/Extension/Tools.js,
 * MIT-licensed). Two real deviations from the original, both because they
 * match what the shipped extension actually does today, not what its own
 * JSON schema aspirationally describes:
 *
 * - `styleFilter` is a documented Selection field in rules.schema.json, but
 *   Tools.js's actual filter code checks `options.styleFilters` (plural) --
 *   a property no real rule file sets. It's dead code upstream; not ported.
 * - DOMSelection is schema'd as arbitrarily recursively nestable
 *   ({parent?, target} where target/parent can themselves be {parent,
 *   target} wrappers), but Tools.find()/findElement() only ever resolve one
 *   level (an action's own .target/.parent must each be a bare Selection).
 *   `find` below is intentionally defensive here rather than replicating
 *   that latent crash-on-deeper-nesting behavior: a value with `.selector`
 *   is always treated as a usable target directly, at any position.
 *
 * No module-level mutable "current root" the way Tools.js's static
 * `Tools.base` is -- threaded explicitly as `FindContext.base` instead, so
 * this has no shared state between calls/tests.
 */
import type { DOMSelection, Selection } from "./types";

export type ParentNodeLike = Document | Element | ShadowRoot;

export interface FindContext {
  base: ParentNodeLike | null;
  /** Elements HideAction marked hideFromDetection: true -- displayFilter
   * treats these as permanently "not showing" regardless of actual
   * offsetHeight, mirroring the ConsentOMatic-CMP-NoDetect class upstream
   * (a WeakSet here instead, so nothing is left visible in the DOM). */
  hiddenFromDetection: WeakSet<Element>;
}

export function newContext(base: ParentNodeLike | null = null): FindContext {
  return { base, hiddenFromDetection: new WeakSet() };
}

function isSelection(value: DOMSelection): value is Selection {
  return value !== null && "selector" in value;
}

function splitTargetParent(value: DOMSelection): { target: DOMSelection; parent?: DOMSelection } {
  if (value === null) return { target: null };
  if (isSelection(value)) return { target: value };
  return { target: value.target, parent: value.parent };
}

/** Tools.find()/findElement() upstream only ever resolve one level of
 * DOMSelection nesting -- see file header. A value that isn't itself a
 * bare Selection is expected to be a {parent,target} wrapper whose own
 * `.target` already is one; anything deeper resolves to null rather than
 * being (mis)treated as further-nestable. */
function asSelection(value: DOMSelection): Selection | null {
  if (value === null) return null;
  if (isSelection(value)) return value;
  return isSelection(value.target) ? value.target : null;
}

function shadowAwareRoot(top: ParentNodeLike): ParentNodeLike {
  if (top instanceof Element) {
    if (top.shadowRoot) return top.shadowRoot;
    const closed = (top as Element & { openOrClosedShadowRoot?: ShadowRoot }).openOrClosedShadowRoot;
    if (closed) return closed;
  }
  return top;
}

function textOf(el: Element): string {
  return (el.textContent ?? "").toLowerCase().replace(/\s{2,}/g, " ");
}

function matchesTextFilter(el: Element, textFilter: string | string[]): boolean {
  const content = textOf(el);
  const needles = Array.isArray(textFilter) ? textFilter : [textFilter];
  return needles.some((needle) => content.includes(needle.toLowerCase().replace(/\s{2,}/g, " ")));
}

function isInIframe(): boolean {
  try {
    return window.location !== window.parent.location;
  } catch {
    // Cross-origin parent -- accessing .location throws, and being unable
    // to compare at all means we genuinely are in a (cross-origin) frame.
    return true;
  }
}

export function findElement(
  selection: Selection | null,
  parentEl: Element | null,
  ctx: FindContext,
  multiple: false
): Element | null;
export function findElement(
  selection: Selection | null,
  parentEl: Element | null,
  ctx: FindContext,
  multiple: true
): Element[];
export function findElement(
  selection: Selection | null,
  parentEl: Element | null,
  ctx: FindContext,
  multiple: boolean
): Element | null | Element[] {
  if (selection === null) return multiple ? [] : null;

  let possible: Element[];
  if (selection.selector.trim() === ":scope") {
    const scopeRoot = parentEl ?? (ctx.base as Element | null);
    possible = scopeRoot ? [scopeRoot] : [];
  } else {
    const top: ParentNodeLike = parentEl ?? ctx.base ?? document;
    const root = shadowAwareRoot(top);
    possible = Array.from(root.querySelectorAll(selection.selector));
  }

  if (selection.textFilter != null) {
    possible = possible.filter((el) => matchesTextFilter(el, selection.textFilter!));
  }

  // styleFilter deliberately not applied -- see file header.

  if (selection.displayFilter != null) {
    const wantShowing = selection.displayFilter;
    possible = possible.filter((el) => {
      if (ctx.hiddenFromDetection.has(el)) return !wantShowing;
      const showing = (el as HTMLElement).offsetHeight !== 0;
      return wantShowing ? showing : !showing;
    });
  }

  if (selection.iframeFilter != null) {
    const wantIframe = selection.iframeFilter;
    possible = possible.filter(() => isInIframe() === wantIframe);
  }

  if (selection.childFilter !== undefined && selection.childFilter !== null) {
    const childSelection = selection.childFilter;
    const negate = selection.childFilterNegate === true;
    possible = possible.filter((el) => {
      const childCtx: FindContext = { base: el, hiddenFromDetection: ctx.hiddenFromDetection };
      const result = find(childSelection, childCtx, false);
      return negate ? result.target === null : result.target !== null;
    });
  }

  return multiple ? possible : (possible[0] ?? null);
}

export interface FindResult {
  parent: Element | null;
  target: Element | null;
}

export function find(selection: DOMSelection, ctx: FindContext, multiple: false): FindResult;
export function find(selection: DOMSelection, ctx: FindContext, multiple: true): FindResult[];
export function find(selection: DOMSelection, ctx: FindContext, multiple: boolean): FindResult | FindResult[] {
  const { target, parent } = splitTargetParent(selection);
  const results: FindResult[] = [];

  if (parent != null) {
    const parents = findElement(asSelection(parent), null, ctx, true);
    for (const p of parents) {
      const targets = findElement(asSelection(target), p, ctx, true);
      for (const t of targets) results.push({ parent: p, target: t });
      if (targets.length === 0) results.push({ parent: p, target: null });
    }
  } else {
    const targets = findElement(asSelection(target), null, ctx, true);
    for (const t of targets) results.push({ parent: null, target: t });
  }

  if (results.length === 0) results.push({ parent: null, target: null });

  return multiple ? results : results[0]!;
}

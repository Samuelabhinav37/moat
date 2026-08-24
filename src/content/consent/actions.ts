/**
 * Action interpreter, ported from Consent-O-Matic's Action.js
 * (https://github.com/cavi-au/Consent-O-Matic/blob/master/Extension/Action.js,
 * MIT-licensed). Deliberate deviations from the original, each because
 * Moat has no use for the thing being dropped or because it's a real risk
 * a silent extension shouldn't take:
 *
 * - No progress dialog, PIP shrink-to-corner animation, debug logging, or
 *   click-delay/scroll-into-view timing -- all UI chrome for Consent-O-
 *   Matic's own extension. In real (non-debug) operation these already
 *   amount to zero added delay upstream too (their own `timeout` getter
 *   returns 0 outside debug/PIP mode) -- dropping them changes nothing
 *   observable, just the code that would have been a no-op anyway.
 * - `close` is a no-op, not `window.close()`. Upstream uses it for
 *   popup-window-based consent flows; Moat's consent rejector only ever
 *   runs in the page's own top-frame tab, where closing the window would
 *   close the user's actual browser tab -- an unacceptable failure mode
 *   for one mis-authored or unexpectedly-matched rule.
 * - `slide` (drag-simulated consent sliders) isn't implemented. Falls
 *   through to the same safe no-op every genuinely unknown action type
 *   gets, matching Consent-O-Matic's own defensive fallback for anything
 *   its Action.createAction doesn't recognize.
 * - HideAction applies `display:none` directly rather than the PIP/
 *   floating-preview visual Consent-O-Matic's extension shows -- Moat's
 *   cosmetic filtering elsewhere just removes things from view, no
 *   animated chrome.
 */
import { find, type FindContext } from "./tools";
import { matches } from "./matchers";
import type { ActionConfig, ConsentItemConfig, ConsentType } from "./types";

export interface ActionContext {
  find: FindContext;
  consentTypes: Record<ConsentType, boolean>;
  /** Resolves a "runmethod" action against the CMP's own other named
   * methods -- provided by cmp.ts, which owns the method map. */
  runMethod: (name: string) => Promise<void>;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function doClick(action: Extract<ActionConfig, { type: "click" }>, ctx: ActionContext): Promise<void> {
  const target = find(action, ctx.find, false).target;
  if (target === null) return;
  if (action.openInTab) {
    target.dispatchEvent(new MouseEvent("click", { ctrlKey: true, shiftKey: true, bubbles: true }));
  } else {
    (target as HTMLElement).click();
  }
}

async function doMultiClick(action: Extract<ActionConfig, { type: "multiclick" }>, ctx: ActionContext): Promise<void> {
  for (const { target } of find(action, ctx.find, true)) {
    if (target !== null) (target as HTMLElement).click();
  }
}

function doHide(action: Extract<ActionConfig, { type: "hide" }>, ctx: ActionContext): void {
  const target = find(action, ctx.find, false).target;
  if (target === null) return;
  (target as HTMLElement).style.setProperty("display", "none", "important");
  if (action.hideFromDetection) ctx.find.hiddenFromDetection.add(target);
}

async function doWaitCss(action: Extract<ActionConfig, { type: "waitcss" }>, ctx: ActionContext): Promise<void> {
  const negated = action.negated === true;
  let retries = action.retries ?? 10;
  const waitTime = action.waitTime ?? 250;
  for (;;) {
    const present = find(action, ctx.find, false).target !== null;
    const done = negated ? !present : present;
    if (done || retries <= 0) return;
    retries -= 1;
    await sleep(waitTime);
  }
}

async function doIfCss(action: Extract<ActionConfig, { type: "ifcss" }>, ctx: ActionContext): Promise<void> {
  const present = find(action, ctx.find, false).target !== null;
  const branch = present ? action.trueAction : action.falseAction;
  if (branch) await executeAction(branch, ctx);
}

async function doForEach(action: Extract<ActionConfig, { type: "foreach" }>, ctx: ActionContext): Promise<void> {
  for (const { target } of find(action, ctx.find, true)) {
    if (target === null) continue;
    const childCtx: ActionContext = { ...ctx, find: { base: target, hiddenFromDetection: ctx.find.hiddenFromDetection } };
    await executeAction(action.action, childCtx);
  }
}

async function setConsentEnabled(item: ConsentItemConfig, ctx: ActionContext, enabled: boolean): Promise<void> {
  if (item.toggleAction != null) {
    if (item.matcher == null) return; // toggling needs a matcher to know current state -- skip, don't guess
    if (matches(item.matcher, ctx.find) !== enabled) await executeAction(item.toggleAction, ctx);
    return;
  }

  if (item.matcher != null && item.matcher.type === "onoff") {
    const current = matches(item.matcher, ctx.find);
    if (current && !enabled && item.falseAction) await executeAction(item.falseAction, ctx);
    else if (!current && enabled && item.trueAction) await executeAction(item.trueAction, ctx);
    return;
  }

  if (enabled && item.trueAction) await executeAction(item.trueAction, ctx);
  else if (!enabled && item.falseAction) await executeAction(item.falseAction, ctx);
}

async function doConsent(action: Extract<ActionConfig, { type: "consent" }>, ctx: ActionContext): Promise<void> {
  for (const item of action.consents) {
    const wanted = ctx.consentTypes[item.type] ?? false;
    await setConsentEnabled(item, ctx, wanted);
  }
}

async function doIfAllowAll(action: Extract<ActionConfig, { type: "ifallowall" }>, ctx: ActionContext): Promise<void> {
  const allTrue = Object.values(ctx.consentTypes).every((v) => v === true);
  const branch = allTrue ? action.trueAction : action.falseAction;
  if (branch) await executeAction(branch, ctx);
}

async function doIfAllowNone(action: Extract<ActionConfig, { type: "ifallownone" }>, ctx: ActionContext): Promise<void> {
  const allFalse = Object.values(ctx.consentTypes).every((v) => v === false);
  const branch = allFalse ? action.trueAction : action.falseAction;
  if (branch) await executeAction(branch, ctx);
}

async function doRunRooted(action: Extract<ActionConfig, { type: "runrooted" }>, ctx: ActionContext): Promise<void> {
  const rootCtx: FindContext = {
    base: action.ignoreOldRoot ? null : ctx.find.base,
    hiddenFromDetection: ctx.find.hiddenFromDetection,
  };
  const target = find(action, rootCtx, false).target;
  if (target === null) return;
  await executeAction(action.action, { ...ctx, find: { base: target, hiddenFromDetection: ctx.find.hiddenFromDetection } });
}

export async function executeAction(action: ActionConfig, ctx: ActionContext): Promise<void> {
  switch (action.type) {
    case "list":
      for (const sub of action.actions) await executeAction(sub, ctx);
      return;
    case "click":
      return doClick(action, ctx);
    case "multiclick":
      return doMultiClick(action, ctx);
    case "hide":
      return doHide(action, ctx);
    case "wait":
      return sleep(action.waitTime);
    case "waitcss":
      return doWaitCss(action, ctx);
    case "ifcss":
      return doIfCss(action, ctx);
    case "foreach":
      return doForEach(action, ctx);
    case "consent":
      return doConsent(action, ctx);
    case "ifallowall":
      return doIfAllowAll(action, ctx);
    case "ifallownone":
      return doIfAllowNone(action, ctx);
    case "runrooted":
      return doRunRooted(action, ctx);
    case "runmethod":
      return ctx.runMethod(action.method);
    case "close": // deliberately a no-op -- see file header
    case "slide": // deliberately unsupported -- see file header
      return;
  }
}

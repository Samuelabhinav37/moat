/**
 * One CMP's detectors + methods, ported from Consent-O-Matic's CMP.js
 * (https://github.com/cavi-au/Consent-O-Matic/blob/master/Extension/CMP.js,
 * MIT-licensed) minus the hidden-target un-hide bookkeeping and step-count/
 * progress-dialog machinery, neither of which Moat's silent interpreter has
 * a use for (see actions.ts's file header for the same reasoning re: hide).
 */
import { executeAction, type ActionContext } from "./actions";
import { matches } from "./matchers";
import type { FindContext } from "./tools";
import type { ActionConfig, CmpConfig, ConsentType, DetectorConfig, MatcherConfig } from "./types";

function matchersOf(m: MatcherConfig | (MatcherConfig | null)[] | null | undefined): MatcherConfig[] {
  if (m == null) return [];
  const list = Array.isArray(m) ? m : [m];
  return list.filter((x): x is MatcherConfig => x != null);
}

function detectorPresent(detector: DetectorConfig, ctx: FindContext): boolean {
  const ms = matchersOf(detector.presentMatcher);
  return ms.length > 0 && ms.every((m) => matches(m, ctx));
}

function detectorShowing(detector: DetectorConfig, ctx: FindContext): boolean {
  const ms = matchersOf(detector.showingMatcher);
  if (ms.length === 0) return true; // no showingMatcher configured -- always considered showing
  return ms.every((m) => matches(m, ctx));
}

export class Cmp {
  readonly name: string;
  private readonly detectors: DetectorConfig[];
  private readonly methods: Map<string, ActionConfig>;

  constructor(name: string, config: CmpConfig) {
    this.name = name;
    this.detectors = config.detectors ?? [];
    this.methods = new Map();
    for (const method of config.methods ?? []) {
      if (method.action != null) this.methods.set(method.name, method.action);
    }
  }

  private matchedDetector(ctx: FindContext): DetectorConfig | null {
    return this.detectors.find((d) => detectorPresent(d, ctx)) ?? null;
  }

  isPresent(ctx: FindContext): boolean {
    return this.matchedDetector(ctx) !== null;
  }

  isShowing(ctx: FindContext): boolean {
    const detector = this.matchedDetector(ctx);
    return detector !== null && detectorShowing(detector, ctx);
  }

  /** Same result as isPresent(ctx) && isShowing(ctx), but runs
   * matchedDetector's full detector scan once instead of twice -- engine.ts
   * calls this back-to-back for every CMP in the list on every attempt. */
  isPresentAndShowing(ctx: FindContext): boolean {
    const detector = this.matchedDetector(ctx);
    return detector !== null && detectorShowing(detector, ctx);
  }

  async runMethod(name: string, consentTypes: Record<ConsentType, boolean>, findCtx: FindContext): Promise<void> {
    const action = this.methods.get(name);
    if (action == null) return;
    const ctx: ActionContext = {
      find: findCtx,
      consentTypes,
      runMethod: (methodName) => this.runMethod(methodName, consentTypes, findCtx),
    };
    await executeAction(action, ctx);
  }
}

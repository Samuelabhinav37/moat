/**
 * Rule schema types, mirroring Consent-O-Matic's rules.schema.json
 * (https://github.com/cavi-au/Consent-O-Matic/blob/master/rules.schema.json,
 * MIT-licensed) closely enough that their vendored Rules.json parses
 * directly against these. Consumed by tools.ts/matchers.ts/actions.ts/
 * cmp.ts/engine.ts, a from-scratch interpreter -- see engine.ts for what's
 * deliberately not ported (slide, the progress-dialog/PIP visuals, the
 * indefinite background rescan loop) and why.
 */

export interface Selection {
  selector: string;
  textFilter?: string | string[];
  styleFilter?: { option: string; value: string; negated?: boolean }[];
  displayFilter?: boolean;
  iframeFilter?: boolean;
  childFilter?: DOMSelection;
  childFilterNegate?: boolean;
}

/** Either a bare Selection, or a {parent, target} pair where parent is
 * itself resolved first and target is searched within it. */
export type DOMSelection = Selection | { parent?: DOMSelection; target: DOMSelection } | null;

export type ConsentType = "A" | "B" | "D" | "E" | "F" | "X";

export interface CssMatcherConfig {
  type: "css";
  parent?: DOMSelection;
  target: DOMSelection;
}
export interface CheckboxMatcherConfig {
  type: "checkbox";
  parent?: DOMSelection;
  target: DOMSelection;
  negated?: boolean;
}
export interface OnOffMatcherConfig {
  type: "onoff";
  onMatcher: DOMSelection;
  offMatcher: DOMSelection;
}
export interface UrlMatcherConfig {
  type: "url";
  url: string | string[];
  regexp?: boolean;
  negated?: boolean;
}
export type MatcherConfig = CssMatcherConfig | CheckboxMatcherConfig | OnOffMatcherConfig | UrlMatcherConfig;

export interface DetectorConfig {
  presentMatcher?: MatcherConfig | (MatcherConfig | null)[] | null;
  showingMatcher?: MatcherConfig | (MatcherConfig | null)[] | null;
}

export interface ConsentItemConfig {
  type: ConsentType;
  matcher?: MatcherConfig;
  toggleAction?: ActionConfig;
  trueAction?: ActionConfig;
  falseAction?: ActionConfig;
}

export interface ClickActionConfig {
  type: "click";
  target: DOMSelection;
  parent?: DOMSelection;
  openInTab?: boolean;
  noTimeout?: boolean;
}
export interface MultiClickActionConfig {
  type: "multiclick";
  target: DOMSelection;
  parent?: DOMSelection;
}
export interface ListActionConfig {
  type: "list";
  actions: ActionConfig[];
}
export interface ConsentActionConfig {
  type: "consent";
  consents: ConsentItemConfig[];
}
export interface IfCssActionConfig {
  type: "ifcss";
  target: DOMSelection;
  parent?: DOMSelection;
  trueAction?: ActionConfig;
  falseAction?: ActionConfig;
}
export interface WaitForCssActionConfig {
  type: "waitcss";
  target: DOMSelection;
  parent?: DOMSelection;
  retries?: number;
  waitTime?: number;
  negated?: boolean;
}
export interface ForEachActionConfig {
  type: "foreach";
  target: DOMSelection;
  parent?: DOMSelection;
  action: ActionConfig;
}
export interface HideActionConfig {
  type: "hide";
  target: DOMSelection;
  parent?: DOMSelection;
  hideFromDetection?: boolean;
  forceHide?: boolean;
}
export interface CloseActionConfig {
  type: "close";
}
export interface WaitActionConfig {
  type: "wait";
  waitTime: number;
}
export interface IfAllowAllActionConfig {
  type: "ifallowall";
  trueAction?: ActionConfig;
  falseAction?: ActionConfig;
}
export interface IfAllowNoneActionConfig {
  type: "ifallownone";
  trueAction?: ActionConfig;
  falseAction?: ActionConfig;
}
export interface RunRootedActionConfig {
  type: "runrooted";
  parent?: DOMSelection;
  target: DOMSelection;
  action: ActionConfig;
  ignoreOldRoot?: boolean;
}
export interface RunMethodActionConfig {
  type: "runmethod";
  method: string;
}
/** Deliberately unsupported (drag-simulation-based consent sliders, a small
 * minority of rules): recognized so JSON.parse round-trips cleanly and the
 * interpreter can fall through to its safe unknown-action no-op, same as
 * Consent-O-Matic's own Action.createAction does for anything it doesn't
 * recognize either (see actions.ts). */
export interface SlideActionConfig {
  type: "slide";
  [key: string]: unknown;
}

export type ActionConfig =
  | ClickActionConfig
  | MultiClickActionConfig
  | ListActionConfig
  | ConsentActionConfig
  | IfCssActionConfig
  | WaitForCssActionConfig
  | ForEachActionConfig
  | HideActionConfig
  | CloseActionConfig
  | WaitActionConfig
  | IfAllowAllActionConfig
  | IfAllowNoneActionConfig
  | RunRootedActionConfig
  | RunMethodActionConfig
  | SlideActionConfig;

export type MethodName = "OPEN_OPTIONS" | "DO_CONSENT" | "SAVE_CONSENT" | "HIDE_CMP" | "UTILITY" | string;

export interface MethodConfig {
  name: MethodName;
  action?: ActionConfig;
  custom?: true;
}

export interface CmpConfig {
  detectors: DetectorConfig[];
  methods: MethodConfig[];
}

/** The full vendored rules/dnr/consent-rules.json shape: CMP name -> config,
 * plus an ignorable "$schema" string key. */
export type RuleSet = Record<string, CmpConfig | string | undefined>;

/** All consent categories default to reject (false) -- the exact same
 * factory default Consent-O-Matic's own extension ships
 * (GDPRConfig.defaultValues in their source), not a policy Moat invented. */
export const REJECT_ALL: Record<ConsentType, boolean> = { A: false, B: false, D: false, E: false, F: false, X: false };

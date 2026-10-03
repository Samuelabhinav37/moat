// Everything that can leave the device, in one list. Settings › About shows
// a row for each flow (options.html, data-flow), and PRIVACY.md describes
// each one. networkFlows.test.ts fails when either of those drifts from this
// list, so a new connection can't ship without both a row and a policy entry.

import type { Settings } from "../types";

export type FlowId = "blocking" | "stats" | "updates" | "hidden" | "breach" | "sync" | "reports" | "org";

export interface FlowContext {
  /** Firefox resolves hidden trackers with its own DNS; only Chrome asks Cloudflare. */
  firefox: boolean;
  /** An organization's policy set up the Athena integration. */
  managed: boolean;
  /** This build can send problem reports. */
  reports: boolean;
}

export interface NetworkFlow {
  id: FlowId;
  /** Off unless the person turns it on in Settings. */
  optional: boolean;
  /** Who receives it, exactly as PRIVACY.md names them. Null when nothing leaves the device. */
  recipient: string | null;
  /** Whether the row applies to this browser and install at all. */
  applies(ctx: FlowContext): boolean;
  /** Whether it is sending right now. */
  on(settings: Settings, ctx: FlowContext): boolean;
}

const always = (): boolean => true;

export const NETWORK_FLOWS: readonly NetworkFlow[] = [
  { id: "blocking", optional: false, recipient: null, applies: always, on: always },
  { id: "stats", optional: false, recipient: null, applies: always, on: always },
  { id: "updates", optional: false, recipient: "GitHub Pages", applies: always, on: always },
  {
    id: "hidden",
    optional: true,
    recipient: "cloudflare-dns.com",
    applies: (ctx) => !ctx.firefox,
    on: (settings, ctx) => !ctx.firefox && settings.cnameUncloaking,
  },
  { id: "breach", optional: true, recipient: "api.pwnedpasswords.com", applies: always, on: (settings) => settings.leakedPasswordCheck },
  { id: "sync", optional: true, recipient: "browser.storage.sync", applies: always, on: (settings) => settings.syncEnabled },
  { id: "reports", optional: false, recipient: "Moat's developer", applies: (ctx) => ctx.reports, on: () => false },
  { id: "org", optional: false, recipient: "Athena", applies: (ctx) => ctx.managed, on: (_settings, ctx) => ctx.managed },
];

/** The optional flows that are sending data right now, in list order. */
export function optionalFlowsOn(settings: Settings, ctx: FlowContext): FlowId[] {
  return NETWORK_FLOWS.filter((flow) => flow.optional && flow.applies(ctx) && flow.on(settings, ctx)).map((flow) => flow.id);
}

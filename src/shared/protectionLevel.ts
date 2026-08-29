// Turns the popup's existing raw block count into a qualitative read --
// DuckDuckGo's most legible non-technical pattern, named as a real gap in
// competitive-gap-audit.md's opportunity (d). A UI reframe over data the
// popup already computes (StatusResponse.blockedOnTab), not new detection
// logic: DuckDuckGo's own grade is a before/after comparison Moat has no
// counterfactual data to produce (there's no "what this page would have
// loaded without Moat" measurement), so this is deliberately simpler --
// a qualitative bucket over the same real, already-accurate count shown
// numerically right above it, not a fabricated grade.
export type ProtectionLevel = "none" | "light" | "moderate" | "heavy";

// Thresholds are a judgment call, not measured against real browsing data --
// tuned so an ordinary news/e-commerce page (a handful of ad/tracker hits)
// reads "light" rather than immediately maxing out at "heavy", which would
// make the label meaningless on the pages people see it most.
export function protectionLevelForCount(count: number): ProtectionLevel {
  if (count <= 0) return "none";
  if (count <= 4) return "light";
  if (count <= 14) return "moderate";
  return "heavy";
}

export const PROTECTION_LEVEL_MESSAGE_KEY: Record<ProtectionLevel, string> = {
  none: "popupProtectionNone",
  light: "popupProtectionLight",
  moderate: "popupProtectionModerate",
  heavy: "popupProtectionHeavy",
};

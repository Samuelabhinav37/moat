// Shared, side-effect-free check for a cosmetic-filter selector string before
// it is persisted. Imported by both places a selector can enter storage:
// settingsPortability.ts (untrusted import file) and settings.ts's
// addSelectorRule (the live element-picker save path). Kept here so the two
// can't drift -- they feed the same sink.
//
// cosmeticSelectors.ts's buildStyleText/buildGrayscaleStyleText join selectors
// with "," and wrap them in one `{...}` block, then set it via
// styleEl.textContent (never innerHTML, so a "<script>" can't smuggle
// through -- textContent doesn't re-enter the HTML parser). What an
// unvalidated selector still CAN do: a "}" closes that block early and a
// following "{...}" opens a new one, turning a hide/gray rule into an
// arbitrary extra CSS rule injected into every matching page. None of
// `{ } < \`` has any legitimate role in a CSS *selector* (as opposed to a
// full rule).

export const MAX_SELECTOR_LENGTH = 500;

const SELECTOR_DISALLOWED = /[{}<`]/;

export function isSafeCosmeticSelector(value: string): boolean {
  return value.length > 0 && value.length <= MAX_SELECTOR_LENGTH && !SELECTOR_DISALLOWED.test(value);
}

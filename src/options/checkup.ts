// "Review your protection": a short guided checkup opened from Overview,
// the way Google's Privacy Checkup and Apple's Safety Check walk through a
// few choices one at a time. Three steps (level, two privacy extras,
// annoyances), then a summary of what will change. Nothing is saved until
// Done, and the page offers Undo afterwards. DOM calls only, so it's
// testable without the page.
import type { Settings, SettingsPatchField } from "../types";
import type { Translate } from "./overviewView";

export type Level = "lite" | "standard" | "strict";
export const LEVELS: readonly Level[] = ["lite", "standard", "strict"];

export interface CheckupSwitch {
  key: SettingsPatchField;
  title: string;
  desc: string;
}

export interface CheckupOptions {
  t: Translate;
  settings: Settings;
  /** The level the settings match now, or null for a hand-picked mix. */
  currentLevel: Level | null;
  levelPatch: (level: Level) => Partial<Settings>;
  levelName: (level: Level) => string;
  levelDesc: (level: Level) => string;
  privacy: CheckupSwitch[];
  annoyances: CheckupSwitch[];
  /** Saves the changes; `before` holds the old value of every key changed. */
  apply: (patch: Partial<Settings>, before: Partial<Settings>, count: number) => void;
}

function el<K extends keyof HTMLElementTagNameMap>(doc: Document, tag: K, className = "", text?: string): HTMLElementTagNameMap[K] {
  const node = doc.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

/** The keys a patch would actually change, with their old values. */
export function changedKeys(settings: Settings, patch: Partial<Settings>): { patch: Partial<Settings>; before: Partial<Settings> } {
  const changed: Record<string, unknown> = {};
  const before: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(patch)) {
    const old = (settings as unknown as Record<string, unknown>)[key];
    if (JSON.stringify(old) === JSON.stringify(value)) continue;
    changed[key] = value;
    before[key] = old;
  }
  return { patch: changed as Partial<Settings>, before: before as Partial<Settings> };
}

/** Opens the checkup over the page. Returns a function that closes it. */
export function openCheckup(doc: Document, options: CheckupOptions): () => void {
  const { t, settings } = options;
  const opener = doc.activeElement as HTMLElement | null;
  let level: Level | null = options.currentLevel;
  // Switch values as the person sets them, starting from the chosen level.
  const chosen: Partial<Record<SettingsPatchField, boolean>> = {};
  const valueOf = (key: SettingsPatchField): boolean => {
    if (key in chosen) return chosen[key]!;
    const fromLevel = level && level !== options.currentLevel ? (options.levelPatch(level) as Record<string, unknown>)[key] : undefined;
    return Boolean(fromLevel ?? (settings as unknown as Record<string, unknown>)[key]);
  };
  const fullPatch = (): Partial<Settings> => {
    const patch: Record<string, unknown> = level && level !== options.currentLevel ? { ...options.levelPatch(level) } : {};
    for (const s of [...options.privacy, ...options.annoyances]) patch[s.key] = valueOf(s.key);
    return patch as Partial<Settings>;
  };

  const backdrop = el(doc, "div", "checkup-backdrop");
  const dialog = el(doc, "div", "checkup");
  dialog.setAttribute("role", "dialog");
  dialog.setAttribute("aria-modal", "true");
  dialog.setAttribute("aria-labelledby", "checkup-title");
  backdrop.append(dialog);

  const close = () => {
    backdrop.remove();
    doc.removeEventListener("keydown", onKey);
    opener?.focus?.();
  };
  const onKey = (event: KeyboardEvent) => {
    if (event.key === "Escape") close();
  };
  doc.addEventListener("keydown", onKey);
  backdrop.addEventListener("click", (event) => {
    if (event.target === backdrop) close();
  });

  const steps = [t("checkupStepLevel", "How much to block"), t("checkupStepPrivacy", "Privacy extras"), t("checkupStepAnnoyances", "Annoyances")];
  let step = 0;

  const switchRow = (s: CheckupSwitch) => {
    const row = el(doc, "label", "checkup-row");
    const text = el(doc, "span");
    text.append(el(doc, "b", "", s.title), el(doc, "small", "", s.desc));
    const sw = el(doc, "span", "switch");
    const input = el(doc, "input");
    input.type = "checkbox";
    input.checked = valueOf(s.key);
    input.addEventListener("change", () => (chosen[s.key] = input.checked));
    const track = el(doc, "span", "track");
    track.append(el(doc, "span", "thumb"));
    sw.append(input, track);
    row.append(text, sw);
    return row;
  };

  const levelStep = () => {
    const group = el(doc, "div", "checkup-levels");
    group.setAttribute("role", "radiogroup");
    group.setAttribute("aria-label", steps[0]!);
    const choices: (Level | null)[] = [...LEVELS, ...(options.currentLevel === null ? [null] : [])];
    for (const choice of choices) {
      const card = el(doc, "button", "checkup-level");
      card.type = "button";
      card.setAttribute("role", "radio");
      card.setAttribute("aria-checked", String(choice === level));
      card.dataset.level = choice ?? "mix";
      card.append(
        el(doc, "b", "", choice ? options.levelName(choice) : t("checkupKeepMix", "Keep my own mix")),
        el(doc, "small", "", choice ? options.levelDesc(choice) : t("checkupKeepMixDesc", "The lists and extras you picked yourself stay as they are."))
      );
      card.addEventListener("click", () => {
        level = choice;
        // A new level resets the extras to what that level uses.
        for (const key of Object.keys(chosen)) delete chosen[key as SettingsPatchField];
        render();
      });
      group.append(card);
    }
    return group;
  };

  const summary = () => {
    const { patch } = changedKeys(settings, fullPatch());
    const list = el(doc, "ul", "checkup-summary");
    if (level && level !== options.currentLevel) list.append(el(doc, "li", "", t("checkupLevelChange", `Level: ${options.levelName(level)}`, options.levelName(level))));
    for (const s of [...options.privacy, ...options.annoyances]) {
      if (!(s.key in patch)) continue;
      const on = Boolean((patch as Record<string, unknown>)[s.key]);
      list.append(el(doc, "li", "", `${s.title}: ${on ? t("commonOn", "on") : t("commonOff", "off")}`));
    }
    if (!list.children.length) return el(doc, "p", "checkup-lead", t("checkupNoChanges", "Nothing to change. Your protection stays as it is."));
    const wrap = el(doc, "div");
    wrap.append(el(doc, "p", "checkup-lead", t("checkupWillChange", "Done will make these changes:")), list);
    return wrap;
  };

  const render = () => {
    const done = step === steps.length;
    const title = el(doc, "h2", "", done ? t("checkupSummaryTitle", "Here's what changes") : steps[step]!);
    title.id = "checkup-title";
    const progress = el(doc, "p", "checkup-progress", done ? "" : t("checkupStepOf", `Step ${step + 1} of ${steps.length}`, [String(step + 1), String(steps.length)]));
    let content: HTMLElement;
    if (done) content = summary();
    else if (step === 0) content = levelStep();
    else {
      content = el(doc, "div", "checkup-rows");
      content.append(...(step === 1 ? options.privacy : options.annoyances).map(switchRow));
    }
    const back = el(doc, "button", "", step === 0 ? t("checkupCancel", "Cancel") : t("helpBack", "Back"));
    back.type = "button";
    back.addEventListener("click", () => {
      if (step === 0) return close();
      step--;
      render();
    });
    const next = el(doc, "button", "primary", done ? t("checkupDone", "Done") : t("helpNext", "Next"));
    next.type = "button";
    next.addEventListener("click", () => {
      if (!done) {
        step++;
        render();
        return;
      }
      const { patch, before } = changedKeys(settings, fullPatch());
      const count = Object.keys(patch).length;
      close();
      if (count) options.apply(patch, before, count);
    });
    const actions = el(doc, "div", "checkup-actions");
    actions.append(back, next);
    dialog.replaceChildren(progress, title, content, actions);
    next.focus();
  };

  doc.body.append(backdrop);
  render();
  return close;
}

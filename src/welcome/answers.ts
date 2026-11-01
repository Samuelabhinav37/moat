// The tour's three questions, each setting something real. Unanswered
// questions change nothing, and the answers are applied together, so picking
// a level after "Yes, I get bot checks" keeps the device disguise off.
//   - What do you want most? Just stay safe / fewer ads / more privacy:
//     Light, Balanced or Strict.
//   - Do you often get "Verify you're human" checks? Yes keeps the device
//     disguise and the browser-wide cookie block off (both trip bot checks).
//   - Do you already block ads on your router? No turns on the ad-pages list
//     (scripts/lib/adPageRules.mjs), which blocks ad sites as pages the way a
//     router does; Yes leaves it off.
import { presetPatch, type PresetName } from "../shared/filterPresets";
import type { Settings } from "../types";

export interface TourAnswers {
  level?: Exclude<PresetName, "off" | "essential">;
  botChecks?: boolean;
  routerBlocks?: boolean;
}

export function answersPatch(answers: TourAnswers, filterGroups: Settings["filterGroups"]): Partial<Settings> {
  const patch: Partial<Settings> = answers.level ? presetPatch(answers.level) : {};
  if (answers.routerBlocks !== undefined) {
    patch.filterGroups = { ...(patch.filterGroups ?? filterGroups), "ad-pages": !answers.routerBlocks };
  }
  if (answers.botChecks) {
    patch.fingerprintResistance = false;
    patch.blockThirdPartyCookies = false;
  }
  return patch;
}

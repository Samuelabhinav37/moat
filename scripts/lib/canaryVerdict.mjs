// Decides whether one site broke between the baseline and the candidate build
// in the breakage canary (scripts/canary.mjs). Each arm has one run per round.
// The baseline's worst run is compared with the candidate's best, so only a
// loss every round agrees on flags a site. Bot-wall pages (wall: DataDome's
// captcha frame, or a challenge title) never count as text loss: sites like
// Forbes start walling the whole IP after a few dozen headless loads.

const CHALLENGE_TITLE = /just a moment|attention required|access denied|verify you are human/i;

const walled = (r) => r.wall || CHALLENGE_TITLE.test(r.title);

/** @param {{ navErr: string|null, text: number, inputs: number, title: string, wall?: boolean }[]} runs */
function summarize(runs, pick) {
  const ok = runs.filter((r) => !r.navErr);
  const open = ok.filter((r) => !walled(r));
  return {
    loaded: ok.length > 0,
    // challenged only when every run that loaded showed a bot check
    challenged: ok.length > 0 && open.length === 0,
    text: open.length ? pick(...open.map((r) => r.text)) : 0,
    inputs: open.length ? pick(...open.map((r) => r.inputs)) : 0,
  };
}

/** Returns the reasons the candidate looks broken next to the baseline; empty when it doesn't. */
export function canaryVerdict(baseRuns, candRuns) {
  const base = summarize(baseRuns, Math.min);
  const cand = summarize(candRuns, Math.max);
  const reasons = [];
  if (base.loaded && !cand.loaded) reasons.push(`no load (${candRuns[0]?.navErr})`);
  if (!base.loaded || !cand.loaded) return reasons;
  if (!base.challenged && cand.challenged) reasons.push("bot check");
  if (base.challenged || cand.challenged) return reasons;
  if (base.text >= 300 && cand.text < base.text * 0.6) reasons.push(`text ${cand.text}/${base.text}`);
  if (base.inputs >= 4 && cand.inputs < base.inputs * 0.5) reasons.push(`controls ${cand.inputs}/${base.inputs}`);
  return reasons;
}

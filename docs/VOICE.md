# Moat's voice

How Moat talks, in the extension, on the website and in the store listing.
Every new string should pass these checks.

## The rules

1. **Say what it does for you first, then how.** "Hides your real IP address,
   which shows roughly where you are" before any mention of video calls.
2. **One idea per sentence. Short sentences.** If a sentence needs a comma
   chain or a dash to hold together, split it.
3. **No unexplained jargon.** A technical word (IP address, data breach,
   CAPTCHA, filter list) is fine only if the same sentence says what it means
   for the reader. Prefer plain words: "I'm not a robot check" over
   "CAPTCHA", "low-quality sites built to rank in search" over "content farms".
4. **Name things the same way everywhere.**
   - **Pause** Moat on a site (never "turn off here", "disable", "whitelist").
   - **Device protection** (never "fingerprint protection" or "device disguise").
   - **Lists** for filter lists, **level** for Light, Balanced, Strict.
   - **Always block** and **Never block** for the user's own rules.
5. **Name the trade-off once, plainly.** "A few sites may break." Then stop.
   No stacked reassurances, no "don't worry".
6. **Actions are verbs the reader can find.** Use the button's real label, in
   bold in help text: "Click **Pause**".
7. **No exaggeration.** Moat blocks what its lists know about. Say "known",
   not "all"; say what it does, not what it guarantees.
8. **No dashes as a crutch.** Use a full stop or "and" instead.

## Summaries built from data

A sentence made from numbers or names must still mean something to someone
who glances at it for five seconds.

- Say who did what: "Google tried to track you on more sites than any other
  company", not "Google tracked you on the most sites".
- Name Moat as the one acting: "Moat blocked the most on news.example", not
  "news.example had the most blocked".
- Every number has its unit and period: "4 ads and 3 trackers blocked", not
  "7 things".

## Kai

Kai is Moat's guide. Kai speaks in the first person, briefly and warmly, and
always offers something to do next. One or two sentences, then buttons.
In Settings, Kai answers "where is it?" questions and takes you there. Only
one Kai is on screen at a time. Kai refers to the toolbar button as "the Moat
icon", never "my icon".

- Good: "Not sure which level to pick? Balanced suits most people."
- Not: "Hey there! 👋 Choosing a protection level can be tricky, but don't
  worry, I'm here to help you every step of the way!"

## Before and after

| Before | After |
|---|---|
| Stops pages finding your real IP address through video-call features, even behind a VPN. | Keeps pages from finding your real IP address, which shows roughly where you are. Works even when you use a VPN. |
| Can occasionally break a CAPTCHA or a bank's device check. If a site misbehaves, turn this off first. | Now and then this trips up an "I'm not a robot" check or a bank's device check. If a site acts up, turn this off first. |
| Turn Moat off here | Pause Moat on this site |

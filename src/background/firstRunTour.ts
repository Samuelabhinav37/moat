// Opens the first-run tour (welcome.html) once, on a fresh install. Not on
// updates, and not when an organization installed Moat through policy
// (installType "admin"): a surprise tab on every managed machine is exactly
// what admins don't want, and those users still get the popup's one-line
// first-run card. The tour itself changes no settings; protection is already
// on before it opens.
import browser, { type Runtime } from "webextension-polyfill";

export function shouldOpenFirstRunTour(reason: Runtime.OnInstalledReason, installType: string | undefined): boolean {
  return reason === "install" && installType !== "admin";
}

async function installType(): Promise<string | undefined> {
  try {
    // management.getSelf needs no permission.
    return (await browser.management.getSelf()).installType;
  } catch {
    return undefined;
  }
}

export async function maybeOpenFirstRunTour(reason: Runtime.OnInstalledReason): Promise<void> {
  if (!shouldOpenFirstRunTour(reason, await installType())) return;
  await browser.tabs.create({ url: browser.runtime.getURL("welcome.html") });
}

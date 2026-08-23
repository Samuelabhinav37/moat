// Enterprise-managed policy, pushed via Chrome's ExtensionSettings policy or
// Firefox's policies.json "3rdparty" key (see managed_schema.json for the
// exact shape an admin can set). Read-only from the extension's side --
// browser.storage.managed rejects writes.
import browser from "webextension-polyfill";
import type { ManagedPolicy } from "../types";

export { applyManagedOverrides, isLocked } from "./managedPolicyMerge";

export async function getManagedPolicy(): Promise<ManagedPolicy> {
  try {
    return (await browser.storage.managed.get()) as ManagedPolicy;
  } catch {
    // No policy provider on this profile -- perfectly normal outside an
    // enterprise deployment.
    return {};
  }
}

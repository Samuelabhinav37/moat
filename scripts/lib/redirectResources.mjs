// $redirect rules point at a bundled no-op resource via an extensionPath like
// "/web-accessible-resources/redirects/nooptext.js" -- we only need to know
// the resource's filename to check whether we actually ship it and where to
// copy it from. Pulled out of update-filters.mjs (which has side effects on
// import -- reading node_modules, writing to rules/dnr/) so this is
// importable in tests without triggering any of that.
export function resolveRedirectResource(extensionPath, availableFiles) {
  const name = extensionPath.split("/").pop();
  if (!name) return null;
  return availableFiles.has(name) ? name : null;
}

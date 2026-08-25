// Split into subarrays whose JSON.stringify'd size stays under maxBytes.
// Pulled out of update-filters.mjs (which has side effects on import --
// reading node_modules, writing to rules/dnr/) so it's importable in tests
// without triggering any of that.
export function chunkBySize(rules, maxBytes) {
  const chunks = [];
  let current = [];
  let currentSize = 2; // "[]"

  for (const rule of rules) {
    // +1 for the separating comma; close enough without re-stringifying the
    // whole running array on every push. .length here is UTF-16 code units,
    // not bytes -- an approximation of the byte-based maxBytes limit this
    // function is named after. A non-issue at these specific rule shapes
    // (urlFilter/domain values are effectively always ASCII), but would
    // need a real byte count (e.g. Buffer.byteLength) if that ever changes.
    const size = JSON.stringify(rule).length + 1;
    if (current.length > 0 && currentSize + size > maxBytes) {
      chunks.push(current);
      current = [];
      currentSize = 2;
    }
    current.push(rule);
    currentSize += size;
  }
  if (current.length > 0) chunks.push(current);
  return chunks.length > 0 ? chunks : [[]];
}

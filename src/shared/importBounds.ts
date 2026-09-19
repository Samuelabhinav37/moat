// Shared bounds for every untrusted-import boundary Moat has (the settings
// export/import JSON in settingsPortability.ts, and the migration-import
// filter-list text in filterListImport.ts) -- one source so the two can't
// drift apart. Without a cap, a single crafted import could balloon
// storage.local/storage.sync with an unbounded array. Generous enough that
// no real export or filter list (even a heavily customized one) would ever
// hit them.
export const MAX_ARRAY_LENGTH = 5000;
export const MAX_STRING_LENGTH = 500;
export const MAX_RECORD_KEYS = 2000;

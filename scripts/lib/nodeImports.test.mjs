import { describe, expect, it } from "vitest";
import { execFileSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

// The build and the scheduled jobs (update-live-security, update-filters) run
// src/**/*.ts straight in Node, which resolves a relative import only with its
// extension. Vitest and Vite resolve it without one, so a missing ".ts" passed
// CI and broke the daily security-lists job (2026-10-15). This walks what the
// scripts import and loads every reached .ts module in plain Node.

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const IMPORT = /^\s*(?:import|export)\s+(?!type\b)[^;]*?from\s*["'](\.[^"']+)["']|import\(\s*["'](\.[^"']+)["']\s*\)/gm;

function reachedTsModules() {
  const seen = new Set();
  const ts = new Set();
  const missing = [];
  const walk = (file) => {
    if (seen.has(file)) return;
    seen.add(file);
    for (const match of readFileSync(file, "utf8").matchAll(IMPORT)) {
      const spec = match[1] ?? match[2];
      const target = resolve(dirname(file), spec);
      if (!/\.(?:mjs|ts)$/.test(spec)) {
        if (!/\.(?:js|json)$/.test(spec)) missing.push(`${file.slice(root.length + 1)} -> ${spec}`);
        continue;
      }
      if (!existsSync(target)) continue;
      if (target.endsWith(".ts")) ts.add(target);
      walk(target);
    }
  };
  for (const dir of ["scripts", "scripts/lib"]) {
    for (const name of readdirSync(join(root, dir))) {
      if (name.endsWith(".mjs") && !name.endsWith(".test.mjs")) walk(join(root, dir, name));
    }
  }
  return { ts: [...ts], missing };
}

describe("TypeScript the Node scripts run", () => {
  const { ts, missing } = reachedTsModules();

  it("imports with explicit extensions", () => {
    expect(missing).toEqual([]);
  });

  it("loads in plain Node", () => {
    expect(ts.length).toBeGreaterThan(0);
    const urls = JSON.stringify(ts.map((file) => pathToFileURL(file).href));
    const code = `for (const url of ${urls}) await import(url);`;
    expect(() => execFileSync(process.execPath, ["--input-type=module", "-e", code], { cwd: root, stdio: "pipe" })).not.toThrow();
  }, 30_000);
});

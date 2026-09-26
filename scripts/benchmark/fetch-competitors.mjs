// Downloads the competitors' current Chrome Web Store packages and the d3ward
// ad-block test host list into .cache/benchmark/ for ./bench.mjs.
//   node scripts/benchmark/fetch-competitors.mjs
import { execFileSync } from "node:child_process";
import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
const out = join(root, ".cache", "benchmark");
export const COMPETITORS = {
  ubol: "ddkjiahejlhfcafbddmgiahcphecmpfh", // uBlock Origin Lite
  adguard: "bgnkhhnnamicmpeenaelnjfhikgbkllg",
  ghostery: "mlomiejdfkolichcflejclcbmpeaniij",
  abp: "cfhdojbkjhnklbpkdaibdccddilifddb", // Adblock Plus
};
const D3WARD = "https://raw.githubusercontent.com/d3ward/toolz/master/src/data/adblock_data.json";

mkdirSync(join(out, "ext"), { recursive: true });
for (const [name, id] of Object.entries(COMPETITORS)) {
  const url = `https://clients2.google.com/service/update2/crx?response=redirect&prodversion=154.0&acceptformat=crx2,crx3&x=id%3D${id}%26uc`;
  const crx = Buffer.from(await (await fetch(url)).arrayBuffer());
  if (crx.subarray(0, 4).toString() !== "Cr24") throw new Error(`${name}: not a CRX package`);
  // CRX3: "Cr24", version (4 bytes), header length (4 bytes), header, zip.
  const zip = join(out, "ext", `${name}.zip`);
  writeFileSync(zip, crx.subarray(12 + crx.readUInt32LE(8)));
  const dest = join(out, "ext", name);
  rmSync(dest, { recursive: true, force: true });
  if (process.platform === "win32") {
    execFileSync("powershell", ["-NoProfile", "-Command", `Expand-Archive -LiteralPath '${zip}' -DestinationPath '${dest}' -Force`]);
  } else {
    execFileSync("unzip", ["-q", "-o", zip, "-d", dest]);
  }
  const manifest = JSON.parse(readFileSync(join(dest, "manifest.json"), "utf8"));
  console.log(`${name}: ${manifest.version}`);
}
writeFileSync(join(out, "d3ward.json"), await (await fetch(D3WARD)).text());
console.log(`d3ward host list saved. Next: node scripts/benchmark/bench.mjs`);

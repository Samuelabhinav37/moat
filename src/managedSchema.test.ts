import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { describe, expect, it } from "vitest";

// Chrome's managed-storage schema compiler is a restricted subset of JSON
// Schema. `additionalProperties` there MUST be a schema object (e.g.
// `{ "type": "boolean" }`) -- a bare `true`/`false`, valid in standard JSON
// Schema, makes Chrome reject the whole file at load time with "Invalid type
// for attribute 'additionalProperties'" and the extension will not load
// unpacked at all. `web-ext lint` (Firefox) doesn't catch this, so it went
// unnoticed from v0.11.31 to v0.11.37. This walks the shipped schema and
// fails if any node reintroduces the boolean form.
const schemaPath = join(dirname(fileURLToPath(import.meta.url)), "managed_schema.json");
const schema = JSON.parse(readFileSync(schemaPath, "utf8")) as unknown;

function* walk(node: unknown, path: string): Generator<{ path: string; value: unknown }> {
  if (node === null || typeof node !== "object") return;
  if (Array.isArray(node)) {
    for (let i = 0; i < node.length; i += 1) yield* walk(node[i], `${path}[${i}]`);
    return;
  }
  for (const [key, value] of Object.entries(node as Record<string, unknown>)) {
    const childPath = path ? `${path}.${key}` : key;
    if (key === "additionalProperties") yield { path: childPath, value };
    yield* walk(value, childPath);
  }
}

describe("managed_schema.json", () => {
  it("is valid JSON with an object at the root", () => {
    expect(schema).toBeTypeOf("object");
    expect((schema as { type?: string }).type).toBe("object");
  });

  it("never uses a boolean for additionalProperties (Chrome rejects it)", () => {
    for (const { path, value } of walk(schema, "")) {
      expect(typeof value, `${path} must be a schema object, not ${typeof value}`).toBe("object");
      expect(value, `${path} must not be null`).not.toBeNull();
    }
  });

  it("every object node declares its properties or a typed additionalProperties", () => {
    // A Chrome object schema with neither is legal but pointless; catching it
    // here flags an accidentally-empty policy section.
    function checkObjects(node: unknown, path: string): void {
      if (node === null || typeof node !== "object" || Array.isArray(node)) return;
      const obj = node as Record<string, unknown>;
      if (obj.type === "object") {
        expect(
          "properties" in obj || "additionalProperties" in obj,
          `${path || "root"} is type:object with no properties and no additionalProperties`
        ).toBe(true);
      }
      for (const [key, value] of Object.entries(obj)) checkObjects(value, path ? `${path}.${key}` : key);
    }
    checkObjects(schema, "");
  });
});

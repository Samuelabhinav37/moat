import { describe, expect, it } from "vitest";
import { bucketForDomain } from "./domainBucket.mjs";
import { bucketForDomain as bucketForDomainRuntime } from "../../src/shared/domainBucket.ts";

const SAMPLE_DOMAINS = [
  "example.com",
  "www.youtube.com",
  "youtube.com",
  "instagram.com",
  "www.linkedin.com",
  "a.b.c.example.co.uk",
  "msn.com",
  "",
];

describe("bucketForDomain", () => {
  it("always returns an index within [0, bucketCount)", () => {
    for (const domain of SAMPLE_DOMAINS) {
      const bucket = bucketForDomain(domain, 64);
      expect(bucket).toBeGreaterThanOrEqual(0);
      expect(bucket).toBeLessThan(64);
    }
  });

  it("is deterministic for the same domain and bucket count", () => {
    expect(bucketForDomain("example.com", 64)).toBe(bucketForDomain("example.com", 64));
  });

  it("matches the runtime (TypeScript) copy of the same algorithm for every sample domain", () => {
    for (const domain of SAMPLE_DOMAINS) {
      expect(bucketForDomain(domain, 64)).toBe(bucketForDomainRuntime(domain, 64));
    }
  });
});

import { describe, expect, it } from "vitest";
import { isSharedLinkHost } from "./sharedLinkHosts";

describe("isSharedLinkHost", () => {
  it("knows the hosts every customer of a link service shares", () => {
    for (const host of ["click.pstmrk.it", "a.rs6.net", "t.co", "WWW.bit.ly", "r.us-east-1.awstrack.me", "us21.list-manage.com", "na1.hubspotlinks.com", "click.discord.com"]) {
      expect(isSharedLinkHost(host)).toBe(true);
    }
  });

  it("leaves one sender's own subdomain to the security lists", () => {
    for (const host of ["u106654694.ct.sendgrid.net", "abcd1234.r.us-east-1.awstrack.me", "shop.us21.list-manage.com", "4etyg7hbb.cc.rs6.net", "d582z504.na1.hubspotlinks.com"]) {
      expect(isSharedLinkHost(host)).toBe(false);
    }
  });

  it("doesn't match lookalikes", () => {
    expect(isSharedLinkHost("t.co.evil.example")).toBe(false);
    expect(isSharedLinkHost("pstmrk.it.example")).toBe(false);
    expect(isSharedLinkHost("r.us-east-1.awstrack.me.evil.example")).toBe(false);
  });
});

import { describe, expect, it } from "vitest";
import { isAuthPopupUrl } from "./authPopup";

const base = "https://teams.microsoft.com/v2/";

describe("isAuthPopupUrl", () => {
  it("accepts identity-provider sign-in pages", () => {
    for (const url of [
      "https://login.microsoftonline.com/common/oauth2/v2.0/authorize?client_id=x",
      "https://login.live.com/oauth20_authorize.srf",
      "https://accounts.google.com/o/oauth2/v2/auth?client_id=x",
      "https://appleid.apple.com/auth/authorize",
      "https://github.com/login/oauth/authorize?client_id=x",
      "https://www.facebook.com/v19.0/dialog/oauth?client_id=x",
      "https://discord.com/oauth2/authorize?client_id=x",
      "https://acme.okta.com/oauth2/v1/authorize",
      "https://acme.b2clogin.com/acme.onmicrosoft.com/oauth2/v2.0/authorize",
    ]) {
      expect(isAuthPopupUrl(url, base), url).toBe(true);
    }
  });

  it("accepts a URL object", () => {
    expect(isAuthPopupUrl(new URL("https://accounts.google.com/signin"), base)).toBe(true);
  });

  it("only counts the OAuth paths of hosts that serve other pages too", () => {
    expect(isAuthPopupUrl("https://github.com/some/repo", base)).toBe(false);
    expect(isAuthPopupUrl("https://www.facebook.com/somepage", base)).toBe(false);
    expect(isAuthPopupUrl("https://x.com/someone", base)).toBe(false);
    expect(isAuthPopupUrl("https://www.amazon.com/dp/B000", base)).toBe(false);
  });

  it("rejects everything else", () => {
    expect(isAuthPopupUrl("https://ads.example/popunder", base)).toBe(false);
    expect(isAuthPopupUrl("/relative/page", base)).toBe(false);
    expect(isAuthPopupUrl("about:blank", base)).toBe(false);
    expect(isAuthPopupUrl("", base)).toBe(false);
    expect(isAuthPopupUrl(undefined, base)).toBe(false);
    expect(isAuthPopupUrl("http://login.microsoftonline.com/", base)).toBe(false);
    expect(isAuthPopupUrl("https://login.microsoftonline.com.evil.example/", base)).toBe(false);
    expect(isAuthPopupUrl("not a url ::", "about:blank")).toBe(false);
  });
});

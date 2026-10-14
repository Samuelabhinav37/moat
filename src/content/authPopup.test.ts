import { describe, expect, it } from "vitest";
import { authPopupKind, isAuthPopupUrl } from "./authPopup";

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

  it("accepts the sign-ins the field report found blocked, and payment pages", () => {
    for (const url of [
      "https://auth.openai.com/authorize?client_id=x",
      "https://claude.ai/oauth/authorize?code=true",
      "https://api.workos.com/user_management/authorize?client_id=x",
      "https://authkit.cline.bot/oauth2/authorize?client_id=x",
      "https://acme.authkit.app/sign-in",
      "https://accounts.openrouter.ai/sign-in?redirect_url=x",
      "https://abc.supabase.co/auth/v1/authorize?provider=github",
      "https://moat-test.firebaseapp.com/__/auth/handler?apiKey=x",
      "https://login.myapp.example/__/auth/handler",
      "https://accounts.spotify.com/authorize",
      "https://www.notion.so/login",
      "https://api.notion.com/v1/oauth/authorize?client_id=x",
      "https://hooks.stripe.com/3d_secure_2/hosted?x=1",
      "https://pay.klarna.com/eu/abc",
      "https://cdn.plaid.com/link/v2/stable/link.html",
      "https://sso.unknown-idp.example/authorize?client_id=x&response_type=code",
      "https://idp.example/saml?SAMLRequest=abc",
    ]) {
      expect(isAuthPopupUrl(url, base), url).toBe(true);
    }
  });

  it("doesn't take ordinary pages on those hosts or lookalike paths", () => {
    expect(isAuthPopupUrl("https://claude.ai/new", base)).toBe(false);
    expect(isAuthPopupUrl("https://www.notion.so/some-page-123", base)).toBe(false);
    expect(isAuthPopupUrl("https://accounts.example.com/profile", base)).toBe(false);
    expect(isAuthPopupUrl("https://authkit.example.com/pricing", base)).toBe(false);
    expect(isAuthPopupUrl("https://ads.example/click?client_id=x", base)).toBe(false);
  });

  it("tells named providers from pages recognised only by their shape, which any site could copy", () => {
    expect(authPopupKind("https://auth.openai.com/authorize?client_id=x", base)).toBe("known");
    expect(authPopupKind("https://cdn.plaid.com/link/v2/stable/link.html", base)).toBe("known");
    expect(authPopupKind("https://accounts.openrouter.ai/sign-in", base)).toBe("pattern");
    expect(authPopupKind("https://moat-test.firebaseapp.com/__/auth/handler", base)).toBe("pattern");
    expect(authPopupKind("https://popunder.example/go?client_id=1&response_type=code", base)).toBe("pattern");
    expect(authPopupKind("https://ads.example/popunder", base)).toBeNull();
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

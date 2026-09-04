import { describe, expect, it } from "vitest";
import { cloudAuthErrorMessage, emailLinkReturnUrl, isLoopbackHostname, readFirebaseCloudConfig, sameOriginEmailLink } from "./config";

const environment = {
  VITE_FIREBASE_ENABLED: "true",
  VITE_FIREBASE_API_KEY: "demo-api-key",
  VITE_FIREBASE_AUTH_DOMAIN: "demo-sales-ledger.firebaseapp.com",
  VITE_FIREBASE_PROJECT_ID: "demo-sales-ledger",
  VITE_FIREBASE_APP_ID: "demo-app-id",
};

describe("private cloud opt-in", () => {
  it("leaves ordinary and public-demo builds disabled without explicit opt-in", () => {
    expect(readFirebaseCloudConfig({})).toEqual({ status: "disabled" });
    expect(readFirebaseCloudConfig({ VITE_PUBLIC_DEMO: "true" })).toEqual({ status: "disabled" });
    expect(readFirebaseCloudConfig({ VITE_FIREBASE_ENABLED: "false" })).toEqual({ status: "disabled" });
  });

  it("fails closed for malformed opt-in and missing required configuration", () => {
    expect(readFirebaseCloudConfig({ VITE_FIREBASE_ENABLED: "TRUE" }).status).toBe("invalid");
    const result = readFirebaseCloudConfig({ VITE_FIREBASE_ENABLED: "true" });
    expect(result.status).toBe("invalid");
    if (result.status === "invalid") expect(result.issues).toHaveLength(4);
  });

  it("requires all four settings and never reports their values", () => {
    for (const field of ["VITE_FIREBASE_API_KEY", "VITE_FIREBASE_AUTH_DOMAIN", "VITE_FIREBASE_PROJECT_ID", "VITE_FIREBASE_APP_ID"]) {
      expect(readFirebaseCloudConfig({ ...environment, [field]: " " }).status).toBe("invalid");
    }
    const result = readFirebaseCloudConfig({ ...environment, VITE_FIREBASE_API_KEY: "invalid value with private text" });
    expect(result.status).toBe("invalid");
    expect(JSON.stringify(result)).not.toContain("private text");
  });

  it("returns an explicit enabled configuration", () => {
    expect(readFirebaseCloudConfig(environment)).toEqual({ status: "enabled", config: { apiKey: "demo-api-key", authDomain: "demo-sales-ledger.firebaseapp.com", projectId: "demo-sales-ledger", appId: "demo-app-id", useEmulators: false } });
  });

  it("refuses cloud and public demo together", () => {
    expect(readFirebaseCloudConfig({ ...environment, VITE_PUBLIC_DEMO: "true" }).status).toBe("invalid");
  });

  it.each(["https://example.com", "example.com/path", "user@example.com", "example.com:443", "example.com?return=elsewhere"])("refuses a URL instead of an auth hostname: %s", (authDomain) => {
    expect(readFirebaseCloudConfig({ ...environment, VITE_FIREBASE_AUTH_DOMAIN: authDomain }).status).toBe("invalid");
  });

  it("allows emulators only for exact loopback app hostnames", () => {
    for (const hostname of ["localhost", "127.0.0.1", "[::1]"]) {
      expect(readFirebaseCloudConfig({ ...environment, VITE_FIREBASE_EMULATORS: "true" }, hostname).status).toBe("enabled");
    }
    for (const hostname of ["private.example.com", "localhost.example.com", "127.0.0.1.example.com", "192.168.1.4", ""]) {
      expect(readFirebaseCloudConfig({ ...environment, VITE_FIREBASE_EMULATORS: "true" }, hostname).status).toBe("invalid");
    }
    expect(readFirebaseCloudConfig({ ...environment, VITE_FIREBASE_EMULATORS: "yes" }, "localhost").status).toBe("invalid");
  });
});

describe("email-link safety", () => {
  it("keeps only this app's origin and path, never an email or open redirect", () => {
    expect(emailLinkReturnUrl("https://private.example.com/ledger/?email=other@example.com&next=https://evil.example/#secret"))
      .toBe("https://private.example.com/ledger/");
  });

  it.each(["http://private.example.com/", "javascript:alert(1)", "https://user:password@example.com/", "file:///tmp/index.html"])("rejects an unsafe return address: %s", (href) => {
    expect(() => emailLinkReturnUrl(href)).toThrow();
  });

  it("allows local test HTTP but not a hostname merely containing localhost", () => {
    expect(emailLinkReturnUrl("http://127.0.0.1:5173/?mode=signIn")).toBe("http://127.0.0.1:5173/");
    expect(isLoopbackHostname("localhost.attacker.example")).toBe(false);
  });

  it("accepts completion only on the current origin without interpreting redirect fields", () => {
    const link = "https://private.example.com/?mode=signIn&oobCode=example&continueUrl=https://elsewhere.example";
    expect(sameOriginEmailLink(link, "https://private.example.com")).toBe(link);
    expect(sameOriginEmailLink(link, "https://different.example.com")).toBeNull();
    expect(sameOriginEmailLink("//private.example.com", "https://private.example.com")).toBeNull();
  });

  it("shows helpful errors without echoing provider-supplied email or token details", () => {
    expect(cloudAuthErrorMessage({ code: "auth/network-request-failed", message: "secret" })).toMatch(/internet connection/);
    expect(cloudAuthErrorMessage({ code: "auth/unauthorized-domain" })).toMatch(/app owner/);
    expect(cloudAuthErrorMessage({ code: "auth/popup-blocked" })).toMatch(/email sign-in link/);
    expect(cloudAuthErrorMessage({ code: "unknown", message: "Unable to process request due to missing initial state. sessionStorage is inaccessible." })).toMatch(/protected sign-in storage is unavailable/i);
    expect(cloudAuthErrorMessage({ code: "auth/unsupported-persistence-type", message: "private@example.com token=secret" })).toMatch(/open the exact private Sales Ledger link directly in Chrome/i);
    expect(cloudAuthErrorMessage({ code: "unknown", message: "private@example.com token=secret" })).not.toMatch(/private@example.com|secret/);
  });
});

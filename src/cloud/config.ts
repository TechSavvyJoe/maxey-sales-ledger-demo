export interface FirebaseCloudConfig {
  apiKey: string;
  authDomain: string;
  projectId: string;
  appId: string;
  useEmulators: boolean;
}

export type FirebaseCloudConfigResult =
  | { status: "disabled" }
  | { status: "invalid"; issues: string[] }
  | { status: "enabled"; config: FirebaseCloudConfig };

export function isLoopbackHostname(hostname: string): boolean {
  return ["localhost", "127.0.0.1", "[::1]", "::1"].includes(hostname.toLowerCase());
}

/** Missing opt-in is the existing local app; a broken opt-in must never become it. */
export function readFirebaseCloudConfig(
  env: Readonly<Record<string, unknown>> = import.meta.env,
  hostname: string = globalThis.location?.hostname ?? "",
): FirebaseCloudConfigResult {
  const enabled = env.VITE_FIREBASE_ENABLED;
  if (enabled === undefined || enabled === "" || enabled === "false") return { status: "disabled" };
  if (enabled !== "true") {
    return { status: "invalid", issues: ["VITE_FIREBASE_ENABLED must be true or false."] };
  }

  const issues: string[] = [];
  const required = (name: string): string => {
    const value = typeof env[name] === "string" ? env[name].trim() : "";
    if (!value) issues.push(`${name} is required for private cloud mode.`);
    return value;
  };
  const config: FirebaseCloudConfig = {
    apiKey: required("VITE_FIREBASE_API_KEY"),
    authDomain: required("VITE_FIREBASE_AUTH_DOMAIN"),
    projectId: required("VITE_FIREBASE_PROJECT_ID"),
    appId: required("VITE_FIREBASE_APP_ID"),
    useEmulators: env.VITE_FIREBASE_EMULATORS === "true",
  };

  if (env.VITE_PUBLIC_DEMO === "true") issues.push("Private cloud mode cannot be combined with the public demo.");
  if (config.apiKey && !/^[A-Za-z0-9_-]+$/.test(config.apiKey)) issues.push("VITE_FIREBASE_API_KEY has an invalid format.");
  if (config.projectId && !/^[a-z][a-z0-9-]{4,28}[a-z0-9]$/.test(config.projectId)) issues.push("VITE_FIREBASE_PROJECT_ID has an invalid format.");
  if (config.appId && !/^[A-Za-z0-9:_-]+$/.test(config.appId)) issues.push("VITE_FIREBASE_APP_ID has an invalid format.");
  if (config.authDomain && !/^(?:[a-zA-Z0-9](?:[a-zA-Z0-9-]*[a-zA-Z0-9])?\.)*[a-zA-Z0-9](?:[a-zA-Z0-9-]*[a-zA-Z0-9])?$/.test(config.authDomain)) {
    issues.push("VITE_FIREBASE_AUTH_DOMAIN must be a hostname, without a scheme, path or port.");
  }
  if (![undefined, "", "false", "true"].includes(env.VITE_FIREBASE_EMULATORS as string | undefined)) {
    issues.push("VITE_FIREBASE_EMULATORS must be true or false.");
  }
  if (config.useEmulators && !isLoopbackHostname(hostname)) {
    issues.push("Firebase emulators are allowed only when this app is opened on localhost.");
  }
  return issues.length ? { status: "invalid", issues } : { status: "enabled", config };
}

/** Keep authentication on this app. Never carry email or a caller-supplied redirect. */
export function emailLinkReturnUrl(currentHref: string): string {
  const url = new URL(currentHref);
  if (url.username || url.password || (url.protocol !== "https:" && !(url.protocol === "http:" && isLoopbackHostname(url.hostname)))) {
    throw new Error("Open the private Sales Ledger address in a supported browser to sign in.");
  }
  url.search = "";
  url.hash = "";
  return url.href;
}

export function sameOriginEmailLink(currentHref: string, expectedOrigin: string): string | null {
  try {
    const url = new URL(currentHref);
    if (url.origin !== expectedOrigin) return null;
    emailLinkReturnUrl(url.href);
    return url.href;
  } catch {
    return null;
  }
}

/** Provider error messages may contain email addresses or links; never surface them. */
export function cloudAuthErrorMessage(error: unknown): string {
  const code = typeof error === "object" && error !== null && "code" in error ? String(error.code) : "";
  switch (code) {
    case "auth/network-request-failed":
      return "Sign-in could not connect. Check your internet connection and try again.";
    case "auth/unauthorized-domain":
    case "auth/invalid-continue-uri":
    case "auth/unauthorized-continue-uri":
      return "This address is not enabled for private sign-in yet. Ask the app owner to check the private app address.";
    case "auth/popup-blocked":
    case "auth/operation-not-supported-in-this-environment":
    case "auth/web-storage-unsupported":
      return "Open the private app in Chrome, Edge, Safari or Firefox and allow its sign-in window. You can also use an email sign-in link.";
    case "auth/popup-closed-by-user":
    case "auth/cancelled-popup-request":
      return "The sign-in window closed before completion. Try again or use an email sign-in link.";
    case "auth/operation-not-allowed":
    case "auth/configuration-not-found":
      return "This sign-in method is not enabled yet. Ask the app owner to finish private sign-in setup.";
    case "auth/invalid-email":
      return "Enter a complete email address and try again.";
    case "auth/expired-action-code":
    case "auth/invalid-action-code":
    case "auth/invalid-credential":
      return "This sign-in link is expired, already used, or does not match that email. Request a new link.";
    case "auth/too-many-requests":
    case "auth/quota-exceeded":
      return "Sign-in is temporarily limited. Wait a little before trying again, or try the other sign-in method.";
    case "auth/account-exists-with-different-credential":
      return "Use the sign-in method you previously used for this email, or request an email sign-in link.";
    case "auth/user-disabled":
      return "This account cannot sign in. Contact the app owner for help.";
    default:
      return "Sign-in could not finish. Try again in a current browser, or use an email sign-in link.";
  }
}

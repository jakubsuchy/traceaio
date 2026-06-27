// Live Demo guard.
//
// When the server reports LIVE_DEMO=1, the app runs read-only: any data-mutating
// API call (POST/PUT/PATCH/DELETE) is intercepted at the `window.fetch` boundary
// and a "Deploy your own" modal is shown instead of the request being sent.
//
// Hooking `window.fetch` is deliberate: every data mutation in the app — whether
// it goes through `apiRequest` or a raw `fetch()` — funnels through here, so a
// single override covers them all with no per-button wiring. The server enforces
// the same rule (see registerLiveDemoGuard in server/routes.ts); this layer is
// purely for UX.

let enabled = false;
let openModal: (() => void) | null = null;

export function setLiveDemoEnabled(value: boolean) {
  enabled = value;
}

export function isLiveDemoEnabled() {
  return enabled;
}

// The provider registers how to open the modal; cleared on unmount.
export function registerDeployModalOpener(fn: (() => void) | null) {
  openModal = fn;
}

// Thrown by the fetch guard when an action is blocked. The message is
// intentionally user-friendly so that if it ever surfaces in a toast it
// stays on-message rather than looking like an error.
export class LiveDemoBlockedError extends Error {
  constructor() {
    super("This is a live demo. Deploy your own to make changes.");
    this.name = "LiveDemoBlockedError";
  }
}

// After a blocked request, callers' own error handlers (React Query onError,
// raw-fetch catch blocks) fire their hardcoded "Failed to …" toasts. We can't
// edit them all, so we open a brief window during which the central toast()
// drops messages — the modal already explains what happened.
let lastBlockedAt = 0;
const SUPPRESS_WINDOW_MS = 2000;

export function markBlockedAction() {
  lastBlockedAt = Date.now();
}

export function shouldSuppressToast() {
  return Date.now() - lastBlockedAt < SUPPRESS_WINDOW_MS;
}

const MUTATING_METHODS = new Set(["POST", "PUT", "PATCH", "DELETE"]);

// Endpoints that must keep working even in demo mode (auth lifecycle).
const ALLOWLIST: RegExp[] = [
  /\/api\/auth\/login$/,
  /\/api\/auth\/logout$/,
];

function methodOf(input: RequestInfo | URL, init?: RequestInit): string {
  if (init?.method) return init.method;
  if (input instanceof Request) return input.method;
  return "GET";
}

function urlOf(input: RequestInfo | URL): string {
  if (typeof input === "string") return input;
  if (input instanceof URL) return input.toString();
  if (input instanceof Request) return input.url;
  return String(input);
}

export function isBlockedRequest(method: string, url: string): boolean {
  if (!enabled) return false;
  if (!MUTATING_METHODS.has(method.toUpperCase())) return false;
  if (!url.includes("/api/")) return false;
  if (ALLOWLIST.some((re) => re.test(url))) return false;
  return true;
}

let installed = false;

// Wrap window.fetch exactly once. Safe to call repeatedly.
export function installLiveDemoFetchGuard() {
  if (installed || typeof window === "undefined") return;
  installed = true;
  const original = window.fetch.bind(window);
  window.fetch = (input: RequestInfo | URL, init?: RequestInit) => {
    if (isBlockedRequest(methodOf(input, init), urlOf(input))) {
      markBlockedAction();
      openModal?.();
      return Promise.reject(new LiveDemoBlockedError());
    }
    return original(input, init);
  };
}

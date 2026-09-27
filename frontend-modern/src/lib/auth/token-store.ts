const STORAGE_KEY = "pvc-arvand-token";
export const AUTH_EXPIRED_EVENT = "pvc-arvand-auth-expired";

type Listener = (token: string | null) => void;

let currentToken: string | null = typeof window !== "undefined" ? window.localStorage.getItem(STORAGE_KEY) : null;
const listeners = new Set<Listener>();

export function getToken(): string | null {
  return currentToken;
}

export function setToken(token: string | null): void {
  currentToken = token;
  if (typeof window !== "undefined") {
    if (token) window.localStorage.setItem(STORAGE_KEY, token);
    else window.localStorage.removeItem(STORAGE_KEY);
  }
  listeners.forEach((listener) => listener(token));
}

export function subscribeToken(listener: Listener): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function notifyAuthExpired(): void {
  setToken(null);
  if (typeof window !== "undefined") window.dispatchEvent(new Event(AUTH_EXPIRED_EVENT));
}

import axios from "axios";
import { getToken, notifyAuthExpired } from "./auth/token-store";

function withApiSuffix(url: string): string {
  const trimmed = url.replace(/\/+$/, "");
  return trimmed.endsWith("/api") ? trimmed : `${trimmed}/api`;
}

function resolveApiUrl(): string {
  if (process.env.NEXT_PUBLIC_SAME_ORIGIN === "1") {
    return "/api";
  }
  const configured = (process.env.NEXT_PUBLIC_API_URL || "").trim();
  if (configured) {
    if (typeof window !== "undefined") {
      try {
        const cfg = new URL(withApiSuffix(configured));
        if (cfg.hostname === "127.0.0.1" || cfg.hostname === "localhost") {
          const pageHost = window.location.hostname;
          if (pageHost && pageHost !== "127.0.0.1" && pageHost !== "localhost") {
            cfg.hostname = pageHost;
            return cfg.toString().replace(/\/+$/, "");
          }
        }
        return cfg.toString().replace(/\/+$/, "");
      } catch {
        /* fall through */
      }
    }
    return withApiSuffix(configured);
  }
  if (typeof window !== "undefined") {
    const { protocol, hostname } = window.location;
    return `${protocol}//${hostname}:8010/api`;
  }
  return "http://127.0.0.1:8010/api";
}

export const API_URL = resolveApiUrl();

export const apiClient = axios.create({
  baseURL: API_URL,
  headers: { "Content-Type": "application/json" },
});

if (typeof window !== "undefined") {
  apiClient.defaults.baseURL = resolveApiUrl();
}

apiClient.interceptors.request.use((config) => {
  const token = getToken();
  if (token) {
    config.headers = config.headers || {};
    config.headers.Authorization = `Bearer ${token}`;
  }
  return config;
});

apiClient.interceptors.response.use(
  (response) => response,
  (error) => {
    if (error?.response?.status === 401 && !error?.config?.url?.includes("/auth/login")) {
      notifyAuthExpired();
    }
    const message =
      error?.response?.data?.detail ||
      error?.message ||
      "Unexpected error talking to the backend";
    return Promise.reject(new Error(typeof message === "string" ? message : JSON.stringify(message)));
  }
);

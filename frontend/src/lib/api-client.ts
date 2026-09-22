import axios from "axios";
import { getToken, notifyAuthExpired } from "./auth/token-store";

function withApiSuffix(url: string): string {
  const trimmed = url.replace(/\/+$/, "");
  return trimmed.endsWith("/api") ? trimmed : `${trimmed}/api`;
}

const sameOrigin = process.env.NEXT_PUBLIC_SAME_ORIGIN === "1";
const configured = process.env.NEXT_PUBLIC_API_URL;
export const API_URL = sameOrigin
  ? "/api"
  : withApiSuffix(configured || "http://127.0.0.1:8010");

export const apiClient = axios.create({
  baseURL: API_URL,
  headers: { "Content-Type": "application/json" },
});

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

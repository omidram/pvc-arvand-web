"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import { authApi } from "../endpoints";
import type { AuthUser, PermissionLevel } from "../types";
import { AUTH_EXPIRED_EVENT, getToken, setToken } from "./token-store";

interface AuthContextValue {
  user: AuthUser | null;
  isLoading: boolean;
  isAdmin: boolean;
  login: (username: string, password: string) => Promise<void>;
  logout: () => void;
  refresh: () => Promise<void>;
  levelOf: (formKey: string) => PermissionLevel;
  canView: (formKey: string) => boolean;
  canEdit: (formKey: string) => boolean;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  const loadMe = useCallback(async () => {
    if (!getToken()) {
      setUser(null);
      setIsLoading(false);
      return;
    }
    try {
      const me = await authApi.me();
      setUser(me);
    } catch {
      setToken(null);
      setUser(null);
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- initial auth check must run on mount
    loadMe();
    function onExpired() {
      setUser(null);
    }
    window.addEventListener(AUTH_EXPIRED_EVENT, onExpired);
    return () => window.removeEventListener(AUTH_EXPIRED_EVENT, onExpired);
  }, [loadMe]);

  const login = useCallback(async (username: string, password: string) => {
    const { access_token } = await authApi.login(username, password);
    setToken(access_token);
    const me = await authApi.me();
    setUser(me);
  }, []);

  const logout = useCallback(() => {
    setToken(null);
    setUser(null);
  }, []);

  const isAdmin = user?.role === "admin";

  const levelOf = useCallback(
    (formKey: string): PermissionLevel => {
      if (!user) return "none";
      if (isAdmin) return "edit";
      return user.permissions[formKey] || "none";
    },
    [user, isAdmin]
  );

  const canView = useCallback((formKey: string) => levelOf(formKey) === "view" || levelOf(formKey) === "edit", [levelOf]);
  const canEdit = useCallback((formKey: string) => levelOf(formKey) === "edit", [levelOf]);

  const value = useMemo(
    () => ({ user, isLoading, isAdmin: !!isAdmin, login, logout, refresh: loadMe, levelOf, canView, canEdit }),
    [user, isLoading, isAdmin, login, logout, loadMe, levelOf, canView, canEdit]
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within an AuthProvider");
  return ctx;
}

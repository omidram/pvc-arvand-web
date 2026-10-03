"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import { authApi } from "../endpoints";
import type { AuthUser, PermissionLevel } from "../types";
import { AUTH_EXPIRED_EVENT, getToken, setToken } from "./token-store";

const LEVEL_RANK: Record<PermissionLevel, number> = { none: 0, view: 1, edit: 2 };

interface AuthContextValue {
  user: AuthUser | null;
  isLoading: boolean;
  isAdmin: boolean;
  login: (username: string, password: string) => Promise<void>;
  logout: () => void;
  refresh: () => Promise<void>;
  levelOf: (formKey: string) => PermissionLevel;
  fieldLevelOf: (formKey: string, field: string) => PermissionLevel;
  canView: (formKey: string) => boolean;
  canEdit: (formKey: string) => boolean;
  canViewField: (formKey: string, field: string) => boolean;
  canEditField: (formKey: string, field: string) => boolean;
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

  const fieldLevelOf = useCallback(
    (formKey: string, field: string): PermissionLevel => {
      const formLevel = levelOf(formKey);
      if (formLevel === "none") return "none";
      if (!user || isAdmin) return formLevel;
      const specific = user.permissions[`${formKey}.${field}`] as PermissionLevel | undefined;
      if (!specific || !(specific in LEVEL_RANK)) return formLevel;
      return LEVEL_RANK[specific] <= LEVEL_RANK[formLevel] ? specific : formLevel;
    },
    [user, isAdmin, levelOf]
  );

  const canView = useCallback((formKey: string) => levelOf(formKey) === "view" || levelOf(formKey) === "edit", [levelOf]);
  const canEdit = useCallback((formKey: string) => levelOf(formKey) === "edit", [levelOf]);
  const canViewField = useCallback(
    (formKey: string, field: string) => {
      const level = fieldLevelOf(formKey, field);
      return level === "view" || level === "edit";
    },
    [fieldLevelOf]
  );
  const canEditField = useCallback(
    (formKey: string, field: string) => fieldLevelOf(formKey, field) === "edit",
    [fieldLevelOf]
  );

  const value = useMemo(
    () => ({
      user,
      isLoading,
      isAdmin: !!isAdmin,
      login,
      logout,
      refresh: loadMe,
      levelOf,
      fieldLevelOf,
      canView,
      canEdit,
      canViewField,
      canEditField,
    }),
    [user, isLoading, isAdmin, login, logout, loadMe, levelOf, fieldLevelOf, canView, canEdit, canViewField, canEditField]
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within an AuthProvider");
  return ctx;
}

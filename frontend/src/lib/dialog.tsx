"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { Modal } from "@/components/ui/modal";
import { Button } from "@/components/ui/button";
import { useI18n } from "@/lib/i18n/context";

type DialogKind = "alert" | "confirm";

type DialogRequest = {
  id: number;
  kind: DialogKind;
  title?: string;
  message: string;
  resolve: (value: boolean) => void;
};

type DialogApi = {
  alert: (message: string, title?: string) => Promise<void>;
  confirm: (message: string, title?: string) => Promise<boolean>;
};

const DialogContext = createContext<DialogApi | null>(null);

/** Imperative handles filled by DialogProvider — safe to call from any client code. */
let imperative: DialogApi | null = null;

export function appAlert(message: string, title?: string): Promise<void> {
  if (!imperative) {
    // Fallback before provider mounts (shouldn't happen in app UI)
    return Promise.resolve();
  }
  return imperative.alert(message, title);
}

export function appConfirm(message: string, title?: string): Promise<boolean> {
  if (!imperative) return Promise.resolve(false);
  return imperative.confirm(message, title);
}

export function useDialog(): DialogApi {
  const ctx = useContext(DialogContext);
  if (!ctx) throw new Error("useDialog must be used within DialogProvider");
  return ctx;
}

export function DialogProvider({ children }: { children: ReactNode }) {
  const { t } = useI18n();
  const [queue, setQueue] = useState<DialogRequest[]>([]);
  const seq = useRef(0);
  const current = queue[0] ?? null;

  const enqueue = useCallback((kind: DialogKind, message: string, title?: string) => {
    return new Promise<boolean>((resolve) => {
      const id = ++seq.current;
      setQueue((prev) => [...prev, { id, kind, message: String(message ?? ""), title, resolve }]);
    });
  }, []);

  const api = useMemo<DialogApi>(
    () => ({
      alert: async (message, title) => {
        await enqueue("alert", message, title);
      },
      confirm: (message, title) => enqueue("confirm", message, title),
    }),
    [enqueue]
  );

  useEffect(() => {
    imperative = api;
    return () => {
      if (imperative === api) imperative = null;
    };
  }, [api]);

  // Convert any leftover browser alerts into app modals.
  useEffect(() => {
    const prevAlert = window.alert.bind(window);
    const prevConfirm = window.confirm.bind(window);

    window.alert = (message?: unknown) => {
      void api.alert(message == null ? "" : String(message));
    };

    // Sync confirm cannot wait for a modal; route callers to async appConfirm.
    // Returning false avoids accidental destructive actions from unconverted sites.
    window.confirm = (message?: string) => {
      void api.confirm(message == null ? "" : String(message));
      if (process.env.NODE_ENV !== "production") {
        console.warn(
          "[dialog] window.confirm() was called synchronously; use await appConfirm(...) instead.",
          message
        );
      }
      return false;
    };

    return () => {
      window.alert = prevAlert;
      window.confirm = prevConfirm;
    };
  }, [api]);

  function finish(ok: boolean) {
    if (!current) return;
    current.resolve(ok);
    setQueue((prev) => prev.slice(1));
  }

  const title =
    current?.title ||
    (current?.kind === "confirm" ? t("common.confirmTitle") : t("common.alertTitle"));

  return (
    <DialogContext.Provider value={api}>
      {children}
      <Modal open={Boolean(current)} onClose={() => finish(current?.kind === "alert")} title={title}>
        {current ? (
          <div className="space-y-4">
            <p className="whitespace-pre-wrap text-sm leading-relaxed text-[var(--win-text)]">{current.message}</p>
            <div className="flex flex-wrap justify-end gap-2">
              {current.kind === "confirm" ? (
                <>
                  <Button type="button" variant="secondary" onClick={() => finish(false)}>
                    {t("common.no")}
                  </Button>
                  <Button type="button" variant="danger" onClick={() => finish(true)} autoFocus>
                    {t("common.yes")}
                  </Button>
                </>
              ) : (
                <Button type="button" variant="primary" onClick={() => finish(true)} autoFocus>
                  {t("common.ok")}
                </Button>
              )}
            </div>
          </div>
        ) : null}
      </Modal>
    </DialogContext.Provider>
  );
}

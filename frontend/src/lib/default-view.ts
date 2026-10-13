"use client";

import { useSyncExternalStore } from "react";

export type RecordView = "form" | "datasheet";

const STORAGE_KEY = "pvc-arvand-default-view";
const EVENT = "pvc-arvand-default-view";

/** Datasheet is the default so a form never opens straight onto an arbitrary record. */
export function getDefaultView(): RecordView {
  if (typeof window === "undefined") return "datasheet";
  try {
    return window.localStorage.getItem(STORAGE_KEY) === "form" ? "form" : "datasheet";
  } catch {
    return "datasheet";
  }
}

export function setDefaultView(view: RecordView) {
  try {
    window.localStorage.setItem(STORAGE_KEY, view);
  } catch {
    /* ignore */
  }
  window.dispatchEvent(new Event(EVENT));
}

function subscribe(callback: () => void) {
  window.addEventListener(EVENT, callback);
  window.addEventListener("storage", callback);
  return () => {
    window.removeEventListener(EVENT, callback);
    window.removeEventListener("storage", callback);
  };
}

export function useDefaultView(): RecordView {
  return useSyncExternalStore(subscribe, getDefaultView, () => "datasheet");
}

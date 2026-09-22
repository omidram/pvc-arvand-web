"use client";

import Link from "next/link";
import type { ReactNode } from "react";

export function AccessHub({
  title,
  titleBlue,
  backHref = "/",
  backLabel = "Main Menu",
  extraButtons,
  children,
}: {
  title: string;
  titleBlue?: boolean;
  backHref?: string;
  backLabel?: string;
  extraButtons?: ReactNode;
  children: ReactNode;
}) {
  return (
    <div className="access-hub" dir="ltr">
      <div className="access-hub-head">
        <div className={`access-hub-title ${titleBlue ? "is-blue" : ""}`}>{title}</div>
        <div className="flex flex-wrap items-start gap-2">
          {extraButtons}
          <Link href={backHref} className="access-menu-btn access-hub-menu-btn">
            {backLabel}
          </Link>
        </div>
      </div>
      {children}
    </div>
  );
}

export function AccessBtn({
  href,
  onClick,
  children,
  className,
  disabled,
}: {
  href?: string;
  onClick?: () => void;
  children: ReactNode;
  className?: string;
  disabled?: boolean;
}) {
  const cls = `access-menu-btn ${className ?? ""}`;
  if (href && !disabled) {
    return (
      <Link href={href} className={cls}>
        {children}
      </Link>
    );
  }
  return (
    <button type="button" className={cls} onClick={onClick} disabled={disabled}>
      {children}
    </button>
  );
}

export function AccessGroup({ legend, children }: { legend: string; children: ReactNode }) {
  return (
    <fieldset className="access-group">
      <legend>{legend}</legend>
      {children}
    </fieldset>
  );
}

export function AccessRadio({
  name,
  value,
  checked,
  onChange,
  label,
}: {
  name: string;
  value: string;
  checked: boolean;
  onChange: (value: string) => void;
  label: string;
}) {
  return (
    <label className="access-radio">
      <input type="radio" name={name} value={value} checked={checked} onChange={() => onChange(value)} />
      <span>{label}</span>
    </label>
  );
}

export function AccessPeriod({
  from,
  till,
  onFrom,
  onTill,
}: {
  from: string;
  till: string;
  onFrom: (value: string) => void;
  onTill: (value: string) => void;
}) {
  return (
    <div className="mb-3 flex flex-wrap items-end gap-3 text-[12px]">
      <span className="font-bold">Time Period from</span>
      <label className="inline-flex items-center gap-1">
        from
        <input type="date" className="access-inset-field w-[118px]" value={from} onChange={(e) => onFrom(e.target.value)} />
      </label>
      <label className="inline-flex items-center gap-1">
        till
        <input type="date" className="access-inset-field w-[118px]" value={till} onChange={(e) => onTill(e.target.value)} />
      </label>
    </div>
  );
}

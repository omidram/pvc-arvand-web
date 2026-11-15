"use client";

import { useState } from "react";
import { useI18n } from "@/lib/i18n/context";
import { formatNumber } from "@/lib/utils";

// Production per kiloampere per hour (ton). Chlorine = kA x 0.2074, caustic (NaOH 100%) = kA x 0.2336.
export const CL2_TON_PER_KA_HOUR = 0.2074;
export const NAOH_TON_PER_KA_HOUR = 0.2336;

const PERIODS = [
  { key: "hour", hours: 1 },
  { key: "day", hours: 24 },
  { key: "week", hours: 24 * 7 },
  { key: "month", hours: 24 * 30 },
] as const;

type PeriodKey = (typeof PERIODS)[number]["key"];
type Scope = "plant" | "1" | "2";

export interface ProductionTrain {
  train: "1" | "2";
  ka: number;
}

/** Chlorine and caustic output from the live in-service kiloamperes: hourly, daily, weekly or monthly. */
export function ProductionCard({ plantKa, trains }: { plantKa: number | null | undefined; trains: ProductionTrain[] }) {
  const { locale } = useI18n();
  const fa = locale === "fa";
  const [period, setPeriod] = useState<PeriodKey>("hour");
  const [scope, setScope] = useState<Scope>("plant");

  const trainKa = (id: "1" | "2") => trains.find((row) => row.train === id)?.ka ?? 0;
  const ka = scope === "plant" ? (plantKa ?? trainKa("1") + trainKa("2")) : trainKa(scope);
  const hours = PERIODS.find((row) => row.key === period)!.hours;
  const periodLabel = {
    hour: fa ? "ساعتی" : "Hourly",
    day: fa ? "روزانه" : "Daily",
    week: fa ? "هفتگی" : "Weekly",
    month: fa ? "ماهانه" : "Monthly",
  };
  const perUnit = { hour: "ton/hr", day: "ton/day", week: "ton/week", month: "ton/month" }[period];
  const scopeLabel = {
    plant: fa ? "کل واحد" : "Plant",
    "1": fa ? "قطار ۱" : "Train 1",
    "2": fa ? "قطار ۲" : "Train 2",
  };
  const cl2 = ka > 0 ? ka * CL2_TON_PER_KA_HOUR * hours : null;
  const naoh = ka > 0 ? ka * NAOH_TON_PER_KA_HOUR * hours : null;
  const digits = hours === 1 ? 2 : hours <= 24 ? 1 : 0;

  return (
    <div className="dv-card dv-production">
      <div className="dv-card-title">{fa ? "تولید کلر و کاستیک" : "Chlorine and caustic production"}</div>
      <div className="dv-prod-pickers">
        <div className="dv-span" role="group">
          {(["plant", "1", "2"] as const).map((key) => (
            <button key={key} type="button" className={scope === key ? "is-on" : ""} onClick={() => setScope(key)}>
              {scopeLabel[key]}
            </button>
          ))}
        </div>
        <div className="dv-span" role="group">
          {PERIODS.map(({ key }) => (
            <button key={key} type="button" className={period === key ? "is-on" : ""} onClick={() => setPeriod(key)}>
              {periodLabel[key]}
            </button>
          ))}
        </div>
      </div>
      <div className="dv-prod-rows">
        <div className="dv-prod-row is-cl2" title={`kA × ${CL2_TON_PER_KA_HOUR}${hours > 1 ? ` × ${hours} h` : ""}`}>
          <small>{fa ? "کلر (Cl₂)" : "Chlorine (Cl₂)"}</small>
          <b>{cl2 != null ? formatNumber(cl2, digits) : "—"}</b>
          <span>{perUnit}</span>
        </div>
        <div className="dv-prod-row is-naoh" title={`kA × ${NAOH_TON_PER_KA_HOUR}${hours > 1 ? ` × ${hours} h` : ""}`}>
          <small>{fa ? "کاستیک (NaOH ۱۰۰٪)" : "Caustic (NaOH 100%)"}</small>
          <b>{naoh != null ? formatNumber(naoh, digits) : "—"}</b>
          <span>{perUnit}</span>
        </div>
      </div>
      <div className="dv-prod-foot">
        {formatNumber(ka, 1)} kA · {fa ? "کیلوآمپر فعلی گزارش شیفت" : "current in-service kA (shift report)"}
        {hours > 1 ? ` · ${hours} h` : ""}
      </div>
    </div>
  );
}

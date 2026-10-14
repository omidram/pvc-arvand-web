"use client";

import { useState } from "react";
import { BookOpen, X } from "lucide-react";
import { useI18n } from "@/lib/i18n/context";

const INPUTS = ["vp", "cp", "ca", "gas", "n", "i", "akf", "k", "acid"] as const;

const STEPS: { key: string; formula: string }[] = [
  { key: "va", formula: "V_A = V_P · C_P,Na2SO4 / C_A,Na2SO4" },
  { key: "naclo3", formula: "η_NaClO3 = (C_A,NaClO3 · V_A − C_P,NaClO3 · V_P) / (n · I · 0.662) · 100" },
  { key: "naocl", formula: "η_NaOCl = C_A,NaOCl · V_A / (n · I · K) · 100" },
  { key: "hcl", formula: "η_HCl = (C_P,HCl · V_P − C_A,HCl · V_A) / (n · I · 1.36) · 100" },
  { key: "naoh", formula: "η_NaOH = C_P,NaOH · V_P / (n · I · 1.4923) · 100" },
  { key: "na2co3", formula: "η_Na2CO3 = C_P,Na2CO3 · V_P / (n · I · 1.978) · 100" },
  { key: "o2", formula: "η_O2 = 2 · (Y_O2 − 0.18 + AKF) / (Y_Cl2 + 2 · Y_O2) · (100 − η_NaClO3 − η_NaOCl)" },
  { key: "ce", formula: "CE = 100 − η_O2 − η_NaClO3 − η_NaOCl − η_HCl + η_Na2CO3 + η_NaOH" },
];

const RELATED: { key: string; formula: string }[] = [
  { key: "un", formula: "Un = 2.42 + (i_ref / i) · (U − 2.42) − (90 − t) · K_t + (32 − c) · K_c" },
  { key: "spc", formula: "SPC [kWh/t NaOH] = Un · 100000 / (1.4923 · CE)" },
  { key: "temp", formula: "T = t_m − (U_m − U_i) · 30" },
];

export function CeFormulaGuide() {
  const { t } = useI18n();
  const [open, setOpen] = useState(false);
  return (
    <>
      <button type="button" className="ce-guide-btn" onClick={() => setOpen((v) => !v)} aria-expanded={open}>
        <BookOpen size={14} /> {t("ceGuide.button")}
      </button>
      {open ? (
        <section className="ce-guide" dir="auto">
          <header className="ce-guide-head">
            <h3>{t("ceGuide.title")}</h3>
            <button type="button" className="ce-guide-close" onClick={() => setOpen(false)} aria-label={t("common.close")}>
              <X size={14} />
            </button>
          </header>
          <p>{t("ceGuide.intro")}</p>

          <h4>{t("ceGuide.inputsTitle")}</h4>
          <table className="ce-guide-table">
            <thead>
              <tr>
                <th>{t("ceGuide.col.symbol")}</th>
                <th>{t("ceGuide.col.meaning")}</th>
                <th>{t("ceGuide.col.source")}</th>
              </tr>
            </thead>
            <tbody>
              {INPUTS.map((k) => (
                <tr key={k}>
                  <td className="ce-guide-sym" dir="ltr">
                    {t(`ceGuide.input.${k}.sym`)}
                  </td>
                  <td>{t(`ceGuide.input.${k}.meaning`)}</td>
                  <td>{t(`ceGuide.input.${k}.source`)}</td>
                </tr>
              ))}
            </tbody>
          </table>

          <h4>{t("ceGuide.stepsTitle")}</h4>
          <ol className="ce-guide-steps">
            {STEPS.map((s) => (
              <li key={s.key}>
                <code dir="ltr">{s.formula}</code>
                <span>{t(`ceGuide.step.${s.key}`)}</span>
              </li>
            ))}
          </ol>

          <h4>{t("ceGuide.rulesTitle")}</h4>
          <ul className="ce-guide-notes">
            {(["match", "missing", "naohBasis", "constants"] as const).map((k) => (
              <li key={k}>{t(`ceGuide.rule.${k}`)}</li>
            ))}
          </ul>

          <h4>{t("ceGuide.relatedTitle")}</h4>
          <ol className="ce-guide-steps">
            {RELATED.map((s) => (
              <li key={s.key}>
                <code dir="ltr">{s.formula}</code>
                <span>{t(`ceGuide.related.${s.key}`)}</span>
              </li>
            ))}
          </ol>
        </section>
      ) : null}
    </>
  );
}

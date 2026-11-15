"use client";

import { useState } from "react";
import { BookOpen, X } from "lucide-react";
import { useI18n } from "@/lib/i18n/context";
import { useFormula } from "@/lib/formulas";

const INPUTS = ["vp", "cp", "ca", "gas", "n", "i", "akf", "k", "acid"] as const;

export function CeFormulaGuide() {
  const { t } = useI18n();
  const fNaclo3 = useFormula("anodic_ce", "f_naclo3", 0.662);
  const fNaclo = useFormula("anodic_ce", "f_naclo", 1.38869);
  const fHocl = useFormula("anodic_ce", "f_hocl", 0.98);
  const fHcl = useFormula("anodic_ce", "f_hcl", 1.36);
  const fAlkali = useFormula("anodic_ce", "f_alkali", 1.4923);
  const fNa2co3 = useFormula("anodic_ce", "f_na2co3", 1.978);
  const o2Background = useFormula("anodic_ce", "o2_background", 0.18);
  const u0 = useFormula("standardized_voltage", "u0", 2.42);
  const tRef = useFormula("standardized_voltage", "t_ref", 90);
  const cRef = useFormula("standardized_voltage", "c_ref", 32);
  const tempSpan = useFormula("standardized_voltage", "temp_span", 30);
  const spcScale = useFormula("spc", "scale", 100000);
  const steps = [
    { key: "va", formula: "V_A = V_P · C_P,Na2SO4 / C_A,Na2SO4" },
    { key: "naclo3", formula: `η_NaClO3 = (C_A,NaClO3 · V_A − C_P,NaClO3 · V_P) / (n · I · ${fNaclo3}) · 100` },
    { key: "naocl", formula: `η_NaOCl = C_A,NaOCl · V_A / (n · I · ${fNaclo}) · 100; HOCl uses ${fHocl}` },
    { key: "hcl", formula: `η_HCl = (C_P,HCl · V_P − C_A,HCl · V_A) / (n · I · ${fHcl}) · 100` },
    { key: "naoh", formula: `η_NaOH = C_P,NaOH · V_P / (n · I · ${fAlkali}) · 100` },
    { key: "na2co3", formula: `η_Na2CO3 = C_P,Na2CO3 · V_P / (n · I · ${fNa2co3}) · 100` },
    { key: "o2", formula: `η_O2 = 2 · (Y_O2 − ${o2Background} + AKF) / (Y_Cl2 + 2 · Y_O2) · (100 − η_NaClO3 − η_NaOCl)` },
    { key: "ce", formula: "CE = 100 − η_O2 − η_NaClO3 − η_NaOCl − η_HCl + η_Na2CO3 + η_NaOH" },
  ];
  const related = [
    { key: "un", formula: `Un = ${u0} + (i_ref / i) · (U − ${u0}) − (${tRef} − t) · K_t + (${cRef} − c) · K_c` },
    { key: "spc", formula: `SPC [kWh/t NaOH] = Un · ${spcScale} / (${fAlkali} · CE)` },
    { key: "temp", formula: `T = t_m − (U_m − U_i) · ${tempSpan}` },
  ];
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
            {steps.map((s) => (
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
            {related.map((s) => (
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

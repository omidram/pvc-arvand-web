"use client";

import { useEffect, useRef, type ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";
import { InspectionDefectGrid } from "@/components/domain/inspection-defect-grid";
import { InspectionSignaturePad } from "@/components/domain/inspection-signature";
import { DateInput } from "@/components/ui/date-input";
import { elementsApi, inspectionGridsApi, relationsApi } from "@/lib/endpoints";
import { useI18n } from "@/lib/i18n/context";
import { inspectionReasonLabel } from "@/lib/inspection-reason-names";
import { fieldDefsFromKeys, labelFieldOrHumanize } from "@/lib/access-datasheet-fields";
import type { FieldDef } from "@/components/ui/resource-form";

/** Columns written by the CZ-03-00-189-A sheet. Order matches the printed form, then the older flags. */
export const INSPECTION_SHEET_FIELDS = [
  "client",
  "anode_nr",
  "cathode_nr",
  "membrane_nr",
  "membrane_type",
  "electrolyzer",
  "position",
  "operation_days",
  "electrode_nr_anode",
  "electrode_nr_cathode",
  "element_nr",
  "inspection_reason",
  "inspection_date",
  "blister_anode_area",
  "blister_periphery_top",
  "blister_periphery_bottom",
  "blister_periphery_side",
  "blister_corners",
  "folds",
  "pressure_marks",
  "visible_holes",
  "cracks",
  "blister_remarks",
  "deformation_pan",
  "deformation_electrode",
  "coloured_area",
  "coloured_electrode",
  "coloured_pan",
  "deposits",
  "leakage_pan",
  "leakage_web",
  "leakage_corner",
  "leakage_outlet",
  "leakage_inlet",
  "sample_cathode",
  "sample_anode",
  "sample_membrane",
  "sample_cathode_note",
  "sample_anode_note",
  "sample_membrane_note",
  "anode_tube_ok",
  "anode_tube_remark",
  "cathode_tube_ok",
  "cathode_tube_remark",
  "anode_spacer_ok",
  "anode_spacer_remark",
  "cathode_spacer_ok",
  "cathode_spacer_remark",
  "frame_gasket_ok",
  "frame_gasket_remark",
  "inspector_name",
  "signature",
  "general_remarks",
  "xrf_anode",
  "xrf_cathode",
  "sign_insp_name",
  "sign_insp_image",
  "sign_insp_at",
  "sign_maint_name",
  "sign_maint_image",
  "sign_maint_at",
  "sign_proc_name",
  "sign_proc_image",
  "sign_proc_at",
] as const;

const INSPECTION_DATASHEET_SKIP = new Set(["sign_insp_image", "sign_maint_image", "sign_proc_image", "signature"]);

const INSPECTION_DATASHEET_BOOL = new Set<string>([
  "sample_cathode",
  "sample_anode",
  "sample_membrane",
  "anode_tube_ok",
  "cathode_tube_ok",
  "anode_spacer_ok",
  "cathode_spacer_ok",
  "frame_gasket_ok",
]);

const INSPECTION_DATASHEET_DATE = new Set(["inspection_date", "sign_insp_at", "sign_maint_at", "sign_proc_at"]);

const INSPECTION_DATASHEET_TEXTAREA = new Set([
  "general_remarks",
  "blister_remarks",
  "sample_cathode_note",
  "sample_anode_note",
  "sample_membrane_note",
  "anode_tube_remark",
  "cathode_tube_remark",
  "anode_spacer_remark",
  "cathode_spacer_remark",
  "frame_gasket_remark",
]);

/** All CZ-03 sheet columns for AccessWorkspace datasheet view (matches form fields). */
export function inspectionDatasheetFields(t: (path: string) => string): FieldDef[] {
  const keys = INSPECTION_SHEET_FIELDS.filter((name) => !INSPECTION_DATASHEET_SKIP.has(name));
  const hints: Partial<Record<string, FieldDef["type"]>> = {};
  for (const name of keys) {
    if (INSPECTION_DATASHEET_BOOL.has(name)) hints[name] = "checkbox";
    else if (INSPECTION_DATASHEET_DATE.has(name)) hints[name] = "datetime-local";
    else if (INSPECTION_DATASHEET_TEXTAREA.has(name)) hints[name] = "textarea";
  }
  return fieldDefsFromKeys(keys, (name) => labelFieldOrHumanize(t, name), hints);
}

const GRID_TYPES = ["membrane_as", "membrane_ks", "membrane_lt", "anode_half", "cathode_half"] as const;

export function inspectionSheetPayload(values: Record<string, unknown>): Record<string, unknown> {
  const payload: Record<string, unknown> = {};
  for (const key of INSPECTION_SHEET_FIELDS) {
    if (!Object.prototype.hasOwnProperty.call(values, key)) continue;
    const value = values[key];
    if (typeof value === "boolean") payload[key] = value;
    else if (value == null || value === "") payload[key] = null;
    else payload[key] = value;
  }
  return payload;
}

export function inspectionSheetGrids(values: Record<string, unknown>): Record<string, Record<string, unknown>> {
  const raw = values.__grids;
  if (!raw || typeof raw !== "object") return {};
  const out: Record<string, Record<string, unknown>> = {};
  for (const gridType of GRID_TYPES) {
    const data = (raw as Record<string, unknown>)[gridType];
    if (data && typeof data === "object") out[gridType] = data as Record<string, unknown>;
  }
  return out;
}

type SheetProps = {
  values: Record<string, unknown>;
  onChange: (name: string, value: unknown) => void;
  onPatch: (patch: Record<string, unknown>) => void;
  readOnly: boolean;
  recordId: string | number | null;
};

function text(value: unknown): string {
  return value == null ? "" : String(value);
}

export function InspectionSheet({ values, onChange, onPatch, readOnly, recordId }: SheetProps) {
  const { t } = useI18n();
  const patchRef = useRef(onPatch);
  patchRef.current = onPatch;
  const valuesRef = useRef(values);
  valuesRef.current = values;
  const seenGrid = useRef("");
  const matchSeq = useRef(0);

  const numericId = recordId == null || recordId === "" ? null : Number(recordId);
  const gridsQuery = useQuery({
    queryKey: ["inspection-grids", numericId],
    queryFn: () => inspectionGridsApi.list(numericId as number),
    enabled: numericId != null && !Number.isNaN(numericId),
  });

  useEffect(() => {
    if (numericId == null) {
      seenGrid.current = "";
      return;
    }
    if (!gridsQuery.isSuccess || !gridsQuery.data) return;
    const token = String(numericId);
    if (seenGrid.current === token) return;
    seenGrid.current = token;
    const loaded: Record<string, Record<string, unknown>> = {};
    for (const row of gridsQuery.data) {
      loaded[row.grid_type] = (row.grid_data as Record<string, unknown>) || {};
    }
    const local = (valuesRef.current.__grids as Record<string, Record<string, unknown>> | undefined) || {};
    const merged = { ...loaded };
    for (const [key, data] of Object.entries(local)) {
      if (data && Object.keys(data).length) merged[key] = data;
    }
    patchRef.current({ __grids: merged });
  }, [numericId, gridsQuery.isSuccess, gridsQuery.data]);

  const elementNumbers = useQuery({
    queryKey: ["relations", "element-numbers"],
    queryFn: () => relationsApi.lookup("element-numbers"),
  });
  const electrolyzers = useQuery({
    queryKey: ["relations", "electrolyzers"],
    queryFn: () => relationsApi.lookup("electrolyzers"),
  });
  const membraneTypes = useQuery({
    queryKey: ["relations", "membrane-types"],
    queryFn: () => relationsApi.lookup("membrane-types"),
  });
  const reasons = useQuery({
    queryKey: ["relations", "inspection-reasons"],
    queryFn: () => relationsApi.lookup("inspection-reasons"),
  });

  async function pull(focus: string, typed?: string) {
    const current = (typed ?? text(valuesRef.current[focus])).trim();
    if (!current) return;
    const seq = ++matchSeq.current;
    const hints = { ...valuesRef.current, [focus]: current };
    const found = await elementsApi.match({
      focus,
      element_nr: text(hints.element_nr) || undefined,
      anode_nr: text(hints.anode_nr) || undefined,
      cathode_nr: text(hints.cathode_nr) || undefined,
      membrane_nr: text(hints.membrane_nr) || undefined,
      electrolyzer: text(hints.electrolyzer) || undefined,
      position: text(hints.position) || undefined,
      membrane_type: text(hints.membrane_type) || undefined,
    });
    if (seq !== matchSeq.current || !found) return;
    const patch: Record<string, unknown> = {};
    const take = (key: string, value: unknown) => {
      if (value != null && String(value) !== "") patch[key] = String(value);
    };
    take("element_nr", found.element_nr);
    take("anode_nr", found.anode_nr);
    take("cathode_nr", found.cathode_nr);
    take("membrane_nr", found.membrane_nr);
    take("membrane_type", found.membrane_type);
    take("electrolyzer", found.electrolyzer);
    take("position", found.position);
    if (found.computed_dol_days != null) patch.operation_days = String(found.computed_dol_days);
    if (Object.keys(patch).length) patchRef.current(patch);
  }

  function grids(): Record<string, Record<string, unknown>> {
    return (values.__grids as Record<string, Record<string, unknown>> | undefined) || {};
  }

  function setGrid(gridType: string, data: Record<string, unknown>) {
    onPatch({ __grids: { ...grids(), [gridType]: data } });
  }

  function line(name: string, list?: string, onBlur?: (typed: string) => void) {
    return (
      <input
        className="insp-in"
        value={text(values[name])}
        disabled={readOnly}
        list={list}
        onChange={(e) => onChange(name, e.target.value)}
        onBlur={onBlur ? (e) => onBlur(e.currentTarget.value) : undefined}
      />
    );
  }

  function note(noteKey: string, flagKey: string) {
    const stored = values[noteKey];
    const shown = stored != null && String(stored) !== "" ? String(stored) : values[flagKey] ? "Yes" : "";
    return (
      <input
        className="insp-in"
        value={shown}
        disabled={readOnly}
        onChange={(e) => onPatch({ [noteKey]: e.target.value, [flagKey]: e.target.value.trim() !== "" })}
      />
    );
  }

  function labeled(label: string, control: ReactNode) {
    return (
      <div className="insp-pairline">
        <span className="insp-lab">{label}</span>
        {control}
      </div>
    );
  }

  function gridPane(gridType: string, caption: string, opts?: { banner?: string; underline?: boolean; align?: "left" | "center"; insert?: boolean; bare?: boolean }) {
    return (
      <div className={opts?.bare ? "insp-pane-bare" : "insp-pane"}>
        {opts?.banner ? <div className="insp-banner">{opts.banner}</div> : null}
        <div className={`insp-caption${opts?.underline ? " is-under" : ""}${opts?.align === "left" ? " is-left" : ""}`}>{caption}</div>
        <div className="insp-grid">
          <InspectionDefectGrid dense legend={false} disabled={readOnly} value={grids()[gridType] || {}} onChange={(next) => setGrid(gridType, next)} />
        </div>
        {opts?.insert ? <div className="insp-insert">Insertpipe</div> : null}
      </div>
    );
  }

  return (
    <div className="insp-scroll">
      <div className="insp-sheet" dir="ltr">
        <table className="insp-tbl">
          <tbody>
            <tr>
              <th className="insp-title" colSpan={3}>
                INSPECTION REPORT MEMBRANE/ANODE/CATHODE
              </th>
            </tr>
            <tr>
              <td>{labeled("Client:", line("client"))}</td>
              <td>{labeled("Anode NO:", line("anode_nr", undefined, (typed) => pull("anode_nr", typed)))}</td>
              <td>
                {labeled(
                  "Date:",
                  <DateInput type="date" disabled={readOnly} value={text(values.inspection_date)} onChange={(e) => onChange("inspection_date", e.target.value)} />
                )}
              </td>
            </tr>
            <tr>
              <td>{labeled("electrolyzer No:", line("electrolyzer", "insp-electrolyzers", (typed) => pull("electrolyzer", typed)))}</td>
              <td>{labeled("Cathode No:", line("cathode_nr", undefined, (typed) => pull("cathode_nr", typed)))}</td>
              <td>{labeled("Operation days:", line("operation_days"))}</td>
            </tr>
            <tr>
              <td>{labeled("Position:", line("position", undefined, (typed) => pull("position", typed)))}</td>
              <td>{labeled("membrane No:", line("membrane_nr", undefined, (typed) => pull("membrane_nr", typed)))}</td>
              <td>{labeled("Electrode No:(Anode)", line("electrode_nr_anode"))}</td>
            </tr>
            <tr>
              <td>{labeled("Element no:", line("element_nr", "insp-elements", (typed) => pull("element_nr", typed)))}</td>
              <td>{labeled("membrane Type:", line("membrane_type", "insp-membrane-types", (typed) => pull("membrane_type", typed)))}</td>
              <td>{labeled("Electrode No:(Cathode)", line("electrode_nr_cathode"))}</td>
            </tr>
            <tr>
              <td colSpan={3}>
                <div className="insp-pairline">
                  <span className="insp-lab">Reason for insepection</span>
                  {line("inspection_reason", "insp-reasons")}
                  <input
                    className="insp-mini"
                    aria-label="Memberane NO"
                    value={text(values.membrane_nr)}
                    disabled={readOnly}
                    onChange={(e) => onChange("membrane_nr", e.target.value)}
                    onBlur={(e) => pull("membrane_nr", e.currentTarget.value)}
                  />
                  <span className="insp-lab">Memberane NO</span>
                </div>
              </td>
            </tr>
          </tbody>
        </table>

        <p className="insp-hint">{t("inspections.clickHint")}</p>

        <div className="insp-top">
          <div className="insp-pane">
            <div className="insp-banner is-left">Membrane inspection</div>
            {gridPane("membrane_as", "Anode Side (top view)", { align: "left", bare: true })}
          </div>
          <table className="insp-tbl insp-blister">
            <tbody>
              <tr>
                <th colSpan={5}>Blister</th>
              </tr>
              <tr>
                <th>Anode Surface</th>
                <th colSpan={3}>Periphery</th>
                <th>Corner</th>
              </tr>
              <tr>
                <th>%</th>
                <th>%</th>
                <th>%</th>
                <th>%</th>
                <th>%</th>
              </tr>
              <tr>
                <td>{line("blister_anode_area")}</td>
                <td>{line("blister_periphery_top")}</td>
                <td>{line("blister_periphery_bottom")}</td>
                <td>{line("blister_periphery_side")}</td>
                <td>{line("blister_corners")}</td>
              </tr>
              <tr>
                <td className="insp-lab">Wrinkle(w)</td>
                <td colSpan={4}>{line("folds")}</td>
              </tr>
              <tr>
                <td className="insp-lab">Pressure marks(pm)</td>
                <td colSpan={4}>{line("pressure_marks")}</td>
              </tr>
              <tr>
                <td className="insp-lab">Visible holes(vh)</td>
                <td colSpan={4}>{line("visible_holes")}</td>
              </tr>
              <tr>
                <td className="insp-lab">Tears(T)</td>
                <td colSpan={4}>{line("cracks")}</td>
              </tr>
              <tr>
                <td className="insp-lab insp-topcell">Remarks:</td>
                <td colSpan={4}>
                  <textarea
                    className="insp-in insp-remarks"
                    value={text(values.blister_remarks)}
                    disabled={readOnly}
                    onChange={(e) => onChange("blister_remarks", e.target.value)}
                  />
                </td>
              </tr>
              <tr>
                <td className="insp-lab">XRF.Anode:</td>
                <td colSpan={4}>{line("xrf_anode")}</td>
              </tr>
              <tr>
                <td className="insp-lab">XRF.Cathode:</td>
                <td colSpan={4}>{line("xrf_cathode")}</td>
              </tr>
            </tbody>
          </table>
        </div>

        <div className="insp-split">
          {gridPane("membrane_ks", "Cathode Side (plan view)", { underline: true })}
          {gridPane("membrane_lt", "Leak test anode side (plan view)", { underline: true })}
        </div>

        <div className="insp-split">
          {gridPane("anode_half", "Anode half shell (plan view)", { banner: "Half shell inspection", underline: true, insert: true })}
          {gridPane("cathode_half", "cathode half shell (plan view)", { banner: "Half shell inspection", underline: true, insert: true })}
        </div>

        <table className="insp-tbl">
          <tbody>
            <tr>
              <td>{labeled("Deformation pan (DP):", line("deformation_pan"))}</td>
              <td rowSpan={5} className="insp-topcell insp-deposits-cell">
                <div className="insp-lab">Deposits(D):</div>
                <textarea
                  className="insp-in insp-deposits"
                  value={text(values.deposits)}
                  disabled={readOnly}
                  onChange={(e) => onChange("deposits", e.target.value)}
                />
              </td>
              <td>{labeled("Leakage pan(LP):", line("leakage_pan"))}</td>
            </tr>
            <tr>
              <td>{labeled("Deformation electrode (DP):", line("deformation_electrode"))}</td>
              <td>{labeled("Leakage Web area (Lw):", line("leakage_web"))}</td>
            </tr>
            <tr>
              <td>{labeled("coloured area (CA):", line("coloured_area"))}</td>
              <td>{labeled("Leakage corner area (LC):", line("leakage_corner"))}</td>
            </tr>
            <tr>
              <td>{labeled("coloured electrode(CE):", line("coloured_electrode"))}</td>
              <td>{labeled("Leakage outlet nozzle(LO):", line("leakage_outlet"))}</td>
            </tr>
            <tr>
              <td>{labeled("coloured pan (CP):", line("coloured_pan"))}</td>
              <td>{labeled("Leakage inlet nozzle (LI):", line("leakage_inlet"))}</td>
            </tr>
            <tr>
              <td>{labeled("sample taken:", <span className="insp-in" />)}</td>
              <td>{labeled("insert pipe(Anode):", note("anode_tube_remark", "anode_tube_ok"))}</td>
              <td>{labeled("Name:", line("inspector_name"))}</td>
            </tr>
            <tr>
              <td>{labeled("cathode:", note("sample_cathode_note", "sample_cathode"))}</td>
              <td>{labeled("insert pipe(cathode):", note("cathode_tube_remark", "cathode_tube_ok"))}</td>
              <td>
                {labeled(
                  "Date:",
                  <DateInput type="date" disabled={readOnly} value={text(values.inspection_date)} onChange={(e) => onChange("inspection_date", e.target.value)} />
                )}
              </td>
            </tr>
            <tr>
              <td>{labeled("Anode:", note("sample_anode_note", "sample_anode"))}</td>
              <td>{labeled("spacer strip(Anode):", note("anode_spacer_remark", "anode_spacer_ok"))}</td>
              <td rowSpan={3} className="insp-topcell insp-sign-cell">
                <div className="insp-sign-stack">
                  <InspectionSignaturePad
                    label="Insp."
                    name={text(values.sign_insp_name) || text(values.signature)}
                    image={text(values.sign_insp_image)}
                    readOnly={readOnly}
                    onChange={(patch) =>
                      onPatch({
                        sign_insp_name: patch.name ?? values.sign_insp_name,
                        sign_insp_image: patch.image ?? values.sign_insp_image,
                        sign_insp_at: patch.at ?? values.sign_insp_at,
                        signature: patch.name ?? values.signature,
                      })
                    }
                  />
                  <InspectionSignaturePad
                    label="Maint."
                    name={text(values.sign_maint_name)}
                    image={text(values.sign_maint_image)}
                    readOnly={readOnly}
                    onChange={(patch) =>
                      onPatch({
                        sign_maint_name: patch.name ?? values.sign_maint_name,
                        sign_maint_image: patch.image ?? values.sign_maint_image,
                        sign_maint_at: patch.at ?? values.sign_maint_at,
                      })
                    }
                  />
                  <InspectionSignaturePad
                    label="Proc."
                    name={text(values.sign_proc_name)}
                    image={text(values.sign_proc_image)}
                    readOnly={readOnly}
                    onChange={(patch) =>
                      onPatch({
                        sign_proc_name: patch.name ?? values.sign_proc_name,
                        sign_proc_image: patch.image ?? values.sign_proc_image,
                        sign_proc_at: patch.at ?? values.sign_proc_at,
                      })
                    }
                  />
                </div>
              </td>
            </tr>
            <tr>
              <td>{labeled("Membrane:", note("sample_membrane_note", "sample_membrane"))}</td>
              <td>{labeled("spacer strip(cathode):", note("cathode_spacer_remark", "cathode_spacer_ok"))}</td>
            </tr>
            <tr>
              <td className="insp-topcell">
                <div className="insp-lab">REMARKS</div>
                <textarea
                  className="insp-in insp-remarks"
                  value={text(values.general_remarks)}
                  disabled={readOnly}
                  onChange={(e) => onChange("general_remarks", e.target.value)}
                />
              </td>
              <td>{labeled("Frame gasket:", note("frame_gasket_remark", "frame_gasket_ok"))}</td>
            </tr>
          </tbody>
        </table>
        <div className="insp-formno">CZ-03-00-189-A</div>

        <datalist id="insp-elements">
          {(elementNumbers.data || []).map((value) => (
            <option key={value} value={value} />
          ))}
        </datalist>
        <datalist id="insp-electrolyzers">
          {(electrolyzers.data || []).map((value) => (
            <option key={value} value={value} />
          ))}
        </datalist>
        <datalist id="insp-membrane-types">
          {(membraneTypes.data || []).map((value) => (
            <option key={value} value={value} />
          ))}
        </datalist>
        <datalist id="insp-reasons">
          {(reasons.data || []).map((value) => (
            <option key={value} value={value} label={inspectionReasonLabel(value, t)}>
              {inspectionReasonLabel(value, t)}
            </option>
          ))}
        </datalist>
      </div>
    </div>
  );
}

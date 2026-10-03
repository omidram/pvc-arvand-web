"use client";

import { useQuery } from "@tanstack/react-query";
import { InspectionSignaturePad } from "@/components/domain/inspection-signature";
import {
  ASSEMBLY_ACTIVITY_SECTIONS,
  emptyAssemblyCheckRemarks,
  emptyAssemblyChecks,
  POSITION_OPTIONS,
} from "@/lib/assembly-inspection";
import { elementsApi, relationsApi } from "@/lib/endpoints";

type Props = {
  values: Record<string, unknown>;
  onChange: (name: string, value: unknown) => void;
  onPatch: (patch: Record<string, unknown>) => void;
  readOnly: boolean;
};

function text(value: unknown): string {
  return value == null ? "" : String(value);
}

function checksOf(values: Record<string, unknown>): Record<string, boolean> {
  const base = emptyAssemblyChecks();
  const raw = values.checks;
  if (raw && typeof raw === "object") {
    for (const key of Object.keys(base)) {
      base[key] = Boolean((raw as Record<string, unknown>)[key]);
    }
  }
  return base;
}

function checkRemarksOf(values: Record<string, unknown>): Record<string, string> {
  const base = emptyAssemblyCheckRemarks();
  const raw = values.check_remarks;
  if (raw && typeof raw === "object") {
    for (const key of Object.keys(base)) {
      const val = (raw as Record<string, unknown>)[key];
      base[key] = val == null ? "" : String(val);
    }
  }
  return base;
}

function HeadCell({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <td className="asm-hcell">
      <div className="asm-hlabel">{label}</div>
      <div className="asm-hvalue">{children}</div>
    </td>
  );
}

export function AssemblyInspectionSheet({ values, onChange, onPatch, readOnly }: Props) {
  const checks = checksOf(values);
  const checkRemarks = checkRemarksOf(values);

  const anodes = useQuery({ queryKey: ["relations", "anode-numbers"], queryFn: () => relationsApi.lookup("anode-numbers") });
  const cathodes = useQuery({ queryKey: ["relations", "cathode-numbers"], queryFn: () => relationsApi.lookup("cathode-numbers") });
  const membranes = useQuery({ queryKey: ["relations", "membrane-numbers"], queryFn: () => relationsApi.lookup("membrane-numbers") });
  const membraneTypes = useQuery({ queryKey: ["relations", "membrane-types"], queryFn: () => relationsApi.lookup("membrane-types") });
  const groups = useQuery({ queryKey: ["relations", "groups"], queryFn: () => relationsApi.lookup("groups") });
  const electrolyzers = useQuery({ queryKey: ["relations", "electrolyzers"], queryFn: () => relationsApi.lookup("electrolyzers") });
  const elements = useQuery({ queryKey: ["relations", "element-numbers"], queryFn: () => relationsApi.lookup("element-numbers") });

  function setCheck(key: string, checked: boolean) {
    onChange("checks", { ...checks, [key]: checked });
  }

  function setCheckRemark(key: string, remark: string) {
    onChange("check_remarks", { ...checkRemarks, [key]: remark });
  }

  const linkFields = [
    "element_nr",
    "anode_nr",
    "cathode_nr",
    "membrane_nr",
    "electrolyzer",
    "position",
    "membrane_type",
    "group_nr",
  ] as const;

  async function resolveLinked(focus: string, typed: string) {
    if (!typed.trim() || !linkFields.includes(focus as (typeof linkFields)[number])) return;
    try {
      const match = await elementsApi.match({
        focus,
        element_nr: String(values.element_nr ?? (focus === "element_nr" ? typed : "")),
        anode_nr: String(values.anode_nr ?? (focus === "anode_nr" ? typed : "")),
        cathode_nr: String(values.cathode_nr ?? (focus === "cathode_nr" ? typed : "")),
        membrane_nr: String(values.membrane_nr ?? (focus === "membrane_nr" ? typed : "")),
        electrolyzer: String(values.electrolyzer ?? (focus === "electrolyzer" ? typed : "")),
        position: String(values.position ?? (focus === "position" ? typed : "")),
        membrane_type: String(values.membrane_type ?? (focus === "membrane_type" ? typed : "")),
        group_nr: String(values.group_nr ?? (focus === "group_nr" ? typed : "")),
      });
      if (!match) return;
      onPatch({
        element_nr: match.element_nr ?? values.element_nr,
        anode_nr: match.anode_nr ?? values.anode_nr,
        cathode_nr: match.cathode_nr ?? values.cathode_nr,
        membrane_nr: match.membrane_nr ?? values.membrane_nr,
        membrane_type: match.membrane_type ?? values.membrane_type,
        electrolyzer: match.electrolyzer ?? values.electrolyzer,
        position: match.position ?? values.position,
        group_nr: match.group_nr ?? values.group_nr,
        assembly_date: values.assembly_date || match.assembly_date || null,
      });
    } catch {
      /* ignore lookup misses */
    }
  }

  function combo(
    name: string,
    listId: string,
    options: string[] | undefined,
    opts?: { type?: string; link?: boolean }
  ) {
    return (
      <>
        <input
          className="asm-paper-in"
          type={opts?.type || "text"}
          list={listId}
          value={text(values[name]).slice(0, opts?.type === "date" ? 10 : undefined)}
          disabled={readOnly}
          onChange={(e) => onChange(name, e.target.value || null)}
          onBlur={(e) => {
            if (opts?.link) void resolveLinked(name, e.currentTarget.value);
          }}
        />
        <datalist id={listId}>
          {(options || []).map((opt) => (
            <option key={opt} value={opt} />
          ))}
        </datalist>
      </>
    );
  }

  return (
    <div className="asm-scroll">
      <div className="asm-paper" dir="ltr">
        {/* Header band — Uhde | title | Arvand logo */}
        <div className="asm-top">
          <div className="asm-top-left">Uhde</div>
          <div className="asm-top-title">Inspection Report for the Assembly of cell Elements</div>
          <div className="asm-top-logo">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src="/logo-arvand.png" alt="Arvand" />
          </div>
        </div>

        {/* Identifying fields — exact 2×5 grid */}
        <table className="asm-paper-tbl asm-id-tbl">
          <tbody>
            <tr>
              <HeadCell label="Assembly Date">{combo("assembly_date", "asm-dl-date", undefined, { type: "date" })}</HeadCell>
              <HeadCell label="Anode No">{combo("anode_nr", "asm-dl-anode", anodes.data, { link: true })}</HeadCell>
              <HeadCell label="Cathode No">{combo("cathode_nr", "asm-dl-cathode", cathodes.data, { link: true })}</HeadCell>
              <HeadCell label="Membrane type">{combo("membrane_type", "asm-dl-mtype", membraneTypes.data, { link: true })}</HeadCell>
              <HeadCell label="Membrane no">{combo("membrane_nr", "asm-dl-membrane", membranes.data, { link: true })}</HeadCell>
            </tr>
            <tr>
              <HeadCell label="Element No.">{combo("element_nr", "asm-dl-element", elements.data, { link: true })}</HeadCell>
              <HeadCell label="Electrolyzer">{combo("electrolyzer", "asm-dl-elo", electrolyzers.data, { link: true })}</HeadCell>
              <HeadCell label="Position">{combo("position", "asm-dl-pos", POSITION_OPTIONS, { link: true })}</HeadCell>
              <HeadCell label="Group">{combo("group_nr", "asm-dl-group", groups.data, { link: true })}</HeadCell>
              <HeadCell label="Remarks">
                <input
                  className="asm-paper-in"
                  value={text(values.remarks)}
                  disabled={readOnly}
                  onChange={(e) => onChange("remarks", e.target.value)}
                />
              </HeadCell>
            </tr>
          </tbody>
        </table>

        {/* Activities — category | checked | text | remark */}
        <table className="asm-paper-tbl asm-act-tbl">
          <thead>
            <tr>
              <th className="asm-act-cat" />
              <th className="asm-act-check">checked</th>
              <th className="asm-act-text">Activities</th>
              <th className="asm-act-remark">Remark</th>
            </tr>
          </thead>
          <tbody>
            {ASSEMBLY_ACTIVITY_SECTIONS.map((section) =>
              section.items.map((item, idx) => (
                <tr key={item.key}>
                  {idx === 0 ? (
                    <td className="asm-act-cat" rowSpan={section.items.length}>
                      <span className="asm-act-cat-label">{section.title}</span>
                    </td>
                  ) : null}
                  <td className="asm-act-check">
                    <input
                      id={`asm-chk-${item.key}`}
                      type="checkbox"
                      className="asm-mini-box"
                      checked={Boolean(checks[item.key])}
                      disabled={readOnly}
                      onChange={(e) => setCheck(item.key, e.target.checked)}
                      aria-label={`checked: ${item.label}`}
                    />
                  </td>
                  <td className="asm-act-text">
                    <label className="asm-act-line" htmlFor={`asm-chk-${item.key}`}>
                      <span>{item.label}</span>
                    </label>
                  </td>
                  <td className="asm-act-remark">
                    <input
                      className="asm-paper-in asm-remark-in"
                      value={checkRemarks[item.key] || ""}
                      disabled={readOnly}
                      onChange={(e) => setCheckRemark(item.key, e.target.value)}
                      aria-label={`remark: ${item.label}`}
                    />
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>

        {/* Measurements */}
        <table className="asm-paper-tbl asm-meas-tbl">
          <tbody>
            <tr>
              <td>
                <span className="asm-meas-lab">Spacer thickness of anode:</span>
                <input
                  className="asm-paper-in asm-meas-in"
                  value={text(values.spacer_thickness_anode)}
                  disabled={readOnly}
                  onChange={(e) => onChange("spacer_thickness_anode", e.target.value)}
                />
              </td>
              <td>
                <span className="asm-meas-lab">Spacer thickness of cathode:</span>
                <input
                  className="asm-paper-in asm-meas-in"
                  value={text(values.spacer_thickness_cathode)}
                  disabled={readOnly}
                  onChange={(e) => onChange("spacer_thickness_cathode", e.target.value)}
                />
              </td>
              <td>
                <span className="asm-meas-lab">Electrode distance:</span>
                <input
                  className="asm-paper-in asm-meas-in"
                  value={text(values.electrode_distance)}
                  disabled={readOnly}
                  onChange={(e) => onChange("electrode_distance", e.target.value)}
                />
              </td>
            </tr>
          </tbody>
        </table>

        {/* Signatures — Maintenance / Inspection / Process */}
        <table className="asm-paper-tbl asm-sign-tbl">
          <tbody>
            <tr>
              <td className="asm-sign-cell">
                <InspectionSignaturePad
                  label="Maintenance cell work shop"
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
              </td>
              <td className="asm-sign-cell">
                <InspectionSignaturePad
                  label="Inspection"
                  name={text(values.sign_insp_name)}
                  image={text(values.sign_insp_image)}
                  readOnly={readOnly}
                  onChange={(patch) =>
                    onPatch({
                      sign_insp_name: patch.name ?? values.sign_insp_name,
                      sign_insp_image: patch.image ?? values.sign_insp_image,
                      sign_insp_at: patch.at ?? values.sign_insp_at,
                    })
                  }
                />
              </td>
              <td className="asm-sign-cell">
                <InspectionSignaturePad
                  label="Process"
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
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>
  );
}

export function assemblyInspectionPayload(values: Record<string, unknown>): Record<string, unknown> {
  return {
    assembly_date: values.assembly_date || null,
    element_nr: values.element_nr || null,
    anode_nr: values.anode_nr || null,
    cathode_nr: values.cathode_nr || null,
    membrane_nr: values.membrane_nr || null,
    membrane_type: values.membrane_type || null,
    electrolyzer: values.electrolyzer || null,
    position: values.position || null,
    group_nr: values.group_nr || null,
    remarks: values.remarks || null,
    checks: checksOf(values),
    check_remarks: checkRemarksOf(values),
    spacer_thickness_anode: values.spacer_thickness_anode || null,
    spacer_thickness_cathode: values.spacer_thickness_cathode || null,
    electrode_distance: values.electrode_distance || null,
    sign_maint_name: values.sign_maint_name || null,
    sign_maint_image: values.sign_maint_image || null,
    sign_maint_at: values.sign_maint_at || null,
    sign_insp_name: values.sign_insp_name || null,
    sign_insp_image: values.sign_insp_image || null,
    sign_insp_at: values.sign_insp_at || null,
    sign_proc_name: values.sign_proc_name || null,
    sign_proc_image: values.sign_proc_image || null,
    sign_proc_at: values.sign_proc_at || null,
  };
}

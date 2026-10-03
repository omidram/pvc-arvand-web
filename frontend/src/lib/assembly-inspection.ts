export type AssemblyActivityItem = { key: string; label: string };
export type AssemblyActivitySection = { key: string; title: string; items: AssemblyActivityItem[] };

/** Mirrors backend/app/assembly_inspection_def.py */
export const ASSEMBLY_ACTIVITY_SECTIONS: AssemblyActivitySection[] = [
  {
    key: "anode",
    title: "Anode",
    items: [
      { key: "an_shell_damage", label: "Semi-Shell checked for transport damage" },
      { key: "an_shell_flushed", label: "Semi-Shell flushed with demineralized water" },
      { key: "an_inlet_pipe", label: "Inlet distribution pipe flushed / installed" },
      { key: "an_no_sharp", label: "No sharp/feathered edges or welding spatters on electrode" },
      {
        key: "an_sealing_cord",
        label: "Sealing cord aligned in a distance of 2-3 mm from the inner tangent of holes",
      },
      {
        key: "an_insert_pipe",
        label: "Insert pipe installed chambering towards the centre of the semi shell",
      },
      {
        key: "an_spacers",
        label: "17 rows of spacer strips installed (except at outermost webs; spacer type acc. to drawing)",
      },
      { key: "an_bath_fill", label: "Semi-shell filled with 1 litre of membrane bath solution" },
    ],
  },
  {
    key: "membrane",
    title: "Membrane",
    items: [
      {
        key: "mb_stored",
        label: "Membrane stored for at least 4 hours in membrane bath (4-6 g NaOH)",
      },
    ],
  },
  {
    key: "cathode",
    title: "Cathode",
    items: [
      { key: "ca_shell_damage", label: "Semi-Shell checked for transport damage" },
      { key: "ca_shell_flushed", label: "Semi-Shell flushed with demineralized water" },
      { key: "ca_inlet_pipe", label: "Inlet distribution pipe flushed / installed" },
      { key: "ca_no_sharp", label: "No sharp/feathered edges or welding spatters on electrode" },
      {
        key: "ca_sealing_cord",
        label: "Sealing cord aligned in a distance of 0.5 mm from the inner tangent of holes",
      },
      {
        key: "ca_insert_pipe",
        label: "Insert pipe installed chambering towards the centre of the semi shell",
      },
      {
        key: "ca_spacers",
        label: "17 rows of spacer strips installed (except at outermost webs; spacer type acc. to drawing)",
      },
      { key: "ca_sprayed", label: "Cathode electrode sprayed with membrane bath solution" },
    ],
  },
  {
    key: "assembly",
    title: "Assembly",
    items: [
      {
        key: "as_frame_gasket",
        label: "Frame gasket exactly aligned onto the anode by means of positioning mandrels",
      },
      { key: "as_membrane_wet", label: "Membrane wetted with 1 litre membrane bath solution" },
      { key: "as_bolts_lubed", label: "Bolts lubricated with Molykote BR2 PLUS" },
      {
        key: "as_insulators",
        label: "Insulating washer, spring washers and insulating shells properly installed",
      },
      {
        key: "as_washer_slots",
        label: "Slots of insulating washer at cathode side directed towards the outlet flange side",
      },
      {
        key: "as_pre_tighten",
        label: "Pre-tightening by means of an impact wrench as specified in annex A04",
      },
      {
        key: "as_main_tighten",
        label: "Main tightening of flange bolting by means of a torque wrench as specified in ANNEX A04",
      },
      { key: "as_inlet_hoses", label: "Inlet hoses fastening and plugged (TRI-Clamp > 2mm)" },
      {
        key: "as_outlet_hoses",
        label: "Outlet hoses fastening without blind flanges (observe inclination of level tube)",
      },
    ],
  },
  {
    key: "tests",
    title: "Tests and preparation",
    items: [
      { key: "ts_retighten", label: "Re-tightening of flange joint not until 12 hours" },
      {
        key: "ts_pressure_ready",
        label:
          "After placement of the cell element to be pressure-tested (cover of pressure test device in place) blind flange at outlet hose closed",
      },
      { key: "ts_inlet_connected", label: "Inlet hoses connected to pressure test device" },
      { key: "ts_cell_leak", label: "Leakage test of cell element successfully performed (P=300 mmwc)" },
      {
        key: "ts_membrane_leak",
        label: "Membrane leakage test successfully performed (Δp=400 mm wc)",
      },
      {
        key: "ts_blind_open",
        label: "Blind flange on outlet hoses loosened (connection to the atmosphere)",
      },
      { key: "ts_voltage_zero", label: "Cell element voltage = 0 mV" },
      { key: "ts_contact_clean", label: "Contact areas cleaned" },
    ],
  },
];

export function emptyAssemblyChecks(): Record<string, boolean> {
  const out: Record<string, boolean> = {};
  for (const section of ASSEMBLY_ACTIVITY_SECTIONS) {
    for (const item of section.items) out[item.key] = false;
  }
  return out;
}

export function emptyAssemblyCheckRemarks(): Record<string, string> {
  const out: Record<string, string> = {};
  for (const section of ASSEMBLY_ACTIVITY_SECTIONS) {
    for (const item of section.items) out[item.key] = "";
  }
  return out;
}

export const POSITION_OPTIONS = Array.from({ length: 180 }, (_, i) => String(i + 1));

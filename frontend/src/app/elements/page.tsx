"use client";

import { AccessBtn, AccessHub } from "@/components/layout/access-hub";
import { useAuth } from "@/lib/auth/context";

export default function ElementAdministrationMenu() {
  const { canView } = useAuth();
  const ok = canView("elements");
  if (!ok) return null;

  return (
    <AccessHub title="Element Administration">
      <div
        className="grid max-w-[980px] gap-x-4 gap-y-3 pt-4"
        style={{ gridTemplateColumns: "repeat(5, minmax(140px, 1fr))" }}
      >
        <AccessBtn href="/elements/assembly">Assembly Data</AccessBtn>
        <AccessBtn href="/settings?tab=groups">Group Definition</AccessBtn>
        <AccessBtn href="/anodes">Anode details</AccessBtn>
        <AccessBtn href="/cathodes">Cathode Details</AccessBtn>
        <AccessBtn href="/membranes">Membrane Details</AccessBtn>

        <AccessBtn href="/elements/assembly">Import Montagedaten</AccessBtn>
        <AccessBtn href="/settings?tab=inspection-reasons">Reasons for Inspection</AccessBtn>
        <AccessBtn href="/anodes">Anode Maintenance</AccessBtn>
        <AccessBtn href="/cathodes">Cathode Maintenance</AccessBtn>
        <AccessBtn href="/membranes">Membrane Maintenance</AccessBtn>

        <AccessBtn href="/segregation">Electrode Segregation</AccessBtn>
        <AccessBtn href="/settings?tab=cell-components">Cell components</AccessBtn>
        <AccessBtn href="/anodes">Anode Recoating</AccessBtn>
        <AccessBtn href="/cathodes">Cathode Recoating</AccessBtn>
        <span />

        <span />
        <span />
        <AccessBtn href="/anodes">Check Anode Coating</AccessBtn>
        <AccessBtn href="/cathodes">Check Cathode Coating</AccessBtn>
        <span />

        <span />
        <span />
        <span />
        <AccessBtn href="/statistics?form=dol">Membrane Statistics</AccessBtn>
        <AccessBtn href="/inspections">Element Inspection</AccessBtn>
      </div>
    </AccessHub>
  );
}

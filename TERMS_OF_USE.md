# Terms of Use

**PVC Arvand — Electrolyzer Management System**

These Terms of Use ("Terms") apply to all users of the PVC Arvand
Electrolyzer Management System (the "Software"), an internal plant
management application operated by Arvand Petrochemical Company.

## 1. Scope

The Software provides forms and reports for:

- Element (electrolyzer cell) administration and lifecycle tracking
- Anode / cathode / membrane inventory, maintenance, recoating, and coating
  checks
- Inspection reports and defect-grid recording
- Plant shutdown logging
- Standardized voltage and current-efficiency tracking
- Chemical analysis sample recording
- Plant-wide statistics and exportable reports/data analysis
- Import of legacy Access (`.mdb`/`.accdb`) or Excel (`.xlsx`) data, and
  export of any form's data to Excel or PDF
- User account and role/permission management (administrators only)

## 2. Acceptable Use

You agree to use the Software only:

- For purposes directly related to operating, maintaining, or analyzing the
  PVC Arvand plant.
- In compliance with your organization's IT security policies.
- In a manner consistent with the access level granted to your account.

## 3. Roles and Permissions

- **Admin** — full access to all forms, plus user/permission management.
- **User** — access to forms as explicitly granted by an administrator
  (per-form View or Edit).
- **Visitor** — read-only access to forms explicitly granted View access;
  cannot create, edit, or delete records.

Attempting to access a form or perform an action beyond your granted
permission level will be denied by the system and may be logged.

## 4. Data Import / Export

- Import operations (Access or Excel) can either **replace** all existing
  data for a form or **merge/append** new rows. Always verify the selected
  mode before starting an import, and prefer taking a database backup
  (`backend/instance/pvc_arvand.db`) beforehand when performing a
  destructive "replace" import.
- Export operations (Excel/PDF) reflect the data visible to you at the time
  of export, subject to any filters applied on-screen.

## 5. Availability

The Software is intended for continuous internal availability but may be
taken offline for maintenance, upgrades, or troubleshooting without prior
notice, at the discretion of plant IT staff.

## 6. Intellectual Property

All content, design, branding (including the Arvand Petrochemical Company
logo), and underlying source code are protected under the terms described
in [`LICENSE.md`](./LICENSE.md).

## 7. Changes

These Terms may be revised periodically to reflect new features or policy
changes. The version history of this document is tracked in the project's
version control system alongside the Software itself.

---

See also: [`EULA.md`](./EULA.md), [`PRIVACY_POLICY.md`](./PRIVACY_POLICY.md), and
[`SECURITY.md`](./SECURITY.md).

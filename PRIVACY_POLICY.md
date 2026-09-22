# Privacy Policy

**PVC Arvand — Electrolyzer Management System**

This Privacy Policy describes what personal and operational data the
Software collects, how it is stored, and who can access it. The Software is
an **internal, on-premises system**: it does not send any data to external
services, third-party analytics providers, or cloud AI vendors.

## 1. Data Collected

### 1.1 User Account Data

| Field | Purpose |
|---|---|
| Username | Login identifier |
| Full name (optional) | Display name in the UI and audit trail |
| Password (stored as a salted bcrypt hash — never in plain text) | Authentication |
| Role (Admin / User / Visitor) | Access control |
| Per-form permissions | Fine-grained access control |
| Account active/inactive flag | Access revocation without deletion |
| Created-at timestamp | Auditing |

### 1.2 Plant Operational Data

Element records, anode/cathode/membrane details, inspection reports,
voltage readings, current-efficiency entries, chemical analysis samples,
shutdown logs, remarks, and plant configuration/settings. This data
describes **plant equipment and processes**, not individuals, with the
exception of free-text "author"/"inspector" fields that plant staff may
use to attribute entries to themselves for traceability.

## 2. Where Data Is Stored

All data is stored locally in a single SQLite database file
(`backend/instance/pvc_arvand.db`) on infrastructure controlled by Arvand
Petrochemical Company. No data is transmitted to external cloud services by
default. The Reports & Data Analysis module performs all statistical
computation **in-process** on the backend server — it does not call any
external AI or analytics API.

## 3. Data Access

Access to data is restricted by the role-based access control (RBAC)
system:

- Only authenticated users with a valid session token (JWT) can query the
  API.
- Each request is checked against the requesting user's per-form permission
  level before data is returned or modified.
- Administrators can view and manage user accounts and permissions but do
  not have direct access to plaintext passwords (only bcrypt hashes are
  stored, which are not reversible).

## 4. Data Retention

Operational and user-account data is retained for as long as it is needed
for plant operation and record-keeping, consistent with the Company's
internal data retention and engineering record-keeping policies. Historical
records (e.g., decommissioned elements, closed shutdowns) are retained
rather than deleted, to preserve the plant's engineering history and
support trend analysis.

## 5. Data Export

Users with appropriate permissions can export form data to Excel or PDF.
Exported files are downloaded directly to the user's own device/browser and
are not stored or transmitted elsewhere by the Software. Once exported,
safeguarding that file is the responsibility of the user and their
organization's data-handling policies.

## 6. No Third-Party Sharing

The Company does not sell, rent, or share plant or user data with any
third party. The Software has no built-in telemetry, crash reporting, or
usage-analytics transmission to external parties.

## 7. Security Measures

See [`SECURITY.md`](./SECURITY.md) for a description of the technical
safeguards (password hashing, JWT-based sessions, RBAC, etc.) applied to
protect this data.

## 8. Changes to This Policy

This policy may be updated as the Software evolves. The current version is
tracked alongside the Software's source code.

## 9. Contact

For questions about this policy or to request account or data recovery,
contact your plant's IT / systems administrator.

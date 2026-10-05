# Plant Excel catalogues

Bundled workshop workbooks used to seed / refresh plant master data:

| File | Target |
|------|--------|
| `ANODE-SERIAL-NUMBERS.xlsx` | Anode details (`anodes`) |
| `CATHODE-SERIAL-NUMBERS.xlsx` | Cathode details (`cathodes`) |
| `montage-install-dismantle-import-ready.xlsx` | Assembly data (`elements`) |
| `TAFKIK.xlsx` | Electrode segregation |
| `shutdowns.xlsx` | Shut Down List |
| `shutdown-causes.xlsx` / `shutdown-categories.xlsx` | Lookup lists |
| `pvc_arvand_plant_seed.db` | Full plant snapshot without voltage readings (~7 MB) |

Digit-only anode/cathode serials are normalized to `A…` / `C…` on import so
assembly, segregation, and electrode detail tables stay linked.

### Why the server Shut Down List looked incomplete

Live SQLite (`pvc_arvand.db`) is **not** in Git (too large; includes ~1.5M
voltage rows). A fresh server only gets an empty/bundled seed, so historical
shutdowns from the laptop Access import are missing until you restore them.

### Restore plant data on the Debian server (after `git pull`)

```bash
cd pvc-arvand-web
bash deploy/update.sh              # code only — keeps volume
bash deploy/restore-plant-seed.sh  # merge laptop plant seed (shutdowns, elements, …)
```

That replaces master/plant tables from `pvc_arvand_plant_seed.db` but **keeps**
users, roles, and any `voltage_readings` already on the server.

### Rebuild the seed from the laptop DB

```bash
cd backend
py -3 scripts/export_plant_seed.py
```

### Full laptop DB (including voltages)

Copy `backend/instance/pvc_arvand.db` with `scp` / USB — see `docs/DEPLOY.md`.
Do not commit the full ~780 MB file to GitHub.

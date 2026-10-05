# Plant Excel catalogues

Bundled workshop workbooks used to seed / refresh plant master data:

| File | Target |
|------|--------|
| `ANODE-SERIAL-NUMBERS.xlsx` | Anode details (`anodes`) |
| `CATHODE-SERIAL-NUMBERS.xlsx` | Cathode details (`cathodes`) |
| `montage-install-dismantle-import-ready.xlsx` | Assembly data (`elements`) |
| `TAFKIK.xlsx` | Electrode segregation |

Digit-only anode/cathode serials are normalized to `A…` / `C…` on import so
assembly, segregation, and electrode detail tables stay linked.

Load into a running local DB:

```bash
cd backend
.venv/Scripts/python scripts/seed_plant_excels.py
```

Live plant databases are **not** committed (see `.gitignore`). Updates must keep
the Docker volume / `%LOCALAPPDATA%\PVCArvand` — use `deploy/update.sh`.

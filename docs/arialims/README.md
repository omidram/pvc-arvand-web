# AriaLIMS sync – setup

The app pulls lab results from AriaLIMS and stores them as Analysis samples.

## API used

```
GET http://192.168.20.12:8090/api/AriaLIMS/results
    ?SCIDs=938&SCIDs=962&SCIDs=1034      (repeat SCIDs for several sample points)
    &StartTime=2026-09-01&EndTime=2026-10-08
```

Response: `{"results":[{"analysisname","unitofmeaserment","scid","scno","value","samplingTime"}]}`

Each SCID is one sample point = one electrolyzer + one sample type
(`SCNo` such as `01-Brine- elec. A1`).

## Files in this folder

| File | Purpose |
| --- | --- |
| `ElecSamplePoint.xlsx` | List of all 120 sample points (24 electrolyzers x 5 types) with SCID / SCNo / UnitTag. Import it once in the UI. |
| `results-all-test.json` | Sample response of the API for all test points (used for offline tests). |
| `results-sample-scid242.json` | Sample response for a single SCID. |

## Setup (after `bash deploy/update.sh`)

No `.env` change is needed; everything is stored in the database.

1. Log in as admin, open **Settings -> AriaLims Sync**.
2. Set **Server URL** to `http://192.168.20.12:8090` and save.
   The VM / Docker host must be able to reach that address (same network).
3. In **Sampling points** use **Import sample points (Excel)** and choose `ElecSamplePoint.xlsx`.
   Re-importing is safe (no duplicates, manual mappings are kept).
4. Click **Test connection**, then **Pull from AriaLims now**.
5. Optionally enable the schedule (interval / days back).

Requests are sent in batches of 30 SCIDs. Parameter names are mapped to the
Analysis form keys by default; unmapped names are stored under the AriaLIMS name
and can be mapped per point (edit point -> parameter mapping).

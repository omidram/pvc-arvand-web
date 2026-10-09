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

## Setup (after update)

Nothing to configure: on first start after an update the app fills in the Server URL
(`http://192.168.20.12:8090`), schedule defaults, all analysis types and loads the bundled
sample-point list (`backend/app/data/ElecSamplePoint.xlsx`, 120 points) once.

1. Restart the backend (Docker: `bash deploy/update.sh`).
2. Settings -> AriaLims Sync -> **Test connection**.
3. Enable the daily sync when the test is OK.

The VM must reach `192.168.20.12:8090`. Parameter names are mapped to Analysis form keys by default;
unmapped names are stored under the AriaLIMS name and can be mapped per point.


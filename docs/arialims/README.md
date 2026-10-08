# AriaLIMS sync

Pulls lab results from the AriaLIMS API into Analysis data.

## Endpoint

```
GET http://192.168.20.12:8090/api/AriaLIMS/results?SCIDs=938&SCIDs=962&StartTime=2026-09-01&EndTime=2026-10-08
```

- `SCIDs` can be repeated (the app sends up to 30 per request).
- Response: `{"results":[{"analysisname","unitofmeaserment","scid","scno","value","samplingTime"}]}`.

## Setup (after `bash deploy/update.sh`)

1. Settings -> AriaLims Sync: enter base URL `http://192.168.20.12:8090`, enable, save.
2. In "Sampling points" use **Import sample points (Excel)** with `ElecSamplePoint.xlsx`
   (120 points = 24 electrolyzers x 5 sample types; electrolyzer comes from `SCNo`, e.g. `01-Brine- elec. A1`).
3. **Test connection**, then **Pull from AriaLims now** (or enable the schedule).

No `.env` change is needed; settings and points are stored in the database.

## Files

- `ElecSamplePoint.xlsx` - SCID / SCNo / UnitTag list of all sample points.
- `results-all-test.json` - sample API response for all test points.
- `results-sample-scid242.json` - sample response for a single SCID.

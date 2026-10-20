"""Read-only look at the Un / CE related data in the local DB."""
from collections import Counter

from sqlalchemy import func

from app import models
from app.database import SessionLocal

db = SessionLocal()
M = models
print("DB", db.bind.url)
for name in (
    "ElectrolyzerNormalization",
    "VoltageReading",
    "VoltageUnElementInput",
    "VoltageUnGroupInput",
    "CurrentEfficiencyEntry",
    "AnalysisSample",
    "CorrectionFactor",
    "ElectrodeArea",
    "PlantSettings",
    "GroupDefinition",
    "Element",
    "ElectrolyzerArrangement",
    "SubPlant",
):
    print(name, db.query(func.count()).select_from(getattr(M, name)).scalar())

print("settings", [(s.plant_type, s.acidified, s.reference_current_density, s.zero_voltage) for s in db.query(M.PlantSettings).all()])
print("corr", [(c.reference_current_density, c.temp_correction, c.conc_correction) for c in db.query(M.CorrectionFactor).all()])
print("areas", [a.area_m2 for a in db.query(M.ElectrodeArea).all()])
print("arrangements", [(a.name, a.sub_plant) for a in db.query(M.ElectrolyzerArrangement).limit(30).all()])
print("sub_plants", [(s.nr, s.name) for s in db.query(M.SubPlant).all()])

n = db.query(M.ElectrolyzerNormalization).order_by(M.ElectrolyzerNormalization.date.desc()).limit(4).all()
for r in n:
    print("norm", r.normalization_nr, r.electrolyzer, r.date, r.time, "I", r.total_current, "Cc", r.reference_current_density, r.catholyte_conc,
          "tAn", r.anolyte_temp, "tKa", r.catholyte_temp, "U0", r.zero_voltage, "UG", r.total_voltage, "n", r.element_count)
print("norm with Cc", db.query(func.count()).filter(M.ElectrolyzerNormalization.reference_current_density.isnot(None)).scalar(),
      "with catholyte_conc", db.query(func.count()).filter(M.ElectrolyzerNormalization.catholyte_conc.isnot(None)).scalar())
print("readings with Un", db.query(func.count()).filter(M.VoltageReading.standardized_voltage.isnot(None)).scalar(),
      "with U", db.query(func.count()).filter(M.VoltageReading.voltage.isnot(None)).scalar())
rr = db.query(M.VoltageReading).filter(M.VoltageReading.standardized_voltage.isnot(None)).limit(5).all()
for r in rr:
    print("reading", r.electrolyzer, r.position, r.date, r.voltage, r.voltage_prev, r.standardized_voltage, r.normalization_nr)

ce = db.query(M.CurrentEfficiencyEntry.scope, func.count()).group_by(M.CurrentEfficiencyEntry.scope).all()
print("CE entries", ce)
print("analysis types", db.query(M.AnalysisSample.analysis_type, M.AnalysisSample.scope, func.count()).group_by(M.AnalysisSample.analysis_type, M.AnalysisSample.scope).all())
a = db.query(M.AnalysisSample).filter(M.AnalysisSample.analysis_type == "pure_brine").limit(2).all()
for r in a:
    print("pb", r.scope, r.electrolyzer, r.date, r.parameters)
a = db.query(M.AnalysisSample).filter(M.AnalysisSample.analysis_type == "anolyte").limit(2).all()
for r in a:
    print("an", r.scope, r.electrolyzer, r.date, r.parameters)
a = db.query(M.AnalysisSample).filter(M.AnalysisSample.analysis_type == "chlorine_gas").limit(2).all()
for r in a:
    print("cl", r.scope, r.electrolyzer, r.date, r.parameters)
db.close()

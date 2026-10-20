@echo off
cd /d C:\Users\Omid\Downloads\pvc_arvand_web\backend
.\.venv\Scripts\python.exe -c "from app.database import SessionLocal; from app.models import Element, ElectrolyzerNormalization, VoltageReading; from app.energy import plant_timeseries; db=SessionLocal(); print('elements',db.query(Element).count()); print('norms',db.query(ElectrolyzerNormalization).count()); print('readings',db.query(VoltageReading).count()); d=plant_timeseries(db,scope='plant'); print('trends',d['total'],len(d['points'])); db.close()" > instance\_check_out.txt 2>&1

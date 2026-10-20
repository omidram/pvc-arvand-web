import sqlite3

con = sqlite3.connect(r"C:\Users\Omid\Downloads\pvc_arvand_web\backend\instance\pvc_arvand.db")
print("anode", con.execute("select anode_nr from anodes where replace(upper(anode_nr),' ','')='UA29612'").fetchall())
print("element", con.execute("select id, element_nr, anode_nr from elements where replace(upper(anode_nr),' ','')='UA29612'").fetchall())
print("anode count", con.execute("select count(*) from anodes").fetchone())

#!/usr/bin/env python3
"""Fail before tile generation if the country driving-side admin is missing."""
import json
import sqlite3
import sys
from pathlib import Path

path = Path(sys.argv[1])
with sqlite3.connect(f'file:{path}?mode=ro', uri=True) as db:
    rows = db.execute("SELECT iso_code, name, drive_on_right FROM admins WHERE admin_level=2 AND iso_code='IT'").fetchall()
if not rows or any(row[2] != 1 for row in rows):
    raise SystemExit(f'Incomplete/incorrect Italian country admin: {rows}. Refusing wrong roundabout exit numbers.')
report = {'country':'IT','driveOnRight':True,'source':'geofabrik/europe/italy-latest.osm.pbf','admins':rows}
Path('build/road-admin-audit.json').write_text(json.dumps(report,indent=2)+'\n')
print('Verified Italian driving-side admin:', rows)

import sqlite3
import os
from dotenv import load_dotenv
load_dotenv()

DATABASE_FILE = os.getenv("DATABASE_FILE")

con = sqlite3.connect(DATABASE_FILE)
cur = con.cursor()

cur.execute("SELECT * FROM pomiary")
rows = cur.fetchall()

for r in rows:
    print(r)

con.close()

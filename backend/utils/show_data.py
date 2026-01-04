import sqlite3
import os
from dotenv import load_dotenv
load_dotenv()

DATABASE_FILE = os.getenv("DATABASE_FILE")

con = sqlite3.connect("instance/" + DATABASE_FILE)
cur = con.cursor()

cur.execute("SELECT * FROM subscribers")
rows = cur.fetchall()

for r in rows:
    print(r)

con.close()

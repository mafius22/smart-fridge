import sqlite3

# Upewnij się, że nazwa pliku bazy jest poprawna (często to 'database.db', 'site.db' lub 'app.db')
baza = 'instance/smartfridge.db' 

try:
    conn = sqlite3.connect(baza)
    cursor = conn.cursor()
    
    # Zakładam, że tabela nazywa się 'push_subscriber' (standard w SQLAlchemy)
    # Jeśli masz inną nazwę tabeli, zmień ją poniżej
    cursor.execute("SELECT id, endpoint FROM subscribers")
    
    rows = cursor.fetchall()
    
    if not rows:
        print("Tabela jest pusta!")
    else:
        print(f"Znaleziono {len(rows)} wpisów:")
        for row in rows:
            print(f"ID: {row[0]}")
            print(f"Endpoint: {row[1]}")
            print("-" * 20)

    conn.close()
except Exception as e:
    print(f"Wystąpił błąd: {e}")
    print("Upewnij się, że plik bazy danych istnieje w tym folderze.")
import base64
import os
from cryptography.hazmat.primitives import serialization
from cryptography.hazmat.primitives.asymmetric import ec

def save_key_to_base64(data):
    """Pomocnicza funkcja do kodowania w URL-Safe Base64 (wymagane przez VAPID)"""
    return base64.urlsafe_b64encode(data).rstrip(b'=').decode('utf-8')

print("--- GENEROWANIE KLUCZY VAPID ---")

# 1. Generuj klucz prywatny (Elliptic Curve P-256)
private_key = ec.generate_private_key(ec.SECP256R1())

# 2. Wyciągnij liczby dla klucza prywatnego
private_val = private_key.private_numbers().private_value
private_bytes = private_val.to_bytes(32, byteorder='big')

# 3. Wyciągnij bajty dla klucza publicznego (format nieskompresowany)
public_bytes = private_key.public_key().public_bytes(
    serialization.Encoding.X962,
    serialization.PublicFormat.UncompressedPoint
)

# 4. Wyświetl wyniki gotowe do wklejenia do .env
print("\nSkopiuj poniższe linie do pliku .env:\n")
print(f"VAPID_PRIVATE_KEY={save_key_to_base64(private_bytes)}")
print(f"VAPID_PUBLIC_KEY={save_key_to_base64(public_bytes)}")
print("\n----------------------------------")
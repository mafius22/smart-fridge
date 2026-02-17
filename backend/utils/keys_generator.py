import base64
import os
from cryptography.hazmat.primitives import serialization
from cryptography.hazmat.primitives.asymmetric import ec

def save_key_to_base64(data):
    """Pomocnicza funkcja do kodowania w URL-Safe Base64"""
    return base64.urlsafe_b64encode(data).rstrip(b'=').decode('utf-8')


private_key = ec.generate_private_key(ec.SECP256R1())

private_val = private_key.private_numbers().private_value
private_bytes = private_val.to_bytes(32, byteorder='big')

public_bytes = private_key.public_key().public_bytes(
    serialization.Encoding.X962,
    serialization.PublicFormat.UncompressedPoint
)

print("\nSkopiuj poniższe linie do pliku .env:\n")
print(f"VAPID_PRIVATE_KEY={save_key_to_base64(private_bytes)}")
print(f"VAPID_PUBLIC_KEY={save_key_to_base64(public_bytes)}")
print("\n----------------------------------")
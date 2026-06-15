import os

TQ_AUTH_USER = os.getenv("TQ_AUTH_USER", "")
TQ_AUTH_PASSWORD = os.getenv("TQ_AUTH_PASSWORD", "")

HOST = os.getenv("HOST", "0.0.0.0")
PORT = int(os.getenv("PORT", "8000"))

UPDATE_LOOP_DEADLINE = float(os.getenv("UPDATE_LOOP_DEADLINE", "30"))

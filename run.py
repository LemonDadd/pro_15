import logging

from app.config import HOST, PORT
from app.main import app

if __name__ == "__main__":
    logging.basicConfig(
        level=logging.INFO,
        format="%(asctime)s [%(levelname)s] %(name)s: %(message)s",
    )
    import uvicorn

    uvicorn.run(app, host=HOST, port=PORT)

from fastapi import FastAPI

app = FastAPI(title="Flightdeck")


@app.get("/healthz")
def healthz():
    return {"status": "ok"}

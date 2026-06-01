FROM python:3.13-slim

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    FLIGHTDECK_RUNTIME=docker \
    FLIGHTDECK_SERVICE_MANAGER="Docker / Portainer" \
    FLIGHTDECK_DATA_DIR=/data \
    FLIGHTDECK_PRINT_LIBRARY=/print_library

RUN apt-get update \
    && apt-get install -y --no-install-recommends ffmpeg libusb-1.0-0 \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY requirements.txt ./
RUN python -m pip install --no-cache-dir --upgrade pip \
    && python -m pip install --no-cache-dir -r requirements.txt

COPY app ./app
COPY scripts ./scripts
COPY printers.yaml.example ./
COPY README.md ./

EXPOSE 8000

CMD ["sh", "-c", "mkdir -p /data/uploads /print_library /backups && cp -n /app/printers.yaml.example /data/printers.yaml && python -c 'from app import db; db.init()' && uvicorn app.main:app --host 0.0.0.0 --port 8000"]

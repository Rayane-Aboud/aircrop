FROM python:3.12-slim
WORKDIR /app

# opencv (an ultralytics dependency) needs libGL/libglib at runtime on slim images
RUN apt-get update \
    && apt-get install -y --no-install-recommends libgl1 libglib2.0-0 \
    && rm -rf /var/lib/apt/lists/*

COPY requirements.txt .
# Install the CPU-only torch wheel first (the default PyPI wheel pulls in
# CUDA and is ~10x larger) - this VPS has no GPU.
RUN pip install --no-cache-dir torch --index-url https://download.pytorch.org/whl/cpu \
    && pip install --no-cache-dir -r requirements.txt
COPY . .
# Apply DB migrations on startup (idempotent), then serve with Gunicorn.
# Safe with a single replica; the schema is created/updated against Postgres
# before the app starts accepting traffic.
# Threaded workers: orthomosaic map tiles arrive ~20 at a time and asset
# downloads stream for minutes; a single sync worker would serialise the tiles
# and kill long downloads at --timeout.
CMD ["sh", "-c", "python manage.py migrate --noinput && gunicorn config.wsgi:application --bind 0.0.0.0:8000 --timeout 120 --threads 8"]
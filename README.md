# Aircrop: crop health from a single photo

**Upload a field photo, get a crop-health verdict, an annotated image and an agronomic report as a PDF.**
Built for [AirCrop](https://aircrop.io), an agri-tech startup using drones and AI.

📄 [Sample report (PDF)](aircrop-report-sample.pdf)

## How it works

```
photo ──► EXIF (date, GPS) ──► YOLO crop-health model ──► weather at that place and time
                                    │ verdict + boxes            │
                                    └──────────► LLM report ◄────┘ ──► PDF
```

1. **Upload**: the React frontend sends the photo; the Django API answers at once and runs the analysis in the
   background, so the page polls for the result.
2. **Context**: capture date and GPS position are read from the photo's EXIF data, and the weather for that place
   and day comes from [Open-Meteo](https://open-meteo.com).
3. **Detection**: a custom-trained [Ultralytics YOLO](https://docs.ultralytics.com) model (classes *healthy* and
   *stressed*) produces the verdict and an annotated copy of the image.
4. **Report**: Google Gemini turns those facts into a readable agronomic report.
5. **PDF**: everything is assembled into a branded PDF with ReportLab.

## Design choices

- **The model decides, the LLM explains.** The health verdict always comes from the vision model. The LLM only
  gets the structured facts (detections, confidence, weather, place, date), is told to use nothing else, runs at
  low temperature and must answer in a strict JSON shape.
- **The LLM is optional.** With no API key, a network error or an unreadable answer, the app falls back to a
  template report. The product still works.
- **The model loads once.** PyTorch is slow to import, so the YOLO model is loaded lazily, behind a lock, and
  cached in the worker process.

## Stack

| Layer | Tools |
|---|---|
| Backend | Python, Django, PostgreSQL, Gunicorn |
| ML | Ultralytics YOLO (PyTorch), custom-trained weights |
| LLM | Google Gemini (REST, no SDK) |
| Frontend | React, TypeScript, Vite, served by Nginx |
| Infra | Docker images on GitHub Container Registry, Kubernetes manifests (backend, frontend, PostgreSQL with persistent volumes) on OVH |

## Run it

Backend:

```bash
cd backend
pip install -r requirements.txt
export DJANGO_DEBUG=1 GEMINI_API_KEY=...   # the key is optional: without it the template report is used
python manage.py migrate
python manage.py runserver
```

Frontend:

```bash
cd frontend
npm install
npm run dev
```

Locally it runs on SQLite with no setup. Set `POSTGRES_DB` (plus `POSTGRES_USER`, `POSTGRES_PASSWORD`,
`POSTGRES_HOST`, `POSTGRES_PORT`) to use PostgreSQL, as in production.

Kubernetes: build and push the images with `./build-and-push.sh`, create the Gemini key as a Secret
(see the comment in [`k8s/backend-deployment.yaml`](k8s/backend-deployment.yaml)), then `kubectl apply -f k8s/`.

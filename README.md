# Aircrop: crop health from a single photo

You upload a photo of a field, and Aircrop tells you whether the crop looks healthy or stressed. It
also gives you an annotated image and a short agronomy report you can download as a PDF. I built it for
[AirCrop](https://aircrop.io), an agri-tech startup that uses drones and AI.

You can see what a report looks like here: [sample report (PDF)](aircrop-report-sample.pdf).

## How it works

```
photo ──► EXIF (date, GPS) ──► YOLO crop-health model ──► weather at that place and time
                                    │ verdict + boxes            │
                                    └──────────► LLM report ◄────┘ ──► PDF
```

1. The React frontend sends the photo. The Django API answers right away and runs the analysis in the
   background, and the page checks back every few seconds until the result is ready.
2. The capture date and the GPS position are read from the photo's EXIF data. The weather for that place
   and day comes from [Open-Meteo](https://open-meteo.com).
3. A custom-trained [Ultralytics YOLO](https://docs.ultralytics.com) model decides between *healthy* and
   *stressed*, and draws boxes on a copy of the image.
4. Google Gemini turns these facts into a readable agronomy report.
5. ReportLab puts everything together in a PDF with the AirCrop branding.

## Some choices I made

- The health verdict always comes from the vision model, never from the LLM. The LLM only receives the
  facts (detections, confidence, weather, place and date), is told to use nothing else, runs at a low
  temperature and has to answer in a fixed JSON format. That way it explains the result but can't make
  one up.
- The app still works without the LLM. If there is no API key, the network fails or the answer can't be
  read, it falls back to a simple template report.
- PyTorch is slow to import, so the YOLO model is loaded only once, the first time it's needed, and then
  kept in memory.

## Stack

- Backend: Python, Django, PostgreSQL, Gunicorn
- Model: Ultralytics YOLO (PyTorch), with custom-trained weights
- Report: Google Gemini, called through its REST API
- Frontend: React, TypeScript and Vite, served by Nginx
- Deployment: Docker images on GitHub Container Registry, and Kubernetes manifests for the backend, the
  frontend and PostgreSQL (with persistent volumes), running on OVH

## Running it

Backend:

```bash
cd backend
pip install -r requirements.txt
export DJANGO_DEBUG=1 GEMINI_API_KEY=...   # the key is optional, without it you get the template report
python manage.py migrate
python manage.py runserver
```

Frontend:

```bash
cd frontend
npm install
npm run dev
```

Locally it uses SQLite, so there is nothing to set up. To use PostgreSQL like in production, set
`POSTGRES_DB` (and `POSTGRES_USER`, `POSTGRES_PASSWORD`, `POSTGRES_HOST`, `POSTGRES_PORT`).

To deploy on Kubernetes, build and push the images with `./build-and-push.sh`, create the Gemini key as
a Secret (the comment in [`k8s/backend-deployment.yaml`](k8s/backend-deployment.yaml) shows how), then
run `kubectl apply -f k8s/`.

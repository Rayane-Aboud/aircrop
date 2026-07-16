"""
LLM-written crop report (Google Gemini).

Turns the *deterministic* facts we already have — YOLO's detections, the
crop-health verdict, weather, and capture location/date — into a detailed,
expert-sounding agronomic report. This module never *decides* whether a crop
is healthy: that verdict comes from the YOLO pipeline (see ml.py) and is passed
in as ground truth. The LLM only explains it and gives grounded advice.

Anti-hallucination design:
  * The model is given ONLY the structured facts below and is instructed to use
    nothing else — no invented measurements, disease names, or locations.
  * Temperature is low and the output is constrained to a strict JSON shape.
  * If GEMINI_API_KEY is unset, the network call fails, or the response can't be
    parsed, every function returns ``None`` so the caller falls back to the
    existing template report. The LLM is an enhancement, never a hard dependency.

Uses stdlib urllib only (same approach as weather.py) — no extra SDK.
"""

import json
import logging
import urllib.error
import urllib.request

from django.conf import settings

logger = logging.getLogger(__name__)

# Gemini generateContent REST endpoint. Model is configurable via settings.
_API_URL = (
    'https://generativelanguage.googleapis.com/v1beta/models/'
    '{model}:generateContent?key={key}'
)

_TIMEOUT_SECONDS = 30

_SYSTEM_INSTRUCTION = (
    "You are a senior consulting agronomist and crop-protection specialist "
    "preparing a professional advisory report for a grower, based on a single "
    "crop photograph that has already been analysed by a computer-vision model. "
    "Write with the authority, precision and calm tone of an expert field "
    "consultant. You are given the model's findings as ground truth. Follow "
    "these rules strictly:\n"
    "1. Treat the provided detections, health verdict, confidence, weather and "
    "location/date as the ONLY facts. Do not invent measurements, numbers, "
    "pest or disease names, cultivars, growth stages, or locations that are not "
    "provided.\n"
    "2. The health verdict (healthy / stressed / no_detection) is decided by "
    "the vision model. Never contradict or override it.\n"
    "3. When confidence is low (below 0.5) or only one region was detected, say "
    "so explicitly and recommend confirming with a closer ground inspection.\n"
    "4. You may reason about what the observed stress *could* indicate using "
    "established agronomic principles (water relations, nutrient deficiency, "
    "heat/drought stress, canopy vigour), but always hedge ('the pattern is "
    "consistent with…', 'this may indicate…') rather than diagnosing a specific "
    "disease or pathogen you cannot see.\n"
    "5. If weather is provided, connect it to the crop's condition with clear "
    "agronomic reasoning (e.g. high temperature and low rainfall raising "
    "evapotranspiration and water-stress risk); if weather is absent, do not "
    "speculate about it.\n"
    "6. Recommendations must read like an expert treatment and management plan: "
    "each item a concrete directive that pairs a specific action with a short "
    "rationale and, where sensible, a timeframe or monitoring trigger. Order "
    "them by priority (immediate corrective actions first, then monitoring, "
    "then preventive measures). Prefer agronomic best-practice actions "
    "(irrigation scheduling, soil-moisture checks, foliar/soil inspection, "
    "balanced fertilisation, re-scouting) over naming specific commercial "
    "products or exact chemical dosages, which you must NOT invent.\n"
    "7. Use precise, professional agronomic terminology, but keep every "
    "sentence practical and grounded. No filler, no marketing language, no "
    "hype, no emojis."
)

# We ask the model to return strict JSON in this shape.
_RESPONSE_SCHEMA_HINT = (
    "Return ONLY a JSON object (no markdown, no code fences) with exactly these "
    "keys:\n"
    '{\n'
    '  "summary": "2-4 sentence executive overview of the crop\'s condition in '
    'professional advisory language, grounded strictly in the findings",\n'
    '  "detailed_findings": "2-3 short paragraphs. Interpret the detections and '
    'confidence, describe the spatial pattern of healthy vs stressed regions in '
    'agronomic terms, and (if weather is given) relate environmental conditions '
    "to the crop's likely condition with clear reasoning. Hedge on causes you "
    'cannot verify.",\n'
    '  "severity": "one of: none, low, moderate, high",\n'
    '  "recommendations": ["4-6 prioritised, expert treatment/management '
    'directives; each states a specific action plus a brief rationale and, where '
    'sensible, a timeframe or monitoring trigger"],\n'
    '  "confidence_note": "one professional sentence on how much weight to give '
    'this assessment, given the detection confidence and count, and what would '
    'confirm it"\n'
    '}'
)


def generate_report(crop_health, detections, weather=None, location=None, captured_at=None):
    """
    Ask Gemini to write a detailed report from the structured facts.

    Returns a dict with keys summary, detailed_findings, severity,
    recommendations (list[str]), confidence_note, and source='llm'.
    Returns ``None`` on any failure (missing key, network error, bad JSON) so
    the caller can fall back to the template report.
    """
    api_key = getattr(settings, 'GEMINI_API_KEY', '') or ''
    if not api_key:
        logger.info('GEMINI_API_KEY not set; skipping LLM report.')
        return None

    facts = _build_facts(crop_health, detections, weather, location, captured_at)
    prompt = (
        f"{_RESPONSE_SCHEMA_HINT}\n\n"
        f"Here are the analysis facts as JSON:\n{json.dumps(facts, indent=2)}"
    )

    payload = {
        'systemInstruction': {'parts': [{'text': _SYSTEM_INSTRUCTION}]},
        'contents': [{'role': 'user', 'parts': [{'text': prompt}]}],
        'generationConfig': {
            # Low temperature keeps it grounded; a touch above 0 lets the prose
            # read like a human consultant rather than a template.
            'temperature': 0.3,
            'maxOutputTokens': 1536,
            'responseMimeType': 'application/json',
        },
    }

    try:
        raw = _call_gemini(payload, api_key)
    except Exception as exc:  # noqa: BLE001 - never break the pipeline
        logger.warning('Gemini request failed: %s', exc)
        return None

    report = _parse_report(raw)
    if report is None:
        logger.warning('Could not parse Gemini response into a report.')
        return None

    report['source'] = 'llm'
    # Always carry the raw detections through so the PDF/table stays faithful.
    report['detections'] = detections
    return report


def _build_facts(crop_health, detections, weather, location, captured_at):
    """Compact, explicit fact bundle handed to the model — nothing else."""
    facts = {
        'health_verdict': crop_health.get('status'),
        'verdict_confidence': crop_health.get('confidence'),
        'healthy_regions': crop_health.get('healthy_regions'),
        'stressed_regions': crop_health.get('stressed_regions'),
        'detections': [
            {'class': d.get('class_name'), 'confidence': d.get('confidence')}
            for d in (detections or [])
        ],
        'total_detections': len(detections or []),
    }
    if captured_at:
        facts['captured_at'] = captured_at
    if location:
        facts['location'] = location
    if weather:
        facts['weather'] = {
            k: v for k, v in weather.items()
            if k in (
                'date', 'temperature_c', 'temperature_min_c', 'temperature_max_c',
                'humidity_pct', 'rainfall_mm', 'wind_kmh',
            ) and v is not None
        }
    return facts


def _call_gemini(payload, api_key):
    model = getattr(settings, 'GEMINI_MODEL', 'gemini-2.5-flash')
    url = _API_URL.format(model=model, key=api_key)
    data = json.dumps(payload).encode('utf-8')
    req = urllib.request.Request(
        url, data=data, headers={'Content-Type': 'application/json'}, method='POST'
    )
    with urllib.request.urlopen(req, timeout=_TIMEOUT_SECONDS) as resp:
        body = json.loads(resp.read().decode('utf-8'))

    # Pull the text out of the first candidate.
    candidates = body.get('candidates') or []
    if not candidates:
        raise ValueError(f'no candidates in response: {body}')
    parts = candidates[0].get('content', {}).get('parts') or []
    text = ''.join(p.get('text', '') for p in parts).strip()
    if not text:
        raise ValueError('empty text in Gemini response')
    return text


def _parse_report(raw):
    """Parse the model's JSON, tolerating stray code fences, and validate keys."""
    text = raw.strip()
    if text.startswith('```'):
        # Strip a leading ```json / ``` fence and trailing ```.
        text = text.split('\n', 1)[-1]
        if text.rstrip().endswith('```'):
            text = text.rstrip()[:-3]
    try:
        obj = json.loads(text)
    except json.JSONDecodeError:
        return None
    if not isinstance(obj, dict):
        return None

    summary = obj.get('summary')
    recommendations = obj.get('recommendations')
    if not summary or not isinstance(recommendations, list) or not recommendations:
        return None

    return {
        'summary': str(summary).strip(),
        'detailed_findings': str(obj.get('detailed_findings', '')).strip(),
        'severity': str(obj.get('severity', '')).strip().lower() or 'unknown',
        'recommendations': [str(r).strip() for r in recommendations if str(r).strip()],
        'confidence_note': str(obj.get('confidence_note', '')).strip(),
    }

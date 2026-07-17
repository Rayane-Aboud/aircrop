"""
Auth + role-scoping tests for the multi-tenant API.

These lock in the core security guarantees: farmers can't manage anyone,
agronomists only see their own farmers/lands/reports, and report visibility
is scoped by ownership.
"""

import io
from unittest import mock

from django.contrib.auth import get_user_model
from django.core.files.uploadedfile import SimpleUploadedFile
from rest_framework.test import APITestCase

from accounts.models import Role
from api import ml
from api.models import AnalysisImage, ImageAnalysis, Land

User = get_user_model()


def _png_bytes(color=(0, 128, 0)):
    """A tiny valid PNG so ImageField validation passes."""
    from PIL import Image

    buf = io.BytesIO()
    Image.new('RGB', (8, 8), color).save(buf, format='PNG')
    return buf.getvalue()


def _upload(name, color=(0, 128, 0)):
    return SimpleUploadedFile(name, _png_bytes(color), content_type='image/png')


class RoleScopingTests(APITestCase):
    def setUp(self):
        self.admin = User.objects.create_user(
            'admin', password='pw', role=Role.SUPER_ADMIN
        )
        self.agro1 = User.objects.create_user('agro1', password='pw', role=Role.AGRONOMIST)
        self.agro2 = User.objects.create_user('agro2', password='pw', role=Role.AGRONOMIST)
        self.farmer1 = User.objects.create_user(
            'farmer1', password='pw', role=Role.FARMER, managed_by=self.agro1
        )
        self.farmer2 = User.objects.create_user(
            'farmer2', password='pw', role=Role.FARMER, managed_by=self.agro2
        )
        self.land1 = Land.objects.create(
            name='L1', farmer=self.farmer1, agronomist=self.agro1
        )
        self.land2 = Land.objects.create(
            name='L2', farmer=self.farmer2, agronomist=self.agro2
        )
        self.report1 = ImageAnalysis.objects.create(
            land=self.land1, created_by=self.agro1, status='done'
        )
        self.report2 = ImageAnalysis.objects.create(
            land=self.land2, created_by=self.agro2, status='done'
        )

    def login(self, username):
        res = self.client.post(
            '/api/auth/login/', {'username': username, 'password': 'pw'}
        )
        self.assertEqual(res.status_code, 200, res.content)
        token = res.data['access']
        self.client.credentials(HTTP_AUTHORIZATION=f'Bearer {token}')
        return res.data

    # --- login ------------------------------------------------------------
    def test_login_returns_role_and_user(self):
        data = self.login('agro1')
        self.assertEqual(data['user']['role'], Role.AGRONOMIST)
        self.assertIn('refresh', data)

    def test_unauthenticated_is_rejected(self):
        self.assertEqual(self.client.get('/api/reports/').status_code, 401)

    # --- user management --------------------------------------------------
    def test_agronomist_creates_farmer_owned_by_them(self):
        self.login('agro1')
        res = self.client.post('/api/users/', {
            'username': 'newfarmer', 'password': 'secret1', 'role': Role.FARMER,
        })
        self.assertEqual(res.status_code, 201, res.content)
        created = User.objects.get(username='newfarmer')
        self.assertEqual(created.role, Role.FARMER)
        self.assertEqual(created.managed_by_id, self.agro1.id)

    def test_agronomist_only_sees_own_farmers(self):
        self.login('agro1')
        res = self.client.get('/api/users/')
        usernames = {u['username'] for u in res.data['results']}
        self.assertEqual(usernames, {'farmer1'})

    def test_farmer_cannot_manage_users(self):
        self.login('farmer1')
        self.assertEqual(self.client.get('/api/users/').status_code, 403)

    def test_agronomist_cannot_create_agronomist(self):
        self.login('agro1')
        res = self.client.post('/api/users/', {
            'username': 'x', 'password': 'secret1', 'role': Role.AGRONOMIST,
        })
        self.assertEqual(res.status_code, 403)

    # --- lands ------------------------------------------------------------
    def test_agronomist_adds_land_for_own_farmer(self):
        self.login('agro1')
        res = self.client.post('/api/lands/', {'name': 'New', 'farmer': self.farmer1.id})
        self.assertEqual(res.status_code, 201, res.content)
        self.assertEqual(Land.objects.get(name='New').agronomist_id, self.agro1.id)

    def test_agronomist_cannot_add_land_for_other_farmer(self):
        self.login('agro1')
        res = self.client.post('/api/lands/', {'name': 'Nope', 'farmer': self.farmer2.id})
        self.assertEqual(res.status_code, 403)

    # --- report scoping ---------------------------------------------------
    def test_farmer_sees_only_own_reports(self):
        self.login('farmer1')
        res = self.client.get('/api/reports/')
        ids = {r['id'] for r in res.data['results']}
        self.assertEqual(ids, {str(self.report1.id)})

    def test_agronomist_sees_only_own_reports(self):
        self.login('agro2')
        res = self.client.get('/api/reports/')
        ids = {r['id'] for r in res.data['results']}
        self.assertEqual(ids, {str(self.report2.id)})

    def test_super_admin_sees_all_reports(self):
        self.login('admin')
        res = self.client.get('/api/reports/')
        self.assertEqual(res.data['count'], 2)

    def test_farmer_cannot_read_other_report_detail(self):
        self.login('farmer1')
        self.assertEqual(
            self.client.get(f'/api/analyze/{self.report2.id}/').status_code, 404
        )


class MultiImageUploadTests(APITestCase):
    """A drone survey = several images uploaded together as one report."""

    def setUp(self):
        self.agro = User.objects.create_user('agro', password='pw', role=Role.AGRONOMIST)
        self.farmer = User.objects.create_user(
            'farmer', password='pw', role=Role.FARMER, managed_by=self.agro
        )
        self.land = Land.objects.create(
            name='L', farmer=self.farmer, agronomist=self.agro
        )
        res = self.client.post('/api/auth/login/', {'username': 'agro', 'password': 'pw'})
        self.client.credentials(HTTP_AUTHORIZATION=f'Bearer {res.data["access"]}')

    def test_multi_image_upload_creates_one_report_with_child_rows(self):
        # Mock the background pipeline so the test is deterministic (no YOLO/weather).
        with mock.patch('api.pipeline.process_analysis'):
            res = self.client.post(
                '/api/analyze/',
                {'land': str(self.land.id), 'images': [_upload('a.png'), _upload('b.png'), _upload('c.png')]},
                format='multipart',
            )
        self.assertEqual(res.status_code, 202, res.content)
        self.assertEqual(res.data['image_count'], 3)
        analysis = ImageAnalysis.objects.get(id=res.data['id'])
        self.assertEqual(analysis.images.count(), 3)
        # The first child reuses the survey's stored file (no double upload).
        first = analysis.images.order_by('order').first()
        self.assertEqual(first.image.name, analysis.image.name)

    def test_single_image_still_works(self):
        with mock.patch('api.pipeline.process_analysis'):
            res = self.client.post(
                '/api/analyze/',
                {'land': str(self.land.id), 'images': [_upload('solo.png')]},
                format='multipart',
            )
        self.assertEqual(res.status_code, 202, res.content)
        self.assertEqual(res.data['image_count'], 1)

    def test_upload_requires_a_land(self):
        with mock.patch('api.pipeline.process_analysis'):
            res = self.client.post(
                '/api/analyze/', {'images': [_upload('a.png')]}, format='multipart'
            )
        self.assertEqual(res.status_code, 400)

    def test_report_list_exposes_image_count(self):
        analysis = ImageAnalysis.objects.create(
            land=self.land, created_by=self.agro, status='done'
        )
        for i in range(2):
            AnalysisImage.objects.create(
                analysis=analysis, order=i, image=_upload(f'{i}.png')
            )
        res = self.client.get('/api/reports/')
        row = next(r for r in res.data['results'] if r['id'] == str(analysis.id))
        self.assertEqual(row['image_count'], 2)


class LiveWeatherTests(APITestCase):
    """GET /api/weather/ — coordinate resolution + role scoping (network mocked)."""

    FAKE_LIVE = {
        'current': {
            'temperature_c': 22.5, 'apparent_temperature_c': 21.0, 'humidity_pct': 48.0,
            'precipitation_mm': 0.0, 'wind_kmh': 9.0, 'weather_code': 1,
            'condition': 'Mainly clear', 'time': '2026-07-17T10:00',
        },
        'forecast': [
            {'date': '2026-07-17', 'temperature_max_c': 31.0, 'temperature_min_c': 19.0,
             'precipitation_mm': 0.0, 'precipitation_prob_pct': 5, 'wind_kmh': 12.0,
             'weather_code': 1, 'condition': 'Mainly clear'},
        ],
    }

    def setUp(self):
        self.agro = User.objects.create_user('agro', password='pw', role=Role.AGRONOMIST)
        self.other = User.objects.create_user('other', password='pw', role=Role.AGRONOMIST)
        self.farmer = User.objects.create_user(
            'farmer', password='pw', role=Role.FARMER, managed_by=self.agro
        )
        self.geo_land = Land.objects.create(
            name='GeoLand', farmer=self.farmer, agronomist=self.agro,
            latitude=36.75, longitude=3.06, location_name='Algiers',
        )
        # No coordinates — only a place name, to exercise geocode + persist.
        self.named_land = Land.objects.create(
            name='NamedLand', farmer=self.farmer, agronomist=self.agro,
            location_name='Oran',
        )
        res = self.client.post('/api/auth/login/', {'username': 'agro', 'password': 'pw'})
        self.client.credentials(HTTP_AUTHORIZATION=f'Bearer {res.data["access"]}')

    def test_weather_for_land_with_coordinates(self):
        with mock.patch('api.weather.get_live', return_value=self.FAKE_LIVE) as gl:
            res = self.client.get(f'/api/weather/?land={self.geo_land.id}')
        self.assertEqual(res.status_code, 200, res.content)
        self.assertEqual(res.data['current']['temperature_c'], 22.5)
        self.assertEqual(len(res.data['forecast']), 1)
        gl.assert_called_once_with(36.75, 3.06)

    def test_geocodes_and_persists_when_land_has_no_coordinates(self):
        geo = {'latitude': 35.7, 'longitude': -0.63, 'location_name': 'Oran, Algeria'}
        with mock.patch('api.weather.geocode', return_value=geo), \
                mock.patch('api.weather.get_live', return_value=self.FAKE_LIVE):
            res = self.client.get(f'/api/weather/?land={self.named_land.id}')
        self.assertEqual(res.status_code, 200, res.content)
        self.named_land.refresh_from_db()
        self.assertEqual(self.named_land.latitude, 35.7)
        self.assertEqual(self.named_land.longitude, -0.63)

    def test_422_when_no_location_resolvable(self):
        bare = Land.objects.create(name='Bare', farmer=self.farmer, agronomist=self.agro)
        with mock.patch('api.weather.geocode', return_value=None):
            res = self.client.get(f'/api/weather/?land={bare.id}')
        self.assertEqual(res.status_code, 422)

    def test_cannot_read_weather_for_other_agronomists_land(self):
        foreign = Land.objects.create(
            name='Foreign',
            farmer=User.objects.create_user('f2', password='pw', role=Role.FARMER, managed_by=self.other),
            agronomist=self.other, latitude=1.0, longitude=1.0,
        )
        res = self.client.get(f'/api/weather/?land={foreign.id}')
        self.assertEqual(res.status_code, 404)

    def test_explicit_lat_lon(self):
        with mock.patch('api.weather.get_live', return_value=self.FAKE_LIVE) as gl:
            res = self.client.get('/api/weather/?lat=10&lon=20')
        self.assertEqual(res.status_code, 200, res.content)
        gl.assert_called_once_with(10.0, 20.0)


class AggregationTests(APITestCase):
    """Worst-status-wins aggregation across a survey's detections."""

    def test_any_stressed_makes_survey_stressed(self):
        detections = [
            {'class_name': 'healthy', 'confidence': 0.9},
            {'class_name': 'healthy', 'confidence': 0.8},
            {'class_name': 'stressed', 'confidence': 0.7},
        ]
        health = ml.summarize_health(detections)
        self.assertEqual(health['status'], 'stressed')
        self.assertEqual(health['stressed_regions'], 1)
        self.assertEqual(health['healthy_regions'], 2)

    def test_all_healthy_stays_healthy(self):
        detections = [
            {'class_name': 'healthy', 'confidence': 0.9},
            {'class_name': 'healthy', 'confidence': 0.8},
        ]
        health = ml.summarize_health(detections)
        self.assertEqual(health['status'], 'healthy')

    def test_no_detections_is_no_detection(self):
        health = ml.summarize_health([])
        self.assertEqual(health['status'], 'no_detection')

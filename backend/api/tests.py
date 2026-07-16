"""
Auth + role-scoping tests for the multi-tenant API.

These lock in the core security guarantees: farmers can't manage anyone,
agronomists only see their own farmers/lands/reports, and report visibility
is scoped by ownership.
"""

from django.contrib.auth import get_user_model
from rest_framework.test import APITestCase

from accounts.models import Role
from api.models import ImageAnalysis, Land

User = get_user_model()


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

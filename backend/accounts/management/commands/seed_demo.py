"""
Seed a demo hierarchy for local dev / jury demo.

Creates (idempotently):
  * super admin  : admin / admin12345
  * agronomist   : agro  / agro12345
  * farmer       : farmer / farmer12345  (managed by agro)
  * one Land for the farmer

Run: python manage.py seed_demo
"""

from django.contrib.auth import get_user_model
from django.core.management.base import BaseCommand

from accounts.models import Role
from api.models import Land

User = get_user_model()


class Command(BaseCommand):
    help = 'Seed a demo super admin, agronomist, farmer and a land.'

    def handle(self, *args, **options):
        admin, _ = self._ensure_user(
            'admin', 'admin12345', Role.SUPER_ADMIN,
            first_name='Site', last_name='Admin', is_staff=True, is_superuser=True,
        )
        agro, _ = self._ensure_user(
            'agro', 'agro12345', Role.AGRONOMIST,
            first_name='Amine', last_name='Belkacem',
        )
        farmer, _ = self._ensure_user(
            'farmer', 'farmer12345', Role.FARMER,
            first_name='Karim', last_name='Haddad', managed_by=agro,
        )

        land, created = Land.objects.get_or_create(
            name='North Field',
            farmer=farmer,
            agronomist=agro,
            defaults={
                'area_hectares': 4.5,
                'crop_type': 'Wheat',
                'location_name': 'Blida, Algeria',
                'latitude': 36.47,
                'longitude': 2.83,
            },
        )
        self.stdout.write(self.style.SUCCESS('Seed complete:'))
        self.stdout.write('  super admin : admin / admin12345')
        self.stdout.write('  agronomist  : agro / agro12345')
        self.stdout.write('  farmer      : farmer / farmer12345')
        self.stdout.write(f'  land        : {land.name} ({"created" if created else "exists"})')

    def _ensure_user(self, username, password, role, managed_by=None, **fields):
        user, created = User.objects.get_or_create(
            username=username, defaults={'role': role, 'managed_by': managed_by, **fields}
        )
        if created:
            user.set_password(password)
            user.save()
        return user, created

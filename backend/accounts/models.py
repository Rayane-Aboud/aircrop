"""
User model + role hierarchy for Aircrop.

Three roles, top-down provisioning:

  * SUPER_ADMIN  - platform owner. Sees every user, land and report.
  * AGRONOMIST   - owns the working surface. Creates and manages their own
                   farmers and their lands, uploads crop images and generates
                   reports for a farmer's land.
  * FARMER       - passive recipient. Sees only the reports produced for their
                   own lands (id, generation date, downloadable PDF).

A farmer is always attached to the agronomist that created them via
``managed_by`` so ownership/scoping is a single hop. We use a custom user
model (set as AUTH_USER_MODEL) so the role lives on the user itself rather than
in a side table.
"""

from django.contrib.auth.models import AbstractUser, UserManager
from django.db import models


class Role(models.TextChoices):
    SUPER_ADMIN = 'super_admin', 'Super Admin'
    AGRONOMIST = 'agronomist', 'Agronomist'
    FARMER = 'farmer', 'Farmer'


class AircropUserManager(UserManager):
    """Ensures anyone created via createsuperuser is a SUPER_ADMIN."""

    def create_superuser(self, username, email=None, password=None, **extra_fields):
        extra_fields.setdefault('role', Role.SUPER_ADMIN)
        return super().create_superuser(username, email, password, **extra_fields)


class User(AbstractUser):
    role = models.CharField(
        max_length=20, choices=Role.choices, default=Role.FARMER
    )
    phone = models.CharField(max_length=32, blank=True)

    # For farmers: the agronomist who owns/created this account. Null for
    # agronomists and super admins.
    managed_by = models.ForeignKey(
        'self',
        null=True,
        blank=True,
        on_delete=models.SET_NULL,
        related_name='farmers',
        limit_choices_to={'role': Role.AGRONOMIST},
    )

    objects = AircropUserManager()

    class Meta:
        ordering = ['-date_joined']

    # --- convenience role flags -------------------------------------------
    @property
    def is_super_admin(self):
        return self.role == Role.SUPER_ADMIN

    @property
    def is_agronomist(self):
        return self.role == Role.AGRONOMIST

    @property
    def is_farmer(self):
        return self.role == Role.FARMER

    @property
    def display_name(self):
        full = self.get_full_name()
        return full or self.username

    def __str__(self):
        return f'{self.display_name} ({self.role})'

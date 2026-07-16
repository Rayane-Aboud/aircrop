"""Test settings: same as prod/dev but with a fast password hasher.

Run: python manage.py test --settings=config.settings_test
"""

from .settings import *  # noqa: F401,F403

# PBKDF2 (the default) is deliberately slow; MD5 keeps the test suite fast.
PASSWORD_HASHERS = ['django.contrib.auth.hashers.MD5PasswordHasher']

from django.contrib import admin
from django.contrib.auth.admin import UserAdmin

from .models import User

UserAdmin.fieldsets = UserAdmin.fieldsets + (
    ('Aircrop', {'fields': ('role', 'phone', 'managed_by')}),
)
UserAdmin.list_display = ('username', 'email', 'role', 'managed_by', 'is_active')
UserAdmin.list_filter = ('role', 'is_active')

admin.site.register(User, UserAdmin)

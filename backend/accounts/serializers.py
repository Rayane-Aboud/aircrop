from django.contrib.auth import get_user_model
from rest_framework import serializers
from rest_framework_simplejwt.serializers import TokenObtainPairSerializer

from .models import Role

User = get_user_model()


class UserSerializer(serializers.ModelSerializer):
    display_name = serializers.CharField(read_only=True)

    class Meta:
        model = User
        fields = (
            'id', 'username', 'email', 'first_name', 'last_name',
            'display_name', 'role', 'phone', 'managed_by', 'is_active',
            'date_joined',
        )
        read_only_fields = ('id', 'date_joined', 'display_name')


class UserCreateSerializer(serializers.ModelSerializer):
    """
    Create a user. Role is constrained by the caller's role in the view:
    a super admin may create agronomists; an agronomist may create farmers.
    """

    password = serializers.CharField(write_only=True, min_length=6)

    class Meta:
        model = User
        fields = (
            'id', 'username', 'email', 'first_name', 'last_name',
            'password', 'role', 'phone',
        )
        read_only_fields = ('id',)

    def create(self, validated_data):
        password = validated_data.pop('password')
        managed_by = validated_data.pop('managed_by', None)
        user = User(**validated_data)
        user.set_password(password)
        if managed_by is not None:
            user.managed_by = managed_by
        user.save()
        return user


class RoleTokenObtainPairSerializer(TokenObtainPairSerializer):
    """Login response includes the user's profile alongside the tokens."""

    def validate(self, attrs):
        data = super().validate(attrs)
        data['user'] = UserSerializer(self.user).data
        return data

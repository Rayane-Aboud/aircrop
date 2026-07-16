from django.contrib.auth import get_user_model
from rest_framework import status, viewsets
from rest_framework.decorators import api_view, permission_classes
from rest_framework.exceptions import PermissionDenied, ValidationError
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response
from rest_framework_simplejwt.views import TokenObtainPairView

from .models import Role
from .permissions import IsAgronomistOrSuperAdmin
from .serializers import (
    RoleTokenObtainPairSerializer,
    UserCreateSerializer,
    UserSerializer,
)

User = get_user_model()


class LoginView(TokenObtainPairView):
    serializer_class = RoleTokenObtainPairSerializer


@api_view(['GET'])
@permission_classes([IsAuthenticated])
def me(request):
    return Response(UserSerializer(request.user).data)


class UserViewSet(viewsets.ModelViewSet):
    """
    Role-scoped user management (top-down provisioning):

      * super admin  -> sees all users; creates agronomists.
      * agronomist   -> sees only their own farmers; creates farmers.
      * farmer       -> no access.
    """

    permission_classes = [IsAgronomistOrSuperAdmin]

    def get_serializer_class(self):
        if self.action == 'create':
            return UserCreateSerializer
        return UserSerializer

    def get_queryset(self):
        user = self.request.user
        if user.is_super_admin:
            qs = User.objects.all()
            role = self.request.query_params.get('role')
            if role:
                qs = qs.filter(role=role)
            return qs
        if user.is_agronomist:
            return User.objects.filter(role=Role.FARMER, managed_by=user)
        return User.objects.none()

    def perform_create(self, serializer):
        actor = self.request.user
        target_role = serializer.validated_data.get('role')

        if actor.is_super_admin:
            # Super admin provisions agronomists (default) or other admins.
            if target_role == Role.FARMER:
                raise ValidationError(
                    'Super admin creates agronomists; farmers are created by their agronomist.'
                )
            serializer.save()
        elif actor.is_agronomist:
            # Agronomist may only create farmers, always owned by them.
            if target_role and target_role != Role.FARMER:
                raise PermissionDenied('Agronomists may only create farmer accounts.')
            serializer.save(role=Role.FARMER, managed_by=actor)
        else:
            raise PermissionDenied('Not allowed to create users.')

    def perform_update(self, serializer):
        actor = self.request.user
        if actor.is_agronomist and serializer.instance.managed_by_id != actor.id:
            raise PermissionDenied('You can only edit your own farmers.')
        serializer.save()

    def perform_destroy(self, instance):
        actor = self.request.user
        if actor.is_agronomist and instance.managed_by_id != actor.id:
            raise PermissionDenied('You can only remove your own farmers.')
        # Soft-deactivate rather than hard delete to preserve report history.
        instance.is_active = False
        instance.save(update_fields=['is_active'])
        return Response(status=status.HTTP_204_NO_CONTENT)

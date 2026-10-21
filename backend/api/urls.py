from django.urls import include, path
from rest_framework.routers import DefaultRouter

from accounts.views import UserViewSet

from . import views

router = DefaultRouter()
router.register('users', UserViewSet, basename='user')
router.register('lands', views.LandViewSet, basename='land')
router.register('reports', views.ReportViewSet, basename='report')

urlpatterns = [
    path('', include(router.urls)),
    path('analyze/', views.analyze_image, name='analyze-image'),
    path('analyze/<uuid:analysis_id>/', views.analysis_status, name='analysis-status'),
    path(
        'analyze/<uuid:analysis_id>/report.pdf',
        views.analysis_report_pdf,
        name='analysis-report-pdf',
    ),
    path('orthomosaics/', views.orthomosaics, name='orthomosaics'),
    path('orthomosaics/<uuid:task_id>/', views.orthomosaic_detail, name='orthomosaic-detail'),
    path(
        'orthomosaics/<uuid:task_id>/images/',
        views.orthomosaic_images,
        name='orthomosaic-images',
    ),
    path(
        'orthomosaics/<uuid:task_id>/commit/',
        views.orthomosaic_commit,
        name='orthomosaic-commit',
    ),
    path(
        'orthomosaics/<uuid:task_id>/tiles/<int:z>/<int:x>/<int:y>.png',
        views.orthomosaic_tile,
        name='orthomosaic-tile',
    ),
    path(
        'orthomosaics/<uuid:task_id>/download/<str:asset>',
        views.orthomosaic_download,
        name='orthomosaic-download',
    ),
    path('weather/', views.weather_now, name='weather-now'),
    path('samples/', views.list_samples, name='list-samples'),
    path('samples/<str:sample_id>/image/', views.sample_image, name='sample-image'),
]

from django.urls import path

from . import views

urlpatterns = [
    path('analyze/', views.analyze_image, name='analyze-image'),
    path('analyze/<uuid:analysis_id>/', views.analysis_status, name='analysis-status'),
]

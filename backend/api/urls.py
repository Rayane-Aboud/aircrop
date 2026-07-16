from django.urls import path

from . import views

urlpatterns = [
    path('analyze/', views.analyze_image, name='analyze-image'),
    path('analyze/<uuid:analysis_id>/', views.analysis_status, name='analysis-status'),
    path(
        'analyze/<uuid:analysis_id>/report.pdf',
        views.analysis_report_pdf,
        name='analysis-report-pdf',
    ),
    path('samples/', views.list_samples, name='list-samples'),
    path('samples/<str:sample_id>/image/', views.sample_image, name='sample-image'),
]

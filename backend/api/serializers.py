from rest_framework import serializers

from .models import ImageAnalysis, Land


class LandSerializer(serializers.ModelSerializer):
    farmer_name = serializers.CharField(source='farmer.display_name', read_only=True)
    agronomist_name = serializers.CharField(source='agronomist.display_name', read_only=True)
    report_count = serializers.IntegerField(source='reports.count', read_only=True)

    class Meta:
        model = Land
        fields = (
            'id', 'name', 'farmer', 'farmer_name', 'agronomist', 'agronomist_name',
            'area_hectares', 'crop_type', 'location_name', 'latitude', 'longitude',
            'report_count', 'created_at',
        )
        read_only_fields = ('id', 'agronomist', 'agronomist_name', 'created_at')


class ReportListSerializer(serializers.ModelSerializer):
    """Compact row for history lists — what a farmer sees: id, date, status, PDF."""

    land_name = serializers.CharField(source='land.name', read_only=True)
    status_label = serializers.SerializerMethodField()
    report_pdf_url = serializers.SerializerMethodField()

    class Meta:
        model = ImageAnalysis
        fields = (
            'id', 'status', 'status_label', 'land', 'land_name',
            'crop_health', 'report_pdf_url', 'created_at',
        )

    def get_status_label(self, obj):
        return obj.get_status_display()

    def get_report_pdf_url(self, obj):
        return f'/api/analyze/{obj.id}/report.pdf' if obj.report_pdf else None

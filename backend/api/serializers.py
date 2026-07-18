from django.utils import timezone
from rest_framework import serializers

from . import geo
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
            'boundary', 'boundary_updated_at', 'report_count', 'created_at',
        )
        read_only_fields = (
            'id', 'agronomist', 'agronomist_name', 'boundary_updated_at', 'created_at',
        )

    def validate_boundary(self, value):
        # Allow clearing the boundary (null); otherwise require a real polygon.
        if value in (None, {}):
            return None
        if not geo.is_valid_polygon(value):
            raise serializers.ValidationError(
                'boundary must be a GeoJSON Polygon with at least 3 points.'
            )
        return value

    def _derive_from_boundary(self, data):
        """When a boundary is set/changed, auto-fill area + centroid + stamp."""
        if 'boundary' not in data:
            return
        boundary = data.get('boundary')
        if boundary:
            area = geo.polygon_area_hectares(boundary)
            if area is not None:
                data['area_hectares'] = area
            centroid = geo.polygon_centroid(boundary)
            if centroid:
                data['latitude'], data['longitude'] = centroid
            data['boundary_updated_at'] = timezone.now()
        else:
            data['boundary_updated_at'] = None

    def create(self, validated_data):
        self._derive_from_boundary(validated_data)
        return super().create(validated_data)

    def update(self, instance, validated_data):
        self._derive_from_boundary(validated_data)
        return super().update(instance, validated_data)


class ReportListSerializer(serializers.ModelSerializer):
    """Compact row for history lists — what a farmer sees: id, date, status, PDF."""

    land_name = serializers.CharField(source='land.name', read_only=True)
    status_label = serializers.SerializerMethodField()
    report_pdf_url = serializers.SerializerMethodField()
    image_count = serializers.IntegerField(source='images.count', read_only=True)

    class Meta:
        model = ImageAnalysis
        fields = (
            'id', 'status', 'status_label', 'land', 'land_name',
            'crop_health', 'report_pdf_url', 'image_count', 'created_at',
        )

    def get_status_label(self, obj):
        return obj.get_status_display()

    def get_report_pdf_url(self, obj):
        return f'/api/analyze/{obj.id}/report.pdf' if obj.report_pdf else None

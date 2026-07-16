# Generated for the PDF report feature (api/report_pdf.py).

from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ('api', '0003_imageanalysis_datetime_location_weather'),
    ]

    operations = [
        migrations.AddField(
            model_name='imageanalysis',
            name='report_pdf',
            field=models.FileField(blank=True, null=True, upload_to='crop_reports/%Y/%m/%d/'),
        ),
    ]

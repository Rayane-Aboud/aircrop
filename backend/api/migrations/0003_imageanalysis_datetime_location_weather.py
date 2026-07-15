from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ('api', '0002_imageanalysis_annotated_image'),
    ]

    operations = [
        migrations.AddField(
            model_name='imageanalysis',
            name='captured_at',
            field=models.DateTimeField(blank=True, null=True),
        ),
        migrations.AddField(
            model_name='imageanalysis',
            name='latitude',
            field=models.FloatField(blank=True, null=True),
        ),
        migrations.AddField(
            model_name='imageanalysis',
            name='longitude',
            field=models.FloatField(blank=True, null=True),
        ),
        migrations.AddField(
            model_name='imageanalysis',
            name='location_name',
            field=models.CharField(blank=True, max_length=255, null=True),
        ),
        migrations.AddField(
            model_name='imageanalysis',
            name='weather',
            field=models.JSONField(blank=True, null=True),
        ),
    ]

# Build from the repo root:  docker build -f api/Dockerfile -t firecalendar-api .
FROM python:3.13-slim
WORKDIR /app
COPY api/requirements.txt api/requirements.txt
RUN pip install --no-cache-dir -r api/requirements.txt
COPY api/ api/
COPY data/harmonized_points.parquet data/calibration.json data/no_data_days.csv data/forecast_model.json data/
COPY data/boundaries/ data/boundaries/
COPY raw_data/boundaries/pak_adm0_gb.geojson raw_data/boundaries/pak_adm0_gb.geojson
ENV PORT=8000
EXPOSE 8000
CMD ["sh", "-c", "uvicorn api.main:app --host 0.0.0.0 --port ${PORT}"]

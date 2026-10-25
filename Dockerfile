FROM python:3.13-slim
WORKDIR /app
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt
COPY horizon horizon
COPY templates templates
COPY static static
ENV MTRX_DB_PATH=/app/data/horizon.db
EXPOSE 8000
CMD ["sh", "-c", "uvicorn horizon.main:app --host 0.0.0.0 --port ${PORT:-8000} --proxy-headers --forwarded-allow-ips='*'"]

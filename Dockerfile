FROM python:3.13-slim
WORKDIR /app
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt
COPY horizon horizon
COPY templates templates
COPY static static
ENV MTRX_DB_PATH=/app/data/horizon.db
EXPOSE 8000
# No proxy headers: with "--forwarded-allow-ips='*'" uvicorn took the client
# address from X-Forwarded-For, which a visitor can write, and every per-address
# limit could be dodged. Behind a host's proxy, MTRX_TRUST_PROXY=1 has the app
# read the entry that proxy added itself (see client_ip in horizon/main.py).
CMD ["sh", "-c", "uvicorn horizon.main:app --host 0.0.0.0 --port ${PORT:-8000} --no-proxy-headers"]

FROM python:3.13-slim
WORKDIR /app
# constraints.txt pins every package, including the ones requirements.txt
# pulls in, so the image installs exactly what CI tested.
COPY requirements.txt constraints.txt ./
RUN pip install --no-cache-dir -r requirements.txt -c constraints.txt
COPY horizon horizon
COPY templates templates
COPY static static
COPY docker-entrypoint.sh /app/docker-entrypoint.sh
ENV MTRX_DB_PATH=/app/data/horizon.db
# The site runs as "horizon", not root. The entrypoint starts as root only to
# give the data disk to that user, then drops to it.
RUN useradd --create-home --shell /usr/sbin/nologin horizon \
    && mkdir -p /app/data \
    && chown -R horizon:horizon /app/data \
    && chmod 755 /app/docker-entrypoint.sh
EXPOSE 8000
ENTRYPOINT ["/app/docker-entrypoint.sh"]
# No proxy headers: with "--forwarded-allow-ips='*'" uvicorn took the client
# address from X-Forwarded-For, which a visitor can write, and every per-address
# limit could be dodged. Behind a host's proxy, MTRX_TRUST_PROXY=1 has the app
# read the entry that proxy added itself (see client_ip in horizon/main.py).
CMD ["sh", "-c", "uvicorn horizon.main:app --host 0.0.0.0 --port ${PORT:-8000} --no-proxy-headers"]

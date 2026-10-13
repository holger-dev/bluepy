# BluePy-Hub – Python standard library only, no pip install needed.
FROM python:3.12-slim
ENV PYTHONUNBUFFERED=1 PYTHONDONTWRITEBYTECODE=1 HUB_DATA=/data HUB_SITE=/site HUB_PORT=8080
WORKDIR /app
COPY hub/bluepy_hub ./bluepy_hub
COPY hub/entrypoint.py ./entrypoint.py
COPY site /site
RUN useradd --create-home --uid 1000 hub && mkdir -p /data && chown hub:hub /data
VOLUME ["/data"]
EXPOSE 8080
HEALTHCHECK --interval=30s --timeout=5s CMD python -c "import urllib.request,sys; sys.exit(0 if urllib.request.urlopen('http://127.0.0.1:8080/api/health', timeout=4).status == 200 else 1)"
# Starts as root, fixes ownership of the bind-mounted /data, then drops to the `hub` user (see entrypoint.py).
ENTRYPOINT ["python", "/app/entrypoint.py"]
CMD ["serve"]

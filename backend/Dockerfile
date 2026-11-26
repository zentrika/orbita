FROM python:3.12-slim-trixie AS base
ENV PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1 PIP_NO_CACHE_DIR=1
WORKDIR /app
RUN useradd --system --uid 1000 --no-create-home orbita
COPY requirements.txt requirements-dev.txt ./
ARG INSTALL_DEV=false
RUN if [ "$INSTALL_DEV" = "true" ]; then pip install -r requirements-dev.txt; else pip install -r requirements.txt; fi
COPY . .
RUN chmod +x entrypoint.sh
USER orbita
EXPOSE 8000
ENTRYPOINT ["./entrypoint.sh"]
CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000", "--proxy-headers", "--forwarded-allow-ips", "*"]

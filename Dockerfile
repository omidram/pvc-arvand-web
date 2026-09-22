# syntax=docker/dockerfile:1

# --- Frontend: static export (same origin as the API) ---
FROM node:20-alpine AS frontend
WORKDIR /src
COPY frontend/package.json frontend/package-lock.json ./
RUN npm ci
COPY frontend/src ./src
COPY frontend/public ./public
COPY frontend/tsconfig.json frontend/next.config.ts frontend/postcss.config.mjs frontend/next-env.d.ts ./
ENV NEXT_TELEMETRY_DISABLED=1
ENV PVC_STATIC_EXPORT=1
ENV NEXT_PUBLIC_SAME_ORIGIN=1
ENV NEXT_PUBLIC_API_URL=
RUN npm run build

# --- Backend: FastAPI serving the exported UI + REST API ---
FROM python:3.12-slim AS runtime
WORKDIR /app

RUN apt-get update \
    && apt-get install -y --no-install-recommends curl \
    && rm -rf /var/lib/apt/lists/*

COPY backend/requirements-docker.txt ./requirements.txt
RUN pip install --no-cache-dir -r requirements.txt

COPY backend/app ./app
COPY --from=frontend /src/out ./static
COPY backend/instance/pvc_arvand.db ./seed/pvc_arvand.db

ENV PVC_ENV=production
ENV PVC_STATIC_DIR=/app/static
ENV PVC_DATA_DIR=/data
ENV PVC_RESOURCE_DIR=/app
ENV APP_HOST=0.0.0.0
ENV APP_PORT=8080
ENV PYTHONUNBUFFERED=1

RUN mkdir -p /data /data/backups
EXPOSE 8080

HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
    CMD curl -fsS http://127.0.0.1:8080/health || exit 1

CMD ["python", "-m", "app.server"]

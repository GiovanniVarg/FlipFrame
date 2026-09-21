FROM node:24-bookworm-slim AS build
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY . .
RUN npm run build

FROM node:24-bookworm-slim
# Optional CPU SAM2 image: docker build --build-arg INSTALL_SAM2=true -f deployment/Dockerfile .
# Docker is unavailable on the development host; this image build is not yet tested.
ARG INSTALL_SAM2=false
ENV SAM2_ENV_ROOT=/opt/sam2-venv SEGMENTATION_PYTHON=/opt/sam2-venv/bin/python SAM2_CHECKPOINT=/models/sam2.1_hiera_tiny.pt XDG_CACHE_HOME=/data/cache
ENV NODE_ENV=production LAB_MODE=saas LAB_DATA_DIR=/data PYTHON=/opt/venv/bin/python HOST=0.0.0.0 PORT=3000
RUN apt-get update && apt-get install -y --no-install-recommends python3 python3-venv ffmpeg ca-certificates && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY package*.json ./
RUN npm ci --omit=dev && npm cache clean --force
COPY requirements.txt ./
RUN python3 -m venv /opt/venv && /opt/venv/bin/pip install --no-cache-dir -r requirements.txt
COPY --from=build /app/dist ./dist
COPY *.mjs *.py ./
COPY sample-source.mp4 ./sample-source.mp4
# Checkpoints can alternatively be mounted read-only at SAM2_CHECKPOINT.
# Install dependencies at build time; inference never downloads model code/weights.
RUN case "$INSTALL_SAM2" in \
      true) apt-get update && apt-get install -y --no-install-recommends git \
        && python3 setup_segmentation.py --cpu --isolated \
        && chmod -R a+rX /opt/sam2-venv /models \
        && rm -rf /app/.segmentation /root/.cache/pip /var/lib/apt/lists/* ;; \
      false) ;; \
      *) echo "INSTALL_SAM2 must be true or false" >&2; exit 1 ;; \
    esac
RUN mkdir -p /data/cache /models && chown -R node:node /data && chmod 755 /models
USER node
VOLUME ["/data"]
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s CMD node -e "fetch('http://127.0.0.1:3000/api/health').then(r=>{if(!r.ok)process.exit(1)}).catch(()=>process.exit(1))"
CMD ["node","server.mjs"]

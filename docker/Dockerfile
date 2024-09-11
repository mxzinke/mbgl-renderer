FROM node:20-bullseye AS builder

WORKDIR /app/

COPY package*.json ./

RUN npm install

COPY .babelrc /app/.babelrc
COPY src/ /app/src/

RUN npm run build && \
  npm prune --include prod && \
  rm -rf "/root/.npm" && \
  rm -rf "/root/.cache" && \
  rm -rf "/app/src" && \
  rm -rf "/app/.babelrc"

FROM ubuntu:22.04

# Install Node.js
ARG NODE_VERSION=20
RUN apt-get update && apt-get install -y curl && \
  curl -fsSL https://deb.nodesource.com/setup_${NODE_VERSION}.x | bash - && \
  apt-get install -y nodejs && \
  # Clean up
  apt-get clean && \
  rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Install dependencies
RUN apt-get update && \
  apt-get install -y \
  xvfb \
  x11-utils \
  libcurl4-openssl-dev \
  libglfw3-dev \
  libuv1-dev \
  libjpeg-dev \
  libpng-dev \
  libwebp-dev && \
  # Clean up
  apt-get clean && \
  rm -rf /var/lib/apt/lists/* && \
  # Prepare tiles directory
  mkdir /app/tiles

COPY ./docker/entrypoint.sh /root
RUN chmod +x /root/entrypoint.sh

COPY --from=builder /app/package*.json ./
COPY --from=builder /app/node_modules ./node_modules/
COPY --from=builder /app/dist ./dist/

EXPOSE 80
ENV DISPLAY=:99

ENTRYPOINT [ "/root/entrypoint.sh" ]
HEALTHCHECK CMD curl --fail http://localhost:80/health || exit 1
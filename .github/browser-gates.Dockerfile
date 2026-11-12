FROM node:24-slim@sha256:ba849c60be29959425b8734d57b8b4b7d56f98edd9504c9af091d5281095a71e AS node

FROM ubuntu:24.04@sha256:fe81560990fae86dc4743202b2cb4d3df98d0bcf949173cecef15ce1127ef852

ARG PLAYWRIGHT_VERSION=1.62.1
ARG PNPM_VERSION=9.15.4

ENV PLAYWRIGHT_VERSION=${PLAYWRIGHT_VERSION} \
    PLAYWRIGHT_BROWSERS_PATH=/ms-playwright \
    DEBIAN_FRONTEND=noninteractive \
    NPM_CONFIG_UPDATE_NOTIFIER=false

COPY --from=node /usr/local/bin/node /usr/local/bin/node
COPY --from=node /usr/local/lib/node_modules/npm /usr/local/lib/node_modules/npm

RUN ln -s ../lib/node_modules/npm/bin/npm-cli.js /usr/local/bin/npm \
 && npm install --global --no-audit --no-fund "pnpm@${PNPM_VERSION}" "playwright@${PLAYWRIGHT_VERSION}" \
 && playwright install --with-deps webkit \
 && playwright install --with-deps --only-shell chromium \
 && npm uninstall --global playwright \
 && rm -rf /var/lib/apt/lists/* /root/.npm /root/.cache /tmp/* \
 && chmod -R a+rX "$PLAYWRIGHT_BROWSERS_PATH"

LABEL org.opencontainers.image.source=https://github.com/tickernelz/wardmote

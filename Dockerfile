# Falcon CRM — one image serving the API and the web bundle from one origin.
#
# `apps/web` calls the API at the relative path `/api/v1`, and outside `pnpm dev`
# there is no Vite proxy to rewrite it. Rather than a reverse proxy this
# container would have to supervise, or a CDN with a path behaviour to keep in
# step, the API serves the bundle itself when `FALCON_WEB_ROOT` is set. Local
# development never sets it and is unaffected.

# ---------------------------------------------------------------------------
# Build
# ---------------------------------------------------------------------------
FROM node:24.19.0-bookworm-slim AS build

# argon2 is a native module; the API cannot hash a password without it building.
RUN apt-get update \
  && apt-get install -y --no-install-recommends python3 make g++ ca-certificates \
  && rm -rf /var/lib/apt/lists/*

ENV PNPM_HOME=/pnpm
ENV PATH=$PNPM_HOME:$PATH
RUN corepack enable

WORKDIR /app

# Manifests first, so a change to source does not invalidate the install layer.
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml .npmrc ./
COPY apps/api/package.json      apps/api/
COPY apps/web/package.json      apps/web/
COPY apps/worker/package.json   apps/worker/
COPY packages/contracts/package.json         packages/contracts/
COPY packages/database/package.json          packages/database/
COPY packages/observability/package.json     packages/observability/
COPY packages/permission-engine/package.json packages/permission-engine/
COPY packages/test-support/package.json      packages/test-support/
COPY packages/ui/package.json                packages/ui/
COPY packages/validation/package.json        packages/validation/
COPY packages/workflow-engine/package.json   packages/workflow-engine/

# argon2 is the one build script this image genuinely needs; the rest stay
# blocked, which is pnpm's default and the safer posture.
RUN pnpm install --frozen-lockfile --config.confirmModulesPurge=false \
  && pnpm rebuild argon2

COPY . .

# The organization UUID is substituted into the bundle at build time
# (apps/web/src/lib/constants.ts), so it has to be known here — which means the
# bootstrap CLI must already have run. See docs/operations/deployment.md; getting
# this wrong ships a bundle whose first act is to throw.
ARG VITE_FALCON_ORGANIZATION_ID
ENV VITE_FALCON_ORGANIZATION_ID=${VITE_FALCON_ORGANIZATION_ID}
RUN test -n "$VITE_FALCON_ORGANIZATION_ID" \
  || (echo "VITE_FALCON_ORGANIZATION_ID build arg is required; run the bootstrap CLI first" && exit 1)

RUN pnpm build

# Drop dev dependencies before they are copied into the runtime image.
FROM build AS pruned
RUN CI=true pnpm prune --prod

# ---------------------------------------------------------------------------
# Runtime
# ---------------------------------------------------------------------------
FROM node:24.19.0-bookworm-slim AS runtime

RUN apt-get update \
  && apt-get install -y --no-install-recommends ca-certificates \
  && rm -rf /var/lib/apt/lists/*

WORKDIR /app
ENV NODE_ENV=production

# `node` exists in the base image; the process has no reason to be root.
USER node

COPY --from=pruned --chown=node:node /app/node_modules              ./node_modules
COPY --from=pruned --chown=node:node /app/apps/api/dist             ./apps/api/dist
COPY --from=pruned --chown=node:node /app/apps/api/node_modules     ./apps/api/node_modules
COPY --from=pruned --chown=node:node /app/apps/web/dist             ./apps/web/dist
COPY --from=pruned --chown=node:node /app/packages                  ./packages

# Where registerWeb serves the bundle from. Setting it here rather than in the
# service definition keeps the path an implementation detail of the image.
ENV FALCON_WEB_ROOT=/app/apps/web/dist

# Everything else — the database URL, the email key, the public base URL — is
# injected by the platform from its secret store. No secret is baked in.
EXPOSE 3000

# The migration and bootstrap one-off tasks run this same image with a different
# command; see docs/operations/deployment.md.
CMD ["node", "apps/api/dist/main.js"]

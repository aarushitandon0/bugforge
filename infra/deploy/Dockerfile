# BugForge as one container.
#
# One container serves the web app AND the API from one origin. That is not a
# packaging convenience: it is what lets the session cookie be first-party
# (`SameSite=Lax`, see cloud/auth.py COOKIE_FLAGS) and what removes CORS from
# the picture entirely.
#
# Everything expensive happens here, at build time: the web build, the clone of
# the target repo at its pinned commit, every pip install, and the seeding of
# the challenge corpus. Nothing is fetched or installed when a request arrives.
#
# The forge itself is not reachable on this deployment -- POST /forge needs to
# start a Step Functions execution and there is no AWS account. The challenges
# were produced by the real pipeline offline and are baked in below.

# ---------------------------------------------------------------------------
# 1. the web app
# ---------------------------------------------------------------------------
FROM node:22-slim AS web

WORKDIR /web
# The lockfile alone first, so a source-only change does not reinstall.
COPY web/package.json web/package-lock.json ./
RUN npm ci

COPY web/ ./
# Baked in at build time, because a static export has no server to ask. "/api"
# is where the API is mounted on this same origin (see server/app.py).
ENV NEXT_PUBLIC_API_URL=/api
RUN npm run build && test -f out/index.html


# ---------------------------------------------------------------------------
# 2. the runtime
# ---------------------------------------------------------------------------
FROM python:3.12-slim

# git is a RUNTIME dependency, not just a build one: grading applies the
# learner's patch with `git apply`, and packaging re-inits a history.
RUN apt-get update \
    && apt-get install -y --no-install-recommends git ca-certificates \
    && rm -rf /var/lib/apt/lists/*

ARG REPO_URL=https://github.com/jd/tenacity
ARG REPO_SHA=3e58094d3bc414975aad9eadf343a32bdb3b89b3
ARG REPO_PACKAGE=tenacity
ARG REPO_EXTRAS=test

RUN git clone --quiet "$REPO_URL" /repo \
    && git -C /repo checkout --quiet "$REPO_SHA"

# A src/ layout would make pytest run against the unmutated installed copy and
# grade every challenge as already fixed. Fail the build rather than ship that.
RUN test -d "/repo/$REPO_PACKAGE" || ( \
      echo "ERROR: /repo/$REPO_PACKAGE not found; src/ layout is not supported" \
      && exit 1)

COPY requirements.txt requirements-server.txt /tmp/
RUN pip install --no-cache-dir -r /tmp/requirements.txt -r /tmp/requirements-server.txt \
    && pip install --no-cache-dir -e "/repo[${REPO_EXTRAS}]"

# Prove the target suite is green in this image. A red baseline has no usable
# signal, and every challenge here was selected against a green one.
RUN cd /repo && python -m pytest -q --no-header -p no:cacheprovider \
    && rm -rf /repo/.pytest_cache

# An unprivileged uid with a writable $HOME. Required by some hosts outright,
# and correct everywhere: nothing here needs root at runtime.
RUN useradd --create-home --uid 1000 user
ENV HOME=/home/user
WORKDIR /home/user/app

COPY bugforge  bugforge
COPY cloud     cloud
COPY server    server
COPY infra/local/seed.py infra/local/seed.py
COPY corpus    corpus
COPY --from=web /web/out web/out
COPY infra/deploy/entrypoint.sh /usr/local/bin/entrypoint.sh
RUN chmod +x /usr/local/bin/entrypoint.sh

ENV PYTHONPATH=/home/user/app \
    PYTHONDONTWRITEBYTECODE=1 \
    PYTEST_ADDOPTS="-p no:cacheprovider" \
    REPO_DIR=/repo \
    REPO_NAME=jd__tenacity \
    REPO_URL=https://github.com/jd/tenacity \
    REPO_PACKAGE=tenacity \
    REPO_LANGUAGE=python \
    REPO_LICENSE=Apache-2.0 \
    BUCKET=bugforge \
    TABLE_CHALLENGES=challenges \
    TABLE_GAPS=gaps \
    TABLE_SUBMISSIONS=submissions \
    TABLE_LEADERBOARD=leaderboard \
    TABLE_PROGRESS=progress \
    BUGFORGE_LOCAL_STORE=/home/user/store \
    BUGFORGE_LOCAL_GRADING=1 \
    BUGFORGE_WEB_DIR=/home/user/app/web/out \
    BUGFORGE_PUBLIC_BASE=/api \
    BUGFORGE_COOKIE_MODE=same_origin \
    BUGFORGE_DISABLE_BEDROCK=1

# Seed at BUILD time, so a cold Space serves challenges on its first request
# rather than importing 14MB of tarballs while someone waits. This writes
# exactly what fn_persist writes: the same rows, the same two S3 prefixes.
RUN python infra/local/seed.py corpus \
    && chown -R user:user /home/user/store

USER user
EXPOSE 7860

ENTRYPOINT ["/usr/local/bin/entrypoint.sh"]

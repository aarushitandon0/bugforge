#!/bin/sh
# Work out the two URLs sign-in needs, then serve.
#
# `redirect_uri` is deliberately NOT derived from the incoming request: GitHub
# compares it on both legs of the flow, and an attacker controls the Host
# header. So it is configuration, and this is where configuration is resolved.
#
# Hugging Face injects SPACE_HOST, so a Space needs nothing set by hand. Cloud
# Run and friends do not publish their own URL to the container, so WEB_ORIGIN
# is set explicitly there after the first deploy -- see infra/deploy/DEPLOY.md,
# which covers that chicken-and-egg.
set -eu

if [ -z "${WEB_ORIGIN:-}" ] && [ -n "${SPACE_HOST:-}" ]; then
    WEB_ORIGIN="https://${SPACE_HOST}"
fi
: "${OAUTH_REDIRECT_URI:=${WEB_ORIGIN:-}/api/auth/callback}"
export WEB_ORIGIN OAUTH_REDIRECT_URI

echo "bugforge: origin=${WEB_ORIGIN:-<unset>} callback=${OAUTH_REDIRECT_URI}"

# $PORT is what Cloud Run (8080) and most other hosts inject; 7860 is the
# Hugging Face convention and the default here.
exec python -m uvicorn server.app:app \
    --host 0.0.0.0 \
    --port "${PORT:-7860}" \
    --log-level info \
    --timeout-keep-alive 75

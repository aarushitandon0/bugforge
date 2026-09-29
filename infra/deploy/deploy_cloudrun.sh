#!/usr/bin/env bash
# Deploy BugForge to Google Cloud Run from source.
#
#   ./infra/deploy/deploy_cloudrun.sh <project-id> [region] [service]
#
# Cloud Build builds infra/deploy/Dockerfile and Cloud Run serves it. The
# service URL is not known until the first deploy finishes, and the callback
# URL cannot be derived from the request (GitHub compares it, and an attacker
# controls Host), so sign-in is configured on a SECOND pass. This script does
# the first pass and prints exactly what to run for the second.
set -euo pipefail
cd "$(dirname "$0")/../.."

PROJECT="${1:?usage: deploy_cloudrun.sh <project-id> [region] [service]}"
REGION="${2:-us-central1}"
SERVICE="${3:-bugforge}"

command -v gcloud >/dev/null || { echo "gcloud is not installed; see DEPLOY.md" >&2; exit 1; }

./infra/deploy/make_bundle.sh local_output/bundle

gcloud config set project "$PROJECT" >/dev/null
gcloud services enable run.googleapis.com cloudbuild.googleapis.com \
       artifactregistry.googleapis.com --project "$PROJECT"

# --no-cpu-throttling is NOT an optimisation. Grading runs on a background
# thread after the 202 has already been returned, and Cloud Run's default
# throttles CPU to near zero between requests, which would freeze the grader
# mid-suite and leave submissions stuck on "pending" forever.
#
# 1Gi because the grader forks pytest over a real repository; the 512Mi
# default is not enough headroom. max-instances caps the blast radius on cost.
gcloud run deploy "$SERVICE" \
  --source local_output/bundle \
  --region "$REGION" \
  --allow-unauthenticated \
  --memory 1Gi \
  --cpu 1 \
  --no-cpu-throttling \
  --timeout 300 \
  --min-instances 0 \
  --max-instances 3

URL="$(gcloud run services describe "$SERVICE" --region "$REGION" --format='value(status.url)')"

cat <<EOF

  Deployed: $URL

  It is serving already, signed out. To turn sign-in on:

  1. Add this redirect URI to the GitHub OAuth app
     (https://github.com/settings/developers):

       $URL/api/auth/callback

  2. Then run:

     gcloud run services update $SERVICE --region $REGION \
       --set-env-vars WEB_ORIGIN=$URL \
       --set-env-vars GITHUB_CLIENT_ID=<client id> \
       --set-env-vars GITHUB_CLIENT_SECRET=<client secret> \
       --set-env-vars SESSION_SECRET=<any long random string>

  3. Check it took:

     curl $URL/api/     # expect "sign_in":"configured"
EOF

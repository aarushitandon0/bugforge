#!/usr/bin/env bash
# Assemble the directory that gets built and deployed.
#
# The project repo cannot be pushed as-is: cache/ holds multi-gigabyte clones
# and virtualenvs, and phase5_output holds 63MB of pipeline intermediates that
# seed.py never reads. This copies exactly what the image needs -- about 14MB
# of corpus plus the source -- into local_output/space/.
set -euo pipefail
cd "$(dirname "$0")/../.."

OUT="${1:-local_output/bundle}"
SRC="${BUGFORGE_CORPUS:-phase5_output}"

[ -d "$SRC" ] || { echo "no corpus at $SRC" >&2; exit 1; }

rm -rf "$OUT"
mkdir -p "$OUT"

# Source. web/ deliberately excludes node_modules and any previous build:
# the image builds the web app itself from package-lock.json.
cp -r bugforge cloud server "$OUT"/
mkdir -p "$OUT/infra/local" "$OUT/infra/deploy"
cp infra/local/seed.py "$OUT/infra/local/"
cp infra/deploy/Dockerfile infra/deploy/entrypoint.sh "$OUT/infra/deploy/"
cp infra/deploy/Dockerfile "$OUT/Dockerfile"
# Render reads render.yaml from the repo root. Harmless everywhere else:
# Cloud Run and Hugging Face never look at it.
cp infra/deploy/render.yaml "$OUT/render.yaml"
cp requirements.txt requirements-server.txt "$OUT"/

mkdir -p "$OUT/web"
cp web/package.json web/package-lock.json web/next.config.mjs "$OUT/web/"
for d in app components lib public scripts; do
  [ -d "web/$d" ] && cp -r "web/$d" "$OUT/web/"
done
for f in web/tsconfig.json web/postcss.config.mjs web/tailwind.config.ts web/vitest.config.ts web/next-env.d.ts; do
  [ -f "$f" ] && cp "$f" "$OUT/web/"
done

# The corpus, minus the pipeline intermediates seed.py never opens.
mkdir -p "$OUT/corpus"
cp "$SRC"/*.json "$OUT/corpus/"
for dir in "$SRC"/*/; do
  name="$(basename "$dir")"
  [ "$name" = "work" ] && continue
  mkdir -p "$OUT/corpus/$name"
  find "$dir" -maxdepth 1 -type f \( -name '*.tar.gz' -o -name '*.json' \) \
    -exec cp {} "$OUT/corpus/$name/" \;
done

find "$OUT" -name '__pycache__' -type d -prune -exec rm -rf {} + 2>/dev/null || true
find "$OUT" -name '*.pyc' -delete 2>/dev/null || true

echo "assembled $OUT ($(du -sh "$OUT" | cut -f1))"

#!/usr/bin/env bash
# Run the built image the way Hugging Face will, and check it actually serves.
#
# This is the whole point of building locally: everything below fails on the
# Space too, and finding out here costs one minute instead of a push, a build
# and a log read.
set -uo pipefail
IMAGE="${1:-bugforge-space:test}"
PORT="${2:-7870}"
NAME="bugforge-smoke-$$"
CID="jd__tenacity-3e58094d3b-71d812b7bcbb"
fail=0

check() { # label expected actual
  if [ "$2" = "$3" ]; then printf "  ok    %-44s %s\n" "$1" "$3"
  else printf "  FAIL  %-44s got %s, want %s\n" "$1" "$3" "$2"; fail=1; fi
}

echo "starting $IMAGE the way a host runs it (K_SERVICE set, PORT injected)"
docker run -d --rm --name "$NAME" -p "${PORT}:7860" \
  -e WEB_ORIGIN="http://localhost:${PORT}" \
  -e K_SERVICE="bugforge" \
  "$IMAGE" >/dev/null || { echo "container did not start"; exit 1; }

for _ in $(seq 1 60); do
  curl -sf "http://localhost:${PORT}/api/" >/dev/null 2>&1 && break
  sleep 1
done

code() { curl -s -o /dev/null -w "%{http_code}" "http://localhost:${PORT}$1"; }

echo "--- the web app ---"
for p in / /repos/ /gaps/ /profile/ /signin/ "/repo/?repo=jd__tenacity" "/solve/?id=$CID"; do
  check "$p" 200 "$(code "$p")"
done

echo "--- the api, same origin ---"
check "/api/"            200 "$(code /api/)"
check "/api/repos"       200 "$(code /api/repos)"
check "/api/auth/me"     200 "$(code /api/auth/me)"
check "/api/gaps?repo=jd__tenacity" 200 "$(code "/api/gaps?repo=jd__tenacity")"

echo "--- the corpus is baked in ---"
n=$(curl -s "http://localhost:${PORT}/api/repos" | python -c "import sys,json;print(json.load(sys.stdin)['repos'][0]['challenge_count'])" 2>/dev/null)
check "challenge_count" 56 "${n:-none}"

echo "--- the two S3 prefixes have different answers ---"
check "public tree"   200 "$(code "/api/files/public/$CID/tree.tar.gz")"
check "answers patch" 403 "$(code "/api/files/answers/$CID/mutation.patch")"

echo "--- gated routes ---"
check "POST /api/submissions signed out" 401 \
  "$(curl -s -o /dev/null -w '%{http_code}' -X POST -H 'content-type: application/json' \
     -d '{}' "http://localhost:${PORT}/api/submissions")"

echo "--- forging is refused cleanly, not with a 500 ---"
check "POST /api/forge" 503 \
  "$(curl -s -o /dev/null -w '%{http_code}' -X POST -H 'content-type: application/json' \
     -d '{}' "http://localhost:${PORT}/api/forge")"

echo "--- the dev identity cannot be turned on when hosted ---"
docker stop "$NAME" >/dev/null 2>&1
out=$(docker run --rm -e SPACE_HOST="localhost" -e K_SERVICE="bugforge" \
        -e BUGFORGE_LOCAL_USER=local-dev "$IMAGE" 2>&1 | tail -3)
case "$out" in
  *BUGFORGE_LOCAL_USER*) echo "  ok    refuses to start with BUGFORGE_LOCAL_USER set" ;;
  *) echo "  FAIL  started anyway: $out"; fail=1 ;;
esac

[ "$fail" = 0 ] && echo "ALL GREEN" || echo "SOMETHING FAILED"
exit "$fail"

#!/usr/bin/env bash
# Publish the bundle to the deploy repo that Render builds from.
#
# Why a second repo at all: Render builds from git, and the corpus is not in
# this one. phase5_output/ is 76MB and gitignored on purpose; make_bundle.sh
# exists to assemble the ~16MB an image actually needs. So the thing Render
# builds is the bundle, and the bundle needs a remote of its own.
#
# WHY THAT REMOTE MUST BE PRIVATE
# -------------------------------
# The bundle carries the answer tarballs -- one `*-answers.tar.gz` per
# challenge, 56 of them. That is correct inside the image: seed.py files them
# under a prefix the API refuses (smoke_test.sh asserts 403), so a player
# cannot reach them. It is NOT correct in a repo. A public deploy repo hands
# every answer to anyone who clones it, and the claim this project rests on --
# that the grading path has no access to the answer -- stops being true.
#
# This repo's .gitignore already says as much (`*answers.tar.gz`,
# `**/answers/`). The check below is that rule surviving the trip into a repo
# where those patterns no longer apply.
set -euo pipefail
cd "$(dirname "$0")/../.."

REMOTE="${1:?usage: push_bundle.sh <git-remote-url> [branch]}"
BRANCH="${2:-main}"
BUNDLE="local_output/bundle"
WORK="local_output/deploy_repo"

# --- the gate -------------------------------------------------------------
# No gh CLI here, so ask github.com directly: a repo it will describe to an
# anonymous caller is public. 404 means private or absent, and a private repo
# that does not exist yet fails later at push time with a clear message.
slug="$(printf '%s' "$REMOTE" \
  | sed -E 's#^git@github\.com:#https://github.com/#; s#^https://[^/]*github\.com/##; s#\.git$##; s#/+$##')"

if printf '%s' "$REMOTE" | grep -qi 'github'; then
  code="$(curl -s -o /dev/null -w '%{http_code}' "https://api.github.com/repos/${slug}" || echo 000)"
  if [ "$code" = "200" ]; then
    cat >&2 <<MSG
REFUSING TO PUSH: https://github.com/${slug} is PUBLIC.

The bundle contains all 56 answer tarballs. Pushing them to a public repo
publishes the solution to every challenge.

Make it private (Settings -> General -> Danger Zone -> Change visibility),
then run this again. Render's free plan builds from private repos.
MSG
    exit 1
  fi
  if [ "$code" != "404" ]; then
    echo "warning: could not confirm ${slug} is private (HTTP ${code}); continuing" >&2
  fi
fi

# --- assemble -------------------------------------------------------------
# Always rebuild: a stale bundle deploying silently is worse than a slow push.
./infra/deploy/make_bundle.sh "$BUNDLE"

# --- sync -----------------------------------------------------------------
# make_bundle.sh does `rm -rf "$OUT"`, so the git checkout has to live
# somewhere else or its .git would be deleted out from under it.
if [ ! -d "$WORK/.git" ]; then
  rm -rf "$WORK"
  git clone "$REMOTE" "$WORK" 2>/dev/null || {
    mkdir -p "$WORK"
    git -C "$WORK" init -q
    git -C "$WORK" remote add origin "$REMOTE"
  }
fi
git -C "$WORK" checkout -q -B "$BRANCH"

# Replace the tree wholesale. The bundle is generated output, so anything in
# the deploy repo that is not in the bundle is a leftover from a past layout.
find "$WORK" -mindepth 1 -maxdepth 1 ! -name .git -exec rm -rf {} +
cp -a "$BUNDLE"/. "$WORK"/

git -C "$WORK" add -A
if git -C "$WORK" diff --cached --quiet; then
  echo "no change since the last push"
  exit 0
fi
git -C "$WORK" commit -q -m "bundle from $(git rev-parse --short HEAD)"
git -C "$WORK" push -u origin "$BRANCH"

echo
echo "pushed $(du -sh "$BUNDLE" | cut -f1) to ${REMOTE} (${BRANCH})"
echo "Render will build it if autoDeploy is on; otherwise deploy from the dashboard."

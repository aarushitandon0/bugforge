# Deploying BugForge

One container serves the web app and the API from one origin. That is not
packaging convenience: it is what lets the session cookie be first-party
(`SameSite=Lax`, see `cloud/auth.py` `COOKIE_FLAGS`) and it removes CORS from
the picture entirely.

The target is **Google Cloud Run**. Hugging Face Spaces was the original plan
and the image still runs there unchanged, but Docker Spaces became a paid
feature in July 2026.

Cloud Run needs billing enabled on the project, even though this workload sits
inside the free allowance. If putting a card on file is not acceptable, skip to
[Running it on Render instead](#running-it-on-render-instead-no-credit-card) --
same image, no card, measured against the free plan's 512MB.

## Before you start

- A Google account, and a Cloud project with billing enabled. Cloud Run's free
  allowance covers this workload comfortably; billing has to be on regardless,
  because Google requires it for the API.
- The GitHub OAuth app you already registered. It gains a second redirect URI
  rather than being replaced.
- `gcloud`: <https://cloud.google.com/sdk/docs/install> (Windows installer).
  Then once:

  ```bash
  gcloud auth login
  gcloud projects create bugforge-<something-unique>   # or use an existing one
  ```

  Enable billing on the project in the console, or the deploy fails on API
  enablement.

## Deploy

```bash
./infra/deploy/deploy_cloudrun.sh <project-id>
```

That assembles the bundle, enables the three APIs, and deploys. First build is
5–10 minutes: it installs the web app's dependencies, builds the static export,
clones tenacity at its pinned commit, installs it, **runs tenacity's own test
suite**, and seeds 56 challenges. A red suite fails the build deliberately —
every challenge here was selected against a green baseline.

It prints the service URL and the two commands for step two.

## Turn sign-in on

The URL is not known until the first deploy finishes, and the callback cannot
be derived from the incoming request — GitHub compares it on both legs, and an
attacker controls the Host header. So it is a second pass.

1. <https://github.com/settings/developers> → your OAuth app → **Add redirect
   URI**:

   ```
   https://<service-url>/api/auth/callback
   ```

   Keep the localhost one; an app takes up to 10. Leave **Allow wildcard
   matching** off — every URI here is exact.

2. ```bash
   gcloud run services update bugforge --region us-central1 \
     --set-env-vars WEB_ORIGIN=https://<service-url> \
     --set-env-vars GITHUB_CLIENT_ID=<client id> \
     --set-env-vars GITHUB_CLIENT_SECRET=<client secret> \
     --set-env-vars SESSION_SECRET=<any long random string>
   ```

3. ```bash
   curl https://<service-url>/api/
   ```

   ```json
   {"service":"bugforge-api","store":"local","grading":"in-process","sign_in":"configured"}
   ```

`"sign_in":"disabled"` means the process cannot see all three values. Check
spelling; a Cloud Run env-var update redeploys by itself, so there is nothing
to restart.

> These are plain environment variables, readable by anyone with project
> access. That is fine for a personal project. For anything shared, put them in
> Secret Manager and use `--set-secrets` instead.

## The one Cloud Run setting that is not optional

`--no-cpu-throttling`. Grading runs on a background thread **after** the 202
response has been sent, and Cloud Run's default throttles CPU to near zero
between requests. Without it the grader freezes part way through tenacity's
suite and submissions sit on "pending" forever. The deploy script sets it.

## Checking the image before you deploy

The same image runs locally, so a failure can be found in a minute instead of
after a ten-minute cloud build:

```bash
./infra/deploy/make_bundle.sh
docker build -t bugforge:test local_output/bundle
./infra/deploy/smoke_test.sh bugforge:test
```

17 checks: every page, every API route, the corpus count, that `public/` is
served and `answers/` is refused, that submitting signed out is 401, that
forging is a clean 503 rather than a 500, and that the container refuses to
start with `BUGFORGE_LOCAL_USER` set.

## Redeploying

```bash
./infra/deploy/deploy_cloudrun.sh <project-id>
```

Environment variables set earlier survive a redeploy.

## What is different here from the AWS deployment

- **Forging is off.** `POST /forge` answers 503 with a sentence saying so. That
  path needs the Step Functions pipeline; the challenges served here were
  produced by it offline and baked into the image.
- **Progress resets when the container is replaced.** State is a SQLite file on
  the instance's own disk. Accepted, not overlooked — see the note on a hosted
  database in the README.
- **Cold starts.** With `--min-instances 0` the first request after an idle
  period waits for the container to start, a few seconds. `--min-instances 1`
  removes that and leaves the free allowance behind.

## Running it on Render instead (no credit card)

Cloud Run needs billing enabled on the project even though the workload fits
inside the free allowance. Render's free plan needs no card at all, so this is
the path when that matters.

### What the free plan actually gives you

512MB and 0.1 CPU, against the 1GB Cloud Run is asked for above. That was
measured, not assumed:

- the full `smoke_test.sh` passes with `--memory 512m --cpus 0.1`, all 17 checks
- grading a real submission against tenacity's suite: **PASS, 183 tests, ~26s**
- peak memory nowhere near the cap -- about 56MB of 512

There is no `--no-cpu-throttling` equivalent to set, because Render does not
throttle CPU between requests. The background grading thread keeps running
after the 202, which is the thing Cloud Run needs the flag for.

### The deploy repo, and why it must be private

Render builds from git, and the corpus is not in this repository:
`phase5_output/` is 76MB and gitignored, which is why `make_bundle.sh` exists.
So the bundle gets a repository of its own, and `push_bundle.sh` keeps it in
sync.

**That repository must be private.** The bundle carries all 56
`*-answers.tar.gz` files. Baked into the image that is correct -- `seed.py`
files them under a prefix the API refuses, and `smoke_test.sh` asserts the 403.
In a public repo it is a total spoiler leak, and the claim the project rests on
-- that the grading path has no access to the answer -- stops being true.
`push_bundle.sh` asks github.com whether the repo is visible anonymously and
refuses to push if it is. Render's free plan builds from private repos.

### Deploy

1. Create a **private** repo, e.g. `bugforge-deploy`. Empty, no README.

2. ```bash
   ./infra/deploy/push_bundle.sh git@github.com:<you>/bugforge-deploy.git
   ```

   That rebuilds the bundle and pushes ~16MB, `render.yaml` included.

3. Render dashboard -> **New** -> **Blueprint** -> pick that repo. It reads
   `render.yaml` and creates the service. The first build is 10-15 minutes:
   same work as Cloud Run's, including running tenacity's suite, which is
   deliberate -- a red baseline fails the build.

Then sign-in, exactly as in step two above but in the dashboard rather than
`gcloud`. Add `https://<service>.onrender.com/api/auth/callback` as a second
redirect URI on the GitHub OAuth app, then set `WEB_ORIGIN`,
`GITHUB_CLIENT_ID` and `GITHUB_CLIENT_SECRET` under **Environment**.
`SESSION_SECRET` is generated by the blueprint; leave it alone, because
changing it invalidates every existing session.

Confirm the same way:

```bash
curl https://<service>.onrender.com/api/
```

### What is different here from Cloud Run

- **It sleeps.** Free instances stop after 15 minutes without a request, and
  the image is 530MB, so the first hit after that is a slow cold start -- on
  0.1 CPU the container is not quick to boot. Wake it before a demo.
- **Progress still resets**, for the same reason as Cloud Run: SQLite on the
  instance's own disk, and the free plan has no persistent disk at all.
- **Forging is off**, unchanged -- `POST /forge` is a 503 here too.

### Redeploying

```bash
./infra/deploy/push_bundle.sh git@github.com:<you>/bugforge-deploy.git
```

`autoDeploy` is on by default, so the push is the deploy. Environment
variables set in the dashboard survive it.

## Running it on Hugging Face instead

The image is unchanged; `entrypoint.sh` reads the `SPACE_HOST` that Hugging
Face injects, so `WEB_ORIGIN` and the callback need nothing set by hand. It
needs a PRO account ($9/month) for the Docker SDK. Push
`local_output/bundle` to the Space's git remote with a write token from
<https://huggingface.co/settings/tokens>, and add `README.md` with an
`sdk: docker` / `app_port: 7860` front matter block.

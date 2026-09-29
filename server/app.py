"""One ASGI process standing in for API Gateway + three Lambdas.

BugForge's handlers are written against the API Gateway HTTP API v2 event
shape, not against a web framework. So this module does not reimplement any
route: it translates an HTTP request into that event, calls the same
`fn_api.handler` / `fn_auth.handler` the deployed stack calls, and translates
the returned dict back. Every rule about what the API will and will not say
still lives in cloud/handlers/, which is the point -- there is no second copy
of the routing to drift.

The route table below is the deployed stack's route list, and the path
templates are spelled exactly as `routeKey` spells them, because the handlers
dispatch on that string.

Grading runs in this process, on a background thread, via the switch fn_api
already has (`BUGFORGE_LOCAL_GRADING`). That is not a simplification of the
deployed design so much as the same code with the Lambda invoke removed: the
image this runs in contains the repo and its test suite, which is the only
reason the grader can run anywhere at all.

Serving the web app is NOT this process's job. The static export is hosted
separately and proxies /api/* here, so the session cookie stays first-party.
"""
from __future__ import annotations

import logging
import os
from pathlib import Path

from fastapi import FastAPI, Request
from fastapi.responses import FileResponse, JSONResponse, Response

from cloud import config, local_store
from cloud.handlers import fn_api, fn_auth

logging.basicConfig(level=logging.INFO)
log = logging.getLogger("bugforge.server")

# (method, path template as routeKey spells it, handler module)
ROUTES = [
    ("GET", "/auth/github", fn_auth),
    ("GET", "/auth/callback", fn_auth),
    ("POST", "/auth/logout", fn_auth),
    ("POST", "/forge", fn_api),
    ("GET", "/forge/{execution_id}", fn_api),
    ("GET", "/repos", fn_api),
    ("GET", "/challenges", fn_api),
    ("GET", "/challenges/{challenge_id}", fn_api),
    ("GET", "/challenges/{challenge_id}/tree", fn_api),
    ("POST", "/submissions", fn_api),
    ("GET", "/submissions/{submission_id}", fn_api),
    ("GET", "/submissions/{submission_id}/reveal", fn_api),
    ("GET", "/gaps", fn_api),
    ("GET", "/auth/me", fn_api),
    ("GET", "/me/progress", fn_api),
    ("GET", "/leaderboard", fn_api),
]

# The route-bearing application. It is mounted under /api below rather than
# served at the root, because on the Space one origin serves both this and the
# web app -- which is what lets the session cookie be first-party (see
# auth.cookie_mode()). Locally the dev server proxies /api/* here, so the
# prefix is the same in both places and no URL in the web app changes.
api = FastAPI(title="BugForge", docs_url=None, redoc_url=None, openapi_url=None)


# ---------------------------------------------------------------------------
# event translation
# ---------------------------------------------------------------------------

async def _event(request: Request, route_key: str) -> dict:
    """An API Gateway HTTP API v2 event for this request.

    Only the keys the handlers actually read are populated. `cookies` is the
    list form v2 uses and `auth.cookie()` parses; `queryStringParameters` is
    the flat dict v2 sends, with repeated keys comma-joined exactly as the real
    thing does.
    """
    query: dict[str, str] = {}
    for key in request.query_params.keys():
        values = request.query_params.getlist(key)
        query[key] = ",".join(values)

    cookies = [f"{name}={value}" for name, value in request.cookies.items()]
    body = (await request.body()).decode("utf-8", "replace")

    return {
        "version": "2.0",
        "routeKey": route_key,
        "rawPath": request.url.path,
        "headers": {k.lower(): v for k, v in request.headers.items()},
        "cookies": cookies,
        "queryStringParameters": query,
        "pathParameters": dict(request.path_params),
        "body": body,
        "isBase64Encoded": False,
        "requestContext": {
            "http": {
                "method": request.method,
                "path": request.url.path,
                "sourceIp": request.client.host if request.client else "",
            }
        },
    }


def _response(result: dict) -> Response:
    """The handler's dict, as an HTTP response.

    `cookies` is a v2-only response key -- a list of complete Set-Cookie
    values. Starlette has no way to set a raw Set-Cookie through `headers`
    (dict keys are unique), so they are appended to raw_headers instead, which
    is what lets the session and OAuth-state cookies both be set on one reply.
    """
    headers = {str(k): str(v) for k, v in (result.get("headers") or {}).items()}
    response = Response(
        content=result.get("body") or "",
        status_code=int(result.get("statusCode", 200)),
        headers=headers,
    )
    for cookie in result.get("cookies") or []:
        response.raw_headers.append((b"set-cookie", cookie.encode("latin-1")))
    return response


def _bind(method: str, template: str, module) -> None:
    route_key = f"{method} {template}"

    async def endpoint(request: Request) -> Response:
        event = await _event(request, route_key)
        return _response(module.handler(event, None))

    # The FastAPI path template and the routeKey template are the same string:
    # both spell a parameter {name}, so there is nothing to translate.
    api.add_api_route(template, endpoint, methods=[method], include_in_schema=False)


for _method, _template, _module in ROUTES:
    _bind(_method, _template, _module)


# ---------------------------------------------------------------------------
# the presigned-URL stand-in
# ---------------------------------------------------------------------------

@api.get("/files/{key:path}", include_in_schema=False)
def files(key: str) -> Response:
    """Serve one object from the local store's PUBLIC prefix. Nothing else.

    On AWS this route does not exist: the browser fetches a presigned S3 URL,
    and the grading role has no read access to `answers/` at all. Here there is
    nothing to sign with, so `local_store.generate_presigned_url` returns a
    plain link to this route -- which makes the prefix check below the thing
    that enforces "answers are never presigned". It is the whole reason the
    invariant survives the port, so it is a refusal, not a filter.
    """
    if not local_store.enabled():
        return JSONResponse({"error": "not_found"}, status_code=404)

    normalised = key.lstrip("/")
    if not normalised.startswith(config.PUBLIC_PREFIX + "/"):
        log.warning("refused a non-public key on /files: %r", key)
        return JSONResponse({"error": "forbidden"}, status_code=403)

    try:
        path = local_store.s3()._path(config.bucket(), normalised)
    except ValueError:
        # A traversal attempt; the store refuses to build the path at all.
        return JSONResponse({"error": "forbidden"}, status_code=403)
    if not path.is_file():
        return JSONResponse({"error": "not_found"}, status_code=404)

    media = "application/gzip" if path.suffix == ".gz" else "application/octet-stream"
    if path.suffix == ".json":
        media = "application/json"
    elif path.suffix == ".txt":
        media = "text/plain"
    return FileResponse(path, media_type=media)


# ---------------------------------------------------------------------------
# health
# ---------------------------------------------------------------------------

@api.get("/", include_in_schema=False)
def root() -> JSONResponse:
    """Liveness, and the few facts worth seeing when the Space wakes up."""
    return JSONResponse(
        {
            "service": "bugforge-api",
            "repo": os.environ.get("REPO_NAME", ""),
            "store": "local" if local_store.enabled() else "aws",
            "grading": "in-process" if fn_api._local_grading() else "lambda",
            "sign_in": "configured" if _sign_in_configured() else "disabled",
        }
    )


def _sign_in_configured() -> bool:
    from cloud import auth

    try:
        return bool(auth.client_id()) and bool(auth.client_secret())
    except auth.AuthError:
        return False


# ---------------------------------------------------------------------------
# startup checks
# ---------------------------------------------------------------------------
# Everything here fails the process rather than the request. All three are
# misconfigurations whose only runtime symptom is silence: a cookie the
# browser quietly discards, a sign-in that appears to do nothing, or a shared
# account nobody notices they are using. A container that refuses to start is
# the loudest this can be made, and it is loud at deploy time rather than when
# the first person tries to sign in.


class ConfigError(RuntimeError):
    """The process cannot serve safely with the environment it was given."""


def _check_config() -> None:
    from cloud import auth

    # Raises on an unrecognised BUGFORGE_COOKIE_MODE, which is the point.
    mode = auth.cookie_mode()

    if os.environ.get("BUGFORGE_LOCAL_USER") and not auth.local_user_allowed():
        raise ConfigError(
            "BUGFORGE_LOCAL_USER is set but this is not plain-http local development "
            f"(cookie mode {mode!r}"
            + (", running on a hosting platform" if auth._hosted() else "")
            + "). It would sign every visitor in as the same account, so they would "
            "share one solved history and one leaderboard row. Unset it and configure "
            "GitHub OAuth, or leave the deployment signed-out only."
        )

    if not _sign_in_configured():
        # A deployment with no OAuth app is a supported shape: every browsing
        # route works signed out. Only submitting is refused, with a 401.
        log.warning("sign-in is not configured; submitting will be refused with 401")
        return

    # Past here a visitor can actually start a sign-in, so the rest of the
    # flow has to be complete or they land on an error page mid-redirect.
    try:
        auth.signing_key()
    except auth.AuthError as e:
        raise ConfigError(
            "GitHub OAuth is configured but the session signing key is not "
            f"({e}). Set SESSION_SECRET."
        ) from None

    redirect_uri = os.environ.get("OAUTH_REDIRECT_URI", "").strip()
    web_origin = os.environ.get("WEB_ORIGIN", "").strip().rstrip("/")
    if not redirect_uri or not web_origin:
        raise ConfigError(
            "GitHub OAuth is configured but OAUTH_REDIRECT_URI and WEB_ORIGIN are not "
            "both set. GitHub compares the redirect_uri on both legs of the flow "
            "against the one registered on the OAuth app, so it cannot be derived "
            "from the request; WEB_ORIGIN is what bounds the post-sign-in redirect."
        )

    if mode != "insecure" and not redirect_uri.startswith("https://"):
        raise ConfigError(
            f"cookie mode {mode!r} sets a Secure cookie, which a browser stores only "
            f"from an https origin, but OAUTH_REDIRECT_URI is {redirect_uri!r}."
        )

    if mode == "same_origin" and not redirect_uri.startswith(f"{web_origin}/"):
        raise ConfigError(
            f"cookie mode 'same_origin' means one origin serves both the app and the "
            f"API, but OAUTH_REDIRECT_URI ({redirect_uri!r}) is not under WEB_ORIGIN "
            f"({web_origin!r}). The session cookie would be set on the API's origin "
            "and never sent by the app."
        )

    log.info("sign-in configured: cookie mode %s, callback %s", mode, redirect_uri)


_check_config()


# ---------------------------------------------------------------------------
# CORS, only if the web app is NOT proxying
# ---------------------------------------------------------------------------
# The intended deployment proxies /api/* from the web app's own origin, so the
# browser never makes a cross-origin request and no CORS headers are needed.
# BUGFORGE_CORS_ORIGIN exists for the fallback where the web app calls this
# host directly. A wildcard is refused rather than accepted: credentials and
# "*" are mutually exclusive by spec, and every request here sends the session
# cookie, so a wildcard would produce responses the browser silently discards.

_cors = os.environ.get("BUGFORGE_CORS_ORIGIN", "").strip()
if _cors == "*":
    raise RuntimeError(
        "BUGFORGE_CORS_ORIGIN='*' cannot work: every request sends credentials, "
        "and the spec forbids a wildcard with them. Name the web app's origin."
    )
if _cors:
    from fastapi.middleware.cors import CORSMiddleware

    api.add_middleware(
        CORSMiddleware,
        allow_origins=[o.strip() for o in _cors.split(",") if o.strip()],
        allow_credentials=True,
        allow_methods=["GET", "POST", "OPTIONS"],
        allow_headers=["content-type"],
    )


# ---------------------------------------------------------------------------
# the outer application: /api, then the web app
# ---------------------------------------------------------------------------
# On the Space these two are one origin. That is the whole reason the session
# cookie can be `SameSite=Lax` rather than `SameSite=None` (auth.COOKIE_FLAGS),
# and the reason there is no CORS configuration to get wrong.
#
# Locally the web app runs under `next dev` instead and proxies /api/* here, so
# BUGFORGE_WEB_DIR is unset and nothing is mounted at the root. The API lives
# under the same /api prefix either way, so no URL in the web app changes
# between local development and the deployment.

app = FastAPI(title="BugForge", docs_url=None, redoc_url=None, openapi_url=None)
app.mount("/api", api)

_web_dir = os.environ.get("BUGFORGE_WEB_DIR", "").strip()
if _web_dir:
    from fastapi.staticfiles import StaticFiles

    root_dir = Path(_web_dir)
    if not (root_dir / "index.html").is_file():
        raise ConfigError(
            f"BUGFORGE_WEB_DIR={_web_dir!r} has no index.html in it. It must point at "
            "the `next build` static export (web/out), not at the source tree."
        )
    # html=True is what makes `output: "export"` work: the app is built with
    # trailingSlash, so /repos/ has to resolve to out/repos/index.html.
    # Mounted last, because it answers every path that /api did not.
    app.mount("/", StaticFiles(directory=str(root_dir), html=True), name="web")
    log.info("serving the web app from %s", root_dir)
else:
    log.info("no BUGFORGE_WEB_DIR; serving the API only (the web app proxies to it)")

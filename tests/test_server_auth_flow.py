"""A whole sign-in, driven through server/app.py's ASGI app.

tests/test_auth.py already covers fn_auth's two legs by calling them directly.
What it cannot cover is the seam the port introduced: the handlers answer with
API Gateway v2's `cookies` list, and server/app.py has to turn that into real
Set-Cookie headers and turn the browser's Cookie header back into that list.
The callback leg sets *two* cookies on one response -- it clears the OAuth
state and plants the session -- which is precisely the case a dict of headers
cannot express, so it is the one most likely to have been quietly lost.

Only the two functions that talk to github.com are replaced. The state token,
its signature, the session minting, and fn_api reading that session back on a
later request are all the real thing.
"""
from __future__ import annotations

import json
import urllib.parse
from http.cookies import SimpleCookie

import pytest

from cloud import auth

server_app = pytest.importorskip("server.app")

USER = {"id": 4242, "login": "octocat", "avatar_url": "https://avatars/o.png"}
ORIGIN = "https://aarushi-bugforge.hf.space"


@pytest.fixture
def browser(monkeypatch):
    """A cookie jar that speaks to the ASGI app the way a browser would."""
    monkeypatch.setenv("BUCKET", "b")
    monkeypatch.setenv("REPO_NAME", "jd__tenacity")
    monkeypatch.setenv("REPO_URL", "https://github.com/jd/tenacity")
    for name in ("CHALLENGES", "GAPS", "SUBMISSIONS", "LEADERBOARD", "PROGRESS"):
        monkeypatch.setenv(f"TABLE_{name}", name.lower())
    monkeypatch.setenv("BUGFORGE_COOKIE_MODE", "same_origin")
    monkeypatch.setenv("GITHUB_CLIENT_ID", "Ov23liREAL")
    monkeypatch.setenv("GITHUB_CLIENT_SECRET", "shh")
    monkeypatch.setenv("SESSION_SECRET", "signing-key")
    monkeypatch.setenv("WEB_ORIGIN", ORIGIN)
    monkeypatch.setenv("OAUTH_REDIRECT_URI", f"{ORIGIN}/api/auth/callback")
    monkeypatch.delenv("BUGFORGE_LOCAL_USER", raising=False)
    monkeypatch.delenv("SPACE_ID", raising=False)

    monkeypatch.setattr(auth, "exchange_code", lambda code, uri: f"token-for-{code}")
    monkeypatch.setattr(auth, "fetch_user", lambda token: dict(USER))

    return _Browser()


class _Browser:
    def __init__(self) -> None:
        self.jar: dict[str, str] = {}

    def __call__(self, method: str, path: str) -> dict:
        import asyncio

        return asyncio.run(self._call(method, path))

    async def _call(self, method: str, path: str) -> dict:
        header_cookie = "; ".join(f"{k}={v}" for k, v in self.jar.items())
        scope = {
            "type": "http",
            "asgi": {"version": "3.0"},
            "http_version": "1.1",
            "method": method,
            "scheme": "https",
            "path": path.split("?")[0],
            "raw_path": path.encode(),
            "query_string": path.partition("?")[2].encode(),
            "root_path": "",
            "client": ("127.0.0.1", 1),
            "server": ("testserver", 443),
            "headers": [(b"host", b"testserver")]
            + ([(b"cookie", header_cookie.encode())] if header_cookie else []),
        }
        result = {"status": None, "headers": [], "body": b""}

        async def receive():
            return {"type": "http.request", "body": b"", "more_body": False}

        async def send(message):
            if message["type"] == "http.response.start":
                result["status"] = message["status"]
                result["headers"] = message["headers"]
            elif message["type"] == "http.response.body":
                result["body"] += message.get("body", b"")

        await server_app.app(scope, receive, send)

        # Store and expire cookies the way a browser does, so a later request
        # carries exactly what the earlier response actually managed to set.
        for key, value in result["headers"]:
            if key.lower() == b"set-cookie":
                jar = SimpleCookie()
                jar.load(value.decode())
                for name, morsel in jar.items():
                    if morsel["max-age"] == "0":
                        self.jar.pop(name, None)
                    else:
                        self.jar[name] = morsel.value

        result["location"] = {
            k.decode().lower(): v.decode() for k, v in result["headers"]
        }.get("location", "")
        return result


def _start(browser) -> str:
    """Leg one, returning the state GitHub would echo back."""
    response = browser("GET", "/auth/github")
    assert response["status"] == 302
    query = urllib.parse.parse_qs(urllib.parse.urlparse(response["location"]).query)
    return query["state"][0]


def test_the_state_cookie_survives_the_redirect_to_github(browser):
    state = _start(browser)
    # Both copies must exist and match, or verify_state refuses the callback.
    assert browser.jar["bf_oauth_state"] == state


def test_a_whole_sign_in_leaves_the_browser_signed_in(browser):
    state = _start(browser)

    response = browser("GET", f"/auth/callback?code=abc123&state={urllib.parse.quote(state)}")
    assert response["status"] == 302
    assert response["location"].startswith(ORIGIN)
    assert "signed_in=1" in response["location"]

    # The one response cleared the state cookie AND set the session. A dict of
    # headers can hold only one Set-Cookie, so losing either is the failure
    # this test exists for.
    assert "bf_oauth_state" not in browser.jar
    assert "bf_session" in browser.jar

    body = json.loads(browser("GET", "/auth/me")["body"])
    assert body["user"] == {
        "user_id": "gh:4242",
        "login": "octocat",
        "avatar_url": "https://avatars/o.png",
    }


def test_the_session_is_accepted_by_the_gated_route(browser):
    state = _start(browser)
    browser("GET", f"/auth/callback?code=abc123&state={urllib.parse.quote(state)}")

    # 400 rather than 401: the empty body is rejected on its merits, which
    # means the request got past the session gate.
    response = browser("POST", "/submissions")
    assert response["status"] == 400


def test_logging_out_drops_the_session(browser):
    state = _start(browser)
    browser("GET", f"/auth/callback?code=abc123&state={urllib.parse.quote(state)}")

    browser("POST", "/auth/logout")
    assert "bf_session" not in browser.jar
    assert json.loads(browser("GET", "/auth/me")["body"])["user"] is None
    assert browser("POST", "/submissions")["status"] == 401


def test_a_session_signed_with_another_key_is_not_a_session(browser):
    browser.jar["bf_session"] = auth.make_session({"id": 1, "login": "attacker"}, b"wrong-key")
    assert json.loads(browser("GET", "/auth/me")["body"])["user"] is None
    assert browser("POST", "/submissions")["status"] == 401


def test_a_callback_without_the_state_cookie_signs_nobody_in(browser):
    """The CSRF case: an attacker's own code, completed in a victim's browser,
    would silently attach the victim's submissions to the attacker's account."""
    state = _start(browser)
    browser.jar.clear()

    response = browser("GET", f"/auth/callback?code=abc123&state={urllib.parse.quote(state)}")
    assert response["status"] == 302
    assert "auth_error=" in response["location"]
    assert "bf_session" not in browser.jar


def test_cancelling_at_github_just_goes_home(browser):
    _start(browser)
    response = browser("GET", "/auth/callback?error=access_denied")
    assert response["status"] == 302
    assert "auth_error=" not in response["location"]
    assert "bf_session" not in browser.jar

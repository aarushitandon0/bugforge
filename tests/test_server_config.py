"""The startup checks in server/app.py.

Everything checked here is a misconfiguration whose only runtime symptom is
silence: a cookie the browser discards, a sign-in that appears to do nothing,
or one shared account nobody notices they are using. The process refuses to
start instead, so the failure lands at deploy time rather than on the first
person who tries to sign in.
"""
from __future__ import annotations

import pytest

server_app = pytest.importorskip("server.app")


@pytest.fixture
def clean(monkeypatch):
    """No auth configured at all -- the supported signed-out-only shape."""
    for name in (
        "BUGFORGE_COOKIE_MODE",
        "BUGFORGE_INSECURE_COOKIES",
        "BUGFORGE_LOCAL_USER",
        "SPACE_ID",
        "K_SERVICE",
        "GITHUB_CLIENT_ID",
        "GITHUB_CLIENT_SECRET",
        "GITHUB_CLIENT_ID_SECRET_ARN",
        "GITHUB_CLIENT_SECRET_ARN",
        "GITHUB_CLIENT_ID_SECRET_ARN_VALUE",
        "GITHUB_CLIENT_SECRET_ARN_VALUE",
        "SESSION_SECRET",
        "SESSION_SIGNING_SECRET_ARN",
        "SESSION_SIGNING_SECRET_ARN_VALUE",
        "OAUTH_REDIRECT_URI",
        "WEB_ORIGIN",
    ):
        monkeypatch.delenv(name, raising=False)


@pytest.fixture
def signed_in_deploy(clean, monkeypatch):
    """A complete same-origin HTTPS sign-in configuration."""
    monkeypatch.setenv("BUGFORGE_COOKIE_MODE", "same_origin")
    monkeypatch.setenv("GITHUB_CLIENT_ID", "Ov23liREAL")
    monkeypatch.setenv("GITHUB_CLIENT_SECRET", "shh")
    monkeypatch.setenv("SESSION_SECRET", "signing")
    monkeypatch.setenv("WEB_ORIGIN", "https://aarushi-bugforge.hf.space")
    monkeypatch.setenv(
        "OAUTH_REDIRECT_URI", "https://aarushi-bugforge.hf.space/api/auth/callback"
    )


def test_no_auth_at_all_starts_fine(clean):
    # Browsing works signed out; only submitting is refused, with a 401.
    server_app._check_config()


def test_a_complete_configuration_starts_fine(signed_in_deploy):
    server_app._check_config()


def test_a_typo_in_the_cookie_mode_stops_the_process(clean, monkeypatch):
    monkeypatch.setenv("BUGFORGE_COOKIE_MODE", "sameorigin")
    with pytest.raises(Exception):
        server_app._check_config()


def test_the_dev_identity_stops_a_deployment_from_starting(clean, monkeypatch):
    monkeypatch.setenv("BUGFORGE_COOKIE_MODE", "same_origin")
    monkeypatch.setenv("BUGFORGE_LOCAL_USER", "local-dev")
    with pytest.raises(server_app.ConfigError, match="BUGFORGE_LOCAL_USER"):
        server_app._check_config()


def test_the_dev_identity_is_fine_on_plain_http_local(clean, monkeypatch):
    monkeypatch.setenv("BUGFORGE_COOKIE_MODE", "insecure")
    monkeypatch.setenv("BUGFORGE_LOCAL_USER", "local-dev")
    server_app._check_config()


def test_the_dev_identity_stops_a_space_even_on_insecure_cookies(clean, monkeypatch):
    monkeypatch.setenv("BUGFORGE_COOKIE_MODE", "insecure")
    monkeypatch.setenv("BUGFORGE_LOCAL_USER", "local-dev")
    monkeypatch.setenv("SPACE_ID", "someone/bugforge")
    with pytest.raises(server_app.ConfigError, match="BUGFORGE_LOCAL_USER"):
        server_app._check_config()


def test_oauth_without_a_signing_key_stops_the_process(signed_in_deploy, monkeypatch):
    # Sign-in would redirect to GitHub and then fail on the way back, after
    # the person has already approved the app.
    monkeypatch.delenv("SESSION_SECRET")
    with pytest.raises(server_app.ConfigError, match="SESSION_SECRET"):
        server_app._check_config()


@pytest.mark.parametrize("missing", ["OAUTH_REDIRECT_URI", "WEB_ORIGIN"])
def test_oauth_without_its_urls_stops_the_process(signed_in_deploy, monkeypatch, missing):
    monkeypatch.delenv(missing)
    with pytest.raises(server_app.ConfigError, match="OAUTH_REDIRECT_URI"):
        server_app._check_config()


def test_a_secure_cookie_with_an_http_callback_stops_the_process(
    signed_in_deploy, monkeypatch
):
    # The browser would refuse to store the session cookie and sign-in would
    # silently do nothing.
    monkeypatch.setenv("WEB_ORIGIN", "http://example.test")
    monkeypatch.setenv("OAUTH_REDIRECT_URI", "http://example.test/api/auth/callback")
    with pytest.raises(server_app.ConfigError, match="https"):
        server_app._check_config()


def test_same_origin_with_a_callback_on_another_host_stops_the_process(
    signed_in_deploy, monkeypatch
):
    # The session cookie would be set on the API's origin and never sent by
    # the app -- the exact failure `same_origin` is claiming does not happen.
    monkeypatch.setenv("OAUTH_REDIRECT_URI", "https://some-api.example/auth/callback")
    with pytest.raises(server_app.ConfigError, match="same_origin"):
        server_app._check_config()


def test_cross_site_does_not_demand_one_origin(signed_in_deploy, monkeypatch):
    # On AWS the app and the API are meant to be on different domains.
    monkeypatch.setenv("BUGFORGE_COOKIE_MODE", "cross_site")
    monkeypatch.setenv("OAUTH_REDIRECT_URI", "https://some-api.example/auth/callback")
    server_app._check_config()

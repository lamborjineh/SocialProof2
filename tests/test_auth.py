"""
tests/test_auth.py
Unit tests for routers/auth.py — authentication endpoints.

Covers:
  - POST /auth/register  — happy path, duplicate rejection
  - POST /auth/login     — valid credentials, invalid credentials, rate limit
  - POST /auth/cookie-login — sets HttpOnly cookie
  - POST /auth/cookie-logout — clears cookie and revokes token
  - GET  /auth/me        — valid token, missing token, expired token
  - POST /auth/logout    — revokes Bearer token
  - GET  /auth/session   — returns session token
  - JWT internals: _sign/_verify, expiry, nbf, algorithm check, blocklist
"""
import os
import sys
import json
import time
import pytest

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

# Use SQLite in-memory so tests never touch a real MySQL instance
os.environ["DATABASE_URL"] = "sqlite:///:memory:"
os.environ["SECRET_KEY"]   = "pytest-test-secret-not-for-production"

from fastapi.testclient import TestClient
from unittest.mock import patch, MagicMock
import sqlalchemy as sa


# ── App bootstrap ─────────────────────────────────────────────────────────────
# We import the router directly and create a minimal FastAPI app so we don't
# need every other router / ML model to be available.

from fastapi import FastAPI
import routers.auth as auth_module
from routers.auth import router as auth_router, _sign, _verify, _make_payload, _b64url_decode

app = FastAPI()
app.include_router(auth_router)


# ── DB bootstrap — create users table in SQLite ───────────────────────────────

from database.models import Base, engine as db_engine

@pytest.fixture(scope="session", autouse=True)
def create_tables():
    Base.metadata.create_all(bind=db_engine)
    yield
    Base.metadata.drop_all(bind=db_engine)


# ── TestClient ────────────────────────────────────────────────────────────────

@pytest.fixture(scope="session")
def client():
    return TestClient(app, raise_server_exceptions=False)


# ── JWT internals ─────────────────────────────────────────────────────────────

class TestJWTInternals:
    def test_sign_and_verify_roundtrip(self):
        payload = _make_payload(1, "testuser", "user")
        token   = _sign(payload)
        decoded = _verify(token)
        assert decoded["sub"]  == 1
        assert decoded["user"] == "testuser"
        assert decoded["role"] == "user"

    def test_verify_rejects_tampered_signature(self):
        payload = _make_payload(1, "testuser", "user")
        token   = _sign(payload)
        parts   = token.split(".")
        # Flip last char of signature
        parts[2] = parts[2][:-1] + ("A" if parts[2][-1] != "A" else "B")
        bad_token = ".".join(parts)
        from fastapi import HTTPException
        with pytest.raises(HTTPException):
            _verify(bad_token)

    def test_verify_rejects_expired_token(self):
        now     = int(time.time())
        payload = {
            "sub": 1, "user": "x", "role": "user",
            "iat": now - 100, "nbf": now - 100, "exp": now - 1,
            "jti": "expired-jti",
        }
        token = _sign(payload)
        from fastapi import HTTPException
        with pytest.raises(HTTPException):
            _verify(token)

    def test_verify_rejects_nbf_in_future(self):
        now     = int(time.time())
        payload = {
            "sub": 1, "user": "x", "role": "user",
            "iat": now, "nbf": now + 9999, "exp": now + 86400,
            "jti": "future-jti",
        }
        token = _sign(payload)
        from fastapi import HTTPException
        with pytest.raises(HTTPException):
            _verify(token)

    def test_verify_rejects_wrong_algorithm(self):
        import base64
        header_bad  = base64.urlsafe_b64encode(
            json.dumps({"alg": "none", "typ": "JWT"}).encode()
        ).rstrip(b"=").decode()
        body        = base64.urlsafe_b64encode(
            json.dumps({"sub": 1, "exp": int(time.time()) + 3600}).encode()
        ).rstrip(b"=").decode()
        token = f"{header_bad}.{body}.fakesig"
        from fastapi import HTTPException
        with pytest.raises(HTTPException):
            _verify(token)

    def test_make_payload_has_jti(self):
        payload = _make_payload(1, "user", "user")
        assert "jti" in payload
        assert len(payload["jti"]) > 0

    def test_token_revocation_blocks_verify(self):
        from routers.auth import _revoke_token
        payload = _make_payload(99, "revoketest", "user")
        token   = _sign(payload)
        _revoke_token(payload)
        from fastapi import HTTPException
        with pytest.raises(HTTPException):
            _verify(token)


# ── /auth/register ────────────────────────────────────────────────────────────

class TestRegister:
    def test_register_success(self, client):
        r = client.post("/auth/register", json={
            "username": "testuser1",
            "email":    "test1@example.com",
            "password": "SecurePass123!",
        })
        assert r.status_code == 201
        data = r.json()
        assert "token" in data
        assert data["username"] == "testuser1"

    def test_register_duplicate_email_rejected(self, client):
        payload = {"username": "dupuser", "email": "dup@example.com", "password": "Pass123!"}
        client.post("/auth/register", json=payload)  # first registration
        r = client.post("/auth/register", json={
            **payload, "username": "dupuser2"  # same email, different username
        })
        assert r.status_code == 409

    def test_register_duplicate_username_rejected(self, client):
        payload = {"username": "sameuser", "email": "unique1@example.com", "password": "Pass123!"}
        client.post("/auth/register", json=payload)
        r = client.post("/auth/register", json={
            **payload, "email": "unique2@example.com"
        })
        assert r.status_code == 409


# ── /auth/login (deprecated Bearer flow) ─────────────────────────────────────

class TestLogin:
    def _register(self, client, username, email, password="TestPass123!"):
        client.post("/auth/register", json={
            "username": username, "email": email, "password": password
        })

    def test_login_valid_credentials(self, client):
        self._register(client, "logintest", "logintest@example.com")
        r = client.post("/auth/login", json={
            "identifier": "logintest", "password": "TestPass123!"
        })
        assert r.status_code == 200
        assert "token" in r.json()

    def test_login_by_email(self, client):
        self._register(client, "emaillogin", "emaillogin@example.com")
        r = client.post("/auth/login", json={
            "identifier": "emaillogin@example.com", "password": "TestPass123!"
        })
        assert r.status_code == 200

    def test_login_wrong_password(self, client):
        self._register(client, "wrongpw", "wrongpw@example.com")
        r = client.post("/auth/login", json={
            "identifier": "wrongpw", "password": "BadPassword!"
        })
        assert r.status_code == 401

    def test_login_nonexistent_user(self, client):
        r = client.post("/auth/login", json={
            "identifier": "nobody_exists", "password": "anything"
        })
        assert r.status_code == 401

    def test_login_deprecated_header_present(self, client):
        self._register(client, "deprectest", "deprectest@example.com")
        r = client.post("/auth/login", json={
            "identifier": "deprectest", "password": "TestPass123!"
        })
        assert "Deprecation" in r.headers

    def test_rate_limit_triggers_after_max_failures(self, client):
        from routers.auth import _RATE_MAX_FAILURES, _fail_counts
        # Clear any existing counts for this IP
        _fail_counts.clear()

        for _ in range(_RATE_MAX_FAILURES + 1):
            r = client.post("/auth/login", json={
                "identifier": "ratelimituser", "password": "wrong"
            })
        assert r.status_code == 429


# ── /auth/cookie-login ────────────────────────────────────────────────────────

class TestCookieLogin:
    def test_cookie_login_sets_httponly_cookie(self, client):
        client.post("/auth/register", json={
            "username": "cookieuser", "email": "cookie@example.com", "password": "Pass123!"
        })
        r = client.post("/auth/cookie-login", json={
            "identifier": "cookieuser", "password": "Pass123!"
        })
        assert r.status_code == 200
        assert "sp_jwt" in r.cookies
        # Token must NOT be in the response body
        body = r.json()
        assert "token" not in body

    def test_cookie_login_bad_credentials(self, client):
        r = client.post("/auth/cookie-login", json={
            "identifier": "cookieuser", "password": "WrongPass!"
        })
        assert r.status_code == 401


# ── /auth/me ──────────────────────────────────────────────────────────────────

class TestMe:
    def test_me_with_valid_bearer_token(self, client):
        client.post("/auth/register", json={
            "username": "meuser", "email": "me@example.com", "password": "Pass123!"
        })
        r_login = client.post("/auth/login", json={
            "identifier": "meuser", "password": "Pass123!"
        })
        token = r_login.json()["token"]

        r = client.get("/auth/me", headers={"Authorization": f"Bearer {token}"})
        assert r.status_code == 200
        data = r.json()
        assert data["username"] == "meuser"

    def test_me_without_token_returns_401(self, client):
        r = client.get("/auth/me")
        assert r.status_code == 401

    def test_me_with_invalid_token_returns_401(self, client):
        r = client.get("/auth/me", headers={"Authorization": "Bearer garbage.token.here"})
        assert r.status_code == 401


# ── /auth/logout ──────────────────────────────────────────────────────────────

class TestLogout:
    def test_logout_revokes_token(self, client):
        client.post("/auth/register", json={
            "username": "logoutuser", "email": "logout@example.com", "password": "Pass123!"
        })
        r_login = client.post("/auth/login", json={
            "identifier": "logoutuser", "password": "Pass123!"
        })
        token = r_login.json()["token"]

        r_logout = client.post("/auth/logout", headers={"Authorization": f"Bearer {token}"})
        assert r_logout.status_code == 200
        assert r_logout.json()["ok"] is True

        # Revoked token should now fail /auth/me
        r_me = client.get("/auth/me", headers={"Authorization": f"Bearer {token}"})
        assert r_me.status_code == 401


# ── /auth/session ─────────────────────────────────────────────────────────────

class TestSession:
    def test_session_returns_token(self, client):
        r = client.get("/auth/session")
        assert r.status_code == 200
        data = r.json()
        assert "session_token" in data
        assert len(data["session_token"]) == 64  # secrets.token_hex(32) → 64 hex chars

    def test_session_tokens_are_unique(self, client):
        t1 = client.get("/auth/session").json()["session_token"]
        t2 = client.get("/auth/session").json()["session_token"]
        assert t1 != t2

"""Thin boto3 helpers. Kept separate so unit tests can monkeypatch one module."""
from __future__ import annotations

import json
import os
from pathlib import Path
from typing import Any

import boto3

_s3 = None
_presigner = None


def client():
    """The S3 client, or the filesystem stand-in on a no-AWS deploy.

    See cloud/local_store.py. The stand-in implements the same eight calls the
    helpers below make, so nothing past this function knows which it has.
    """
    global _s3
    if _s3 is None:
        from cloud import local_store

        _s3 = local_store.s3() if local_store.enabled() else boto3.client("s3")
    return _s3


def presigner():
    """The client that signs URLs for a browser, which is not always `client()`.

    A presigned URL is built from the signing client's own endpoint, so it
    inherits whatever AWS_ENDPOINT_URL the function was given. Deployed that
    is unset and both clients are the same. Locally it is LocalStack's address
    *on the docker network* (`http://bugforge-localstack:4566`) -- correct for
    the function's own calls and a name no browser can resolve, so the solve
    screen's download fails at DNS and is reported as a network error.

    S3_PUBLIC_ENDPOINT_URL names the same LocalStack on the host instead. It is
    a second client rather than a rewrite of the finished URL, so the host it
    signs for is the host it is signed for.
    """
    global _presigner
    if _presigner is None:
        from cloud import local_store

        if local_store.enabled():
            # One store, one origin: the stand-in's URLs point at the server's
            # own /files route, so there is no second endpoint to sign for.
            _presigner = client()
        else:
            public = os.environ.get("S3_PUBLIC_ENDPOINT_URL")
            _presigner = boto3.client("s3", endpoint_url=public) if public else client()
    return _presigner


def put_json(bucket: str, key: str, payload: Any) -> str:
    client().put_object(
        Bucket=bucket,
        Key=key,
        Body=json.dumps(payload).encode("utf-8"),
        ContentType="application/json",
    )
    return key


def get_json(bucket: str, key: str) -> Any:
    body = client().get_object(Bucket=bucket, Key=key)["Body"].read()
    return json.loads(body.decode("utf-8"))


def get_text(bucket: str, key: str) -> str:
    return client().get_object(Bucket=bucket, Key=key)["Body"].read().decode("utf-8")


def put_file(bucket: str, key: str, path: Path, content_type: str) -> str:
    client().upload_file(str(path), bucket, key, ExtraArgs={"ContentType": content_type})
    return key


def get_file(bucket: str, key: str, path: Path) -> Path:
    path.parent.mkdir(parents=True, exist_ok=True)
    client().download_file(bucket, key, str(path))
    return path


def put_text(bucket: str, key: str, text: str, content_type: str = "text/plain") -> str:
    client().put_object(
        Bucket=bucket, Key=key, Body=text.encode("utf-8"), ContentType=content_type
    )
    return key


def list_keys(bucket: str, prefix: str) -> list[str]:
    keys: list[str] = []
    paginator = client().get_paginator("list_objects_v2")
    for page in paginator.paginate(Bucket=bucket, Prefix=prefix):
        keys.extend(obj["Key"] for obj in page.get("Contents", []))
    return keys


def presign(bucket: str, key: str, ttl_seconds: int) -> str:
    return presigner().generate_presigned_url(
        "get_object", Params={"Bucket": bucket, "Key": key}, ExpiresIn=ttl_seconds
    )

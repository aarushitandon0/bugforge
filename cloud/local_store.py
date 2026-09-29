"""Filesystem + SQLite stand-ins for S3 and DynamoDB, for the no-AWS deploy.

BugForge's cloud helpers touch AWS through exactly two seams: `s3_io.client()`
returns a boto3 S3 client, and `ddb_io.table()` returns a boto3 DynamoDB Table
resource. This module supplies an object of each shape, backed by a directory
and a SQLite file, so *no call site changes at all* -- the handlers, the grader
and the API make the same calls they make against real AWS.

Enabled by setting BUGFORGE_LOCAL_STORE to a directory. Unset, nothing here is
constructed and the real clients are used, so a real deployment cannot fall
into this path even if the module is present.

What is deliberately NOT emulated: anything no call site uses. There is no
BatchWrite, no sort-key range condition, no projection, no filter expression,
and no pagination -- every scan and query answers in one page, which is legal
and is what the `LastEvaluatedKey` loops in fn_api already expect. A future
call site needing one of those fails loudly here rather than quietly returning
the wrong rows.

boto3 is still imported, but only for two things that are pure data: the
`Key(...)` condition objects that progress.py and fn_api.py build, and the
`ClientError` a failed conditional write must raise. No client is ever
constructed and no credentials are ever needed.
"""
from __future__ import annotations

import json
import os
import shutil
import sqlite3
import threading
import urllib.parse
from decimal import Decimal
from pathlib import Path
from typing import Any

from botocore.exceptions import ClientError


def enabled() -> bool:
    return bool(os.environ.get("BUGFORGE_LOCAL_STORE"))


def root() -> Path:
    path = Path(os.environ["BUGFORGE_LOCAL_STORE"])
    path.mkdir(parents=True, exist_ok=True)
    return path


# ---------------------------------------------------------------------------
# JSON with Decimals
# ---------------------------------------------------------------------------
# ddb_io.to_ddb turns every float into a Decimal before it reaches us, because
# that is what the real resource API demands. SQLite has no Decimal, so they
# are written as plain JSON numbers and read back as int/float -- exactly what
# ddb_io.from_ddb would have produced from a Decimal, so call sites see no
# difference.

class _DecimalEncoder(json.JSONEncoder):
    def default(self, o: Any) -> Any:
        if isinstance(o, Decimal):
            as_int = int(o)
            return as_int if o == as_int else float(o)
        if isinstance(o, (set, frozenset)):
            return sorted(o)
        return super().default(o)


def _dumps(item: dict) -> str:
    return json.dumps(item, cls=_DecimalEncoder)


def _number(value: Any) -> Any:
    """A Decimal from an UpdateExpression value, as a plain number."""
    if isinstance(value, Decimal):
        as_int = int(value)
        return as_int if value == as_int else float(value)
    return value


# ---------------------------------------------------------------------------
# S3 -> a directory
# ---------------------------------------------------------------------------
# Keys become paths under <root>/s3/<bucket>/. Real keys contain slashes and no
# "..", so the join is safe, but it is checked anyway: this same tree holds the
# answers prefix, and a traversal out of it is the one bug here that would
# actually matter.

class _Body:
    def __init__(self, raw: bytes) -> None:
        self._raw = raw

    def read(self) -> bytes:
        return self._raw


class _Paginator:
    def __init__(self, store: "LocalS3") -> None:
        self._store = store

    def paginate(self, Bucket: str, Prefix: str = "", **_: Any):
        yield {"Contents": [{"Key": k} for k in self._store.list(Bucket, Prefix)]}


class LocalS3:
    """The subset of the boto3 S3 client that cloud/s3_io.py calls."""

    def __init__(self, base: Path) -> None:
        self._base = base
        self._base.mkdir(parents=True, exist_ok=True)

    def _path(self, bucket: str, key: str) -> Path:
        bucket_root = (self._base / bucket).resolve()
        target = (bucket_root / key).resolve()
        if target != bucket_root and bucket_root not in target.parents:
            raise ValueError(f"key escapes the bucket directory: {key!r}")
        return target

    def list(self, bucket: str, prefix: str) -> list[str]:
        bucket_root = self._base / bucket
        if not bucket_root.is_dir():
            return []
        keys = [
            p.relative_to(bucket_root).as_posix()
            for p in bucket_root.rglob("*")
            if p.is_file()
        ]
        return sorted(k for k in keys if k.startswith(prefix))

    # -- the boto3 surface ---------------------------------------------------

    def put_object(self, Bucket: str, Key: str, Body: Any, ContentType: str = "") -> dict:
        path = self._path(Bucket, Key)
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_bytes(Body if isinstance(Body, bytes) else str(Body).encode("utf-8"))
        return {}

    def get_object(self, Bucket: str, Key: str) -> dict:
        path = self._path(Bucket, Key)
        if not path.is_file():
            raise ClientError(
                {"Error": {"Code": "NoSuchKey", "Message": "no such key: " + Key}}, "GetObject"
            )
        return {"Body": _Body(path.read_bytes())}

    def upload_file(
        self, filename: str, bucket: str, key: str, ExtraArgs: dict | None = None
    ) -> None:
        path = self._path(bucket, key)
        path.parent.mkdir(parents=True, exist_ok=True)
        shutil.copyfile(filename, path)

    def download_file(self, bucket: str, key: str, filename: str) -> None:
        path = self._path(bucket, key)
        if not path.is_file():
            raise ClientError(
                {"Error": {"Code": "404", "Message": "no such key: " + key}}, "HeadObject"
            )
        Path(filename).parent.mkdir(parents=True, exist_ok=True)
        shutil.copyfile(path, filename)

    def get_paginator(self, name: str) -> _Paginator:
        if name != "list_objects_v2":
            raise NotImplementedError("paginator " + repr(name) + " is not emulated")
        return _Paginator(self)

    def generate_presigned_url(self, operation: str, Params: dict, ExpiresIn: int) -> str:
        """A plain URL to the server's own /files route -- no signature.

        There is nothing to sign with and nothing that needs signing: the route
        serves the `public/` prefix only and refuses everything else, so the
        "answers are never presigned" invariant is enforced by the route rather
        than by the URL. ExpiresIn is accepted and ignored -- these URLs do not
        expire, which is why that prefix check is load-bearing.
        """
        base = os.environ.get("BUGFORGE_PUBLIC_BASE", "").rstrip("/")
        return base + "/files/" + urllib.parse.quote(Params["Key"])


# ---------------------------------------------------------------------------
# DynamoDB -> SQLite
# ---------------------------------------------------------------------------
# One SQLite table per DynamoDB table, each row a JSON document keyed by the
# same hash (and optional range) key the real table uses. The key columns and
# any indexed attribute are stored as real columns beside the document, so a
# query uses an index instead of reading every row back through json.

_KEYS: dict[str, tuple[str, str | None]] = {
    # logical kind -> (hash key, range key)
    "challenges": ("challenge_id", None),
    "submissions": ("submission_id", None),
    "gaps": ("gap_id", None),
    "progress": ("user_id", "challenge_id"),
    "leaderboard": ("user_id", None),
}

# Attributes a GSI is queried by. Only repo_index exists, on challenges and gaps.
_INDEXED = ("repo",)


def _kind_of(table_name: str) -> str:
    """Map a configured table name back to its logical kind.

    Table names come from the environment (TABLE_CHALLENGES and friends) and
    carry a stack prefix in a real deployment, so the match is on a suffix
    rather than on equality.
    """
    lowered = table_name.lower()
    for kind in _KEYS:
        if lowered.endswith(kind) or ("-" + kind + "-") in lowered or ("_" + kind + "_") in lowered:
            return kind
    raise KeyError(
        "table " + repr(table_name) + " does not name a known kind ("
        + ", ".join(_KEYS) + "); the local store needs its key schema declared "
        "in cloud/local_store.py"
    )


class _Db:
    """One SQLite file, one connection per thread.

    A connection cannot be shared across threads, and grading runs on a
    background thread while request threads read, so each thread opens its own.
    WAL keeps a long grading write from blocking those reads.
    """

    def __init__(self, path: Path) -> None:
        self._path = path
        self._local = threading.local()
        self._created: set[str] = set()
        self._lock = threading.Lock()

    def conn(self) -> sqlite3.Connection:
        existing = getattr(self._local, "conn", None)
        if existing is None:
            self._path.parent.mkdir(parents=True, exist_ok=True)
            existing = sqlite3.connect(self._path, timeout=30, isolation_level=None)
            existing.execute("PRAGMA journal_mode=WAL")
            existing.execute("PRAGMA busy_timeout=30000")
            self._local.conn = existing
        return existing

    def ensure(self, physical: str, kind: str) -> None:
        if physical in self._created:
            return
        with self._lock:
            hash_key, range_key = _KEYS[kind]
            primary = [hash_key] + ([range_key] if range_key else [])
            columns = [name + " TEXT NOT NULL" for name in primary]
            columns.append("doc TEXT NOT NULL")
            extra = [a for a in _INDEXED if a not in primary]
            columns.extend(a + " TEXT" for a in extra)
            conn = self.conn()
            conn.execute(
                'CREATE TABLE IF NOT EXISTS "' + physical + '" ('
                + ", ".join(columns)
                + ", PRIMARY KEY (" + ", ".join(primary) + "))"
            )
            for attribute in extra:
                conn.execute(
                    'CREATE INDEX IF NOT EXISTS "' + physical + "_" + attribute + '" '
                    'ON "' + physical + '" (' + attribute + ")"
                )
            self._created.add(physical)


class LocalTable:
    """The subset of the boto3 DynamoDB Table resource that this codebase calls."""

    def __init__(self, db: _Db, name: str) -> None:
        self._db = db
        self._name = name
        self._kind = _kind_of(name)
        self._hash, self._range = _KEYS[self._kind]
        self._primary = [self._hash] + ([self._range] if self._range else [])
        db.ensure(name, self._kind)

    # -- helpers -------------------------------------------------------------

    def _columns(self, item: dict) -> tuple[list[str], list[Any]]:
        names = list(self._primary)
        values: list[Any] = [str(item[n]) for n in names]
        names.append("doc")
        values.append(_dumps(item))
        for attribute in _INDEXED:
            if attribute not in self._primary:
                names.append(attribute)
                value = item.get(attribute)
                values.append(None if value is None else str(value))
        return names, values

    def _key_where(self, key: dict) -> tuple[str, list[Any]]:
        missing = [n for n in self._primary if n not in key]
        if missing:
            raise ValueError("key for " + self._name + " is missing " + repr(missing))
        return (
            " AND ".join(n + " = ?" for n in self._primary),
            [str(key[n]) for n in self._primary],
        )

    # -- the boto3 surface ---------------------------------------------------

    def put_item(self, Item: dict, ConditionExpression: str | None = None) -> dict:
        conn = self._db.conn()
        if ConditionExpression is not None:
            # progress.py writes the only conditional in the codebase:
            # attribute_not_exists(<range key>), meaning "first solve only".
            # Nothing else is supported, and a different condition must not be
            # silently treated as this one.
            expected = "attribute_not_exists(" + (self._range or "") + ")"
            if self._range is None or ConditionExpression.replace(" ", "") != expected:
                raise NotImplementedError(
                    "condition " + repr(ConditionExpression)
                    + " is not emulated for " + self._name
                )
            where, key_values = self._key_where(Item)
            row = conn.execute(
                'SELECT 1 FROM "' + self._name + '" WHERE ' + where, key_values
            ).fetchone()
            if row is not None:
                raise ClientError(
                    {
                        "Error": {
                            "Code": "ConditionalCheckFailedException",
                            "Message": "the conditional request failed",
                        }
                    },
                    "PutItem",
                )
        names, values = self._columns(Item)
        conn.execute(
            'INSERT OR REPLACE INTO "' + self._name + '" (' + ", ".join(names) + ") "
            "VALUES (" + ", ".join("?" for _ in names) + ")",
            values,
        )
        return {}

    def get_item(self, Key: dict) -> dict:
        where, values = self._key_where(Key)
        row = self._db.conn().execute(
            'SELECT doc FROM "' + self._name + '" WHERE ' + where, values
        ).fetchone()
        return {"Item": json.loads(row[0])} if row else {}

    def scan(self, **kwargs: Any) -> dict:
        unsupported = set(kwargs) - {"ExclusiveStartKey"}
        if unsupported:
            raise NotImplementedError(
                "scan(" + ", ".join(sorted(unsupported)) + ") is not emulated"
            )
        if "ExclusiveStartKey" in kwargs:
            # Never reached: every scan answers in one page, so fn_api's loop
            # breaks on the first response. Guarded anyway.
            return {"Items": []}
        rows = self._db.conn().execute('SELECT doc FROM "' + self._name + '"').fetchall()
        return {"Items": [json.loads(r[0]) for r in rows]}

    def query(self, KeyConditionExpression: Any = None, **kwargs: Any) -> dict:
        if "ExclusiveStartKey" in kwargs:
            return {"Items": []}
        index = kwargs.get("IndexName")
        if index is not None and index != "repo_index":
            raise NotImplementedError("index " + repr(index) + " is not emulated")
        attribute, value = _equality(KeyConditionExpression)
        if index == "repo_index" and attribute != "repo":
            raise NotImplementedError(
                "repo_index cannot be queried by " + repr(attribute)
            )
        if attribute not in tuple(self._primary) + _INDEXED:
            raise NotImplementedError(
                self._name + " has no key or index on " + repr(attribute)
            )
        rows = self._db.conn().execute(
            'SELECT doc FROM "' + self._name + '" WHERE ' + attribute + " = ?", [str(value)]
        ).fetchall()
        return {"Items": [json.loads(r[0]) for r in rows]}

    def update_item(
        self,
        Key: dict,
        UpdateExpression: str,
        ExpressionAttributeNames: dict,
        ExpressionAttributeValues: dict,
        **_: Any,
    ) -> dict:
        """Only the leaderboard's expression shape: ADD counters, SET fields.

        ADD on an absent attribute creates it with the value, which is what
        DynamoDB does and what lets a first-ever solve work with no seed row.
        """
        existing = self.get_item(Key).get("Item") or dict(Key)
        for clause, pairs in _parse_update(UpdateExpression).items():
            for name_ref, value_ref in pairs:
                name = ExpressionAttributeNames.get(name_ref, name_ref)
                value = ExpressionAttributeValues[value_ref]
                if clause == "ADD":
                    existing[name] = _number(existing.get(name, 0)) + _number(value)
                else:
                    existing[name] = _number(value)
        self.put_item(Item=existing)
        return {}


# ---------------------------------------------------------------------------
# reading the two boto3 expression forms in use
# ---------------------------------------------------------------------------

def _equality(condition: Any) -> tuple[str, Any]:
    """The attribute and value out of a boto3 Key("x").eq(v) condition."""
    if condition is None:
        raise ValueError("a query needs a KeyConditionExpression")
    built = condition.get_expression()
    if built["operator"] != "=":
        raise NotImplementedError(
            "key condition " + repr(built["operator"]) + " is not emulated"
        )
    attribute, value = built["values"]
    return attribute.name, value


def _parse_update(expression: str) -> dict[str, list[tuple[str, str]]]:
    """ADD #a :x, #b :y SET #c = :z -> {ADD: [(#a,:x),(#b,:y)], SET: [(#c,:z)]}."""
    clauses: dict[str, list[tuple[str, str]]] = {}
    state: dict[str, Any] = {"clause": None, "buffer": []}

    def flush() -> None:
        if state["clause"] is None:
            return
        for part in " ".join(state["buffer"]).split(","):
            tokens = part.replace("=", " ").split()
            if len(tokens) != 2:
                raise NotImplementedError("cannot parse update clause " + repr(part))
            clauses.setdefault(state["clause"], []).append((tokens[0], tokens[1]))

    for token in expression.split():
        if token.upper() in ("ADD", "SET"):
            flush()
            state["clause"], state["buffer"] = token.upper(), []
        else:
            state["buffer"].append(token)
    flush()
    if not clauses:
        raise NotImplementedError("cannot parse update expression " + repr(expression))
    return clauses


# ---------------------------------------------------------------------------
# the two singletons the seams hand back
# ---------------------------------------------------------------------------

_s3: LocalS3 | None = None
_db: _Db | None = None
_tables: dict[str, LocalTable] = {}
_guard = threading.Lock()


def s3() -> LocalS3:
    global _s3
    with _guard:
        if _s3 is None:
            _s3 = LocalS3(root() / "s3")
        return _s3


def table(name: str) -> LocalTable:
    global _db
    with _guard:
        if _db is None:
            _db = _Db(root() / "bugforge.sqlite3")
        if name not in _tables:
            _tables[name] = LocalTable(_db, name)
        return _tables[name]

"""Active Directory connection, allowed-user list, and login/startup checks."""
from __future__ import annotations

import json
import os
import secrets
import ssl
from datetime import datetime, timezone
from pathlib import Path

from .paths import data_root

PROFILE_NAME = "ad_settings.json"
LDAP_MATCHING_RULE_IN_CHAIN = "1.2.840.113556.1.4.1941"


def profile_path() -> Path:
    return data_root() / PROFILE_NAME


def default_settings() -> dict:
    return {
        "enabled": False,
        "host": "",
        "port": 389,
        "use_ssl": False,
        "use_starttls": False,
        "base_dn": "",
        "domain": "",
        "bind_username": "",
        "bind_password": "",
        "allowed_users": [],
        "allowed_groups": [],
        "allow_local_fallback": True,
        "enforce_at_startup": True,
        "updated_at": None,
    }


def load_settings() -> dict:
    path = profile_path()
    data = default_settings()
    if not path.is_file():
        return data
    try:
        stored = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        return data
    if isinstance(stored, dict):
        data.update(stored)
    data["allowed_users"] = _clean_list(data.get("allowed_users"))
    data["allowed_groups"] = _clean_list(data.get("allowed_groups"))
    data["port"] = int(data.get("port") or 389)
    return data


def save_settings(payload: dict) -> dict:
    current = load_settings()
    next_settings = default_settings()
    for key in next_settings:
        if key in {"bind_password", "updated_at"}:
            continue
        if key in payload:
            next_settings[key] = payload[key]
        else:
            next_settings[key] = current.get(key)
    next_settings["allowed_users"] = _clean_list(next_settings.get("allowed_users"))
    next_settings["allowed_groups"] = _clean_list(next_settings.get("allowed_groups"))
    next_settings["port"] = int(next_settings.get("port") or 389)
    password = payload.get("bind_password")
    if password in (None, ""):
        next_settings["bind_password"] = current.get("bind_password") or ""
    else:
        next_settings["bind_password"] = str(password)
    if next_settings["enabled"]:
        if not (next_settings.get("host") or "").strip():
            raise ValueError("Active Directory host is required when AD is enabled.")
        if not next_settings["allowed_users"] and not next_settings["allowed_groups"]:
            raise ValueError("Add at least one allowed user or group before enabling Active Directory.")
    next_settings["updated_at"] = datetime.now(timezone.utc).isoformat()
    profile_path().write_text(json.dumps(next_settings, indent=2), encoding="utf-8")
    return public_settings(next_settings)


def public_settings(settings: dict | None = None) -> dict:
    data = dict(settings or load_settings())
    data["bind_password_set"] = bool(data.pop("bind_password", ""))
    data["allowed_users"] = _clean_list(data.get("allowed_users"))
    data["allowed_groups"] = _clean_list(data.get("allowed_groups"))
    return data


def current_windows_user() -> dict:
    username = (os.environ.get("USERNAME") or os.environ.get("USER") or "").strip()
    domain = (os.environ.get("USERDOMAIN") or os.environ.get("USERDNSDOMAIN") or "").strip()
    return {
        "username": username,
        "domain": domain,
        "account": f"{domain}\\{username}" if domain and username else username,
        "sam": _sam(username),
    }


def is_enabled() -> bool:
    return bool(load_settings().get("enabled"))


def login_hint() -> dict:
    data = load_settings()
    return {
        "enabled": bool(data.get("enabled")),
        "domain": (data.get("domain") or "").strip(),
        "allow_local_fallback": bool(data.get("allow_local_fallback")),
    }


def _clean_list(value) -> list[str]:
    if isinstance(value, str):
        items = value.replace(",", "\n").splitlines()
    elif isinstance(value, list):
        items = [str(v) for v in value]
    else:
        items = []
    out = []
    seen = set()
    for item in items:
        text = item.strip()
        if not text or text.startswith("#"):
            continue
        key = text.casefold()
        if key in seen:
            continue
        seen.add(key)
        out.append(text)
    return out


def _sam(username: str) -> str:
    text = (username or "").strip()
    if "\\" in text:
        text = text.rsplit("\\", 1)[-1]
    if "@" in text:
        text = text.split("@", 1)[0]
    return text.strip()


def normalize_username(username: str) -> str:
    return _sam(username)


def _escape(value: str) -> str:
    from ldap3.utils.conv import escape_filter_chars

    return escape_filter_chars(value)


def _connect(settings: dict, username: str | None = None, password: str | None = None):
    from ldap3 import SIMPLE, Connection, Server, Tls

    host = (settings.get("host") or "").strip()
    if not host:
        raise ValueError("Active Directory host is not configured.")
    port = int(settings.get("port") or 389)
    use_ssl = bool(settings.get("use_ssl"))
    tls = Tls(validate=ssl.CERT_NONE)
    server = Server(host, port=port, use_ssl=use_ssl, tls=tls, connect_timeout=8, get_info=None)
    bind_user, bind_password, auth = _bind_credentials(settings, username, password)
    conn = Connection(
        server,
        user=bind_user,
        password=bind_password,
        authentication=auth or SIMPLE,
        auto_bind=False,
        receive_timeout=10,
        raise_exceptions=False,
    )
    if not conn.open():
        raise ConnectionError(conn.last_error or "Could not reach the Active Directory server.")
    if settings.get("use_starttls") and not use_ssl:
        if not conn.start_tls():
            conn.unbind()
            raise ConnectionError(conn.last_error or "StartTLS failed.")
    if bind_user and bind_password is not None:
        if not conn.bind():
            err = conn.last_error or conn.result.get("description") if conn.result else "bind failed"
            conn.unbind()
            raise PermissionError(str(err))
    return conn


def _bind_credentials(settings: dict, username: str | None, password: str | None) -> tuple[str | None, str | None, str | None]:
    from ldap3 import NTLM, SIMPLE

    if username:
        sam = _sam(username)
        domain = (settings.get("domain") or "").strip()
        if "\\" in username or "@" in username:
            return username, password, NTLM if "\\" in username else SIMPLE
        if domain:
            return f"{domain}\\{sam}", password, NTLM
        return sam, password, SIMPLE
    bind_user = (settings.get("bind_username") or "").strip()
    bind_password = settings.get("bind_password") or ""
    if not bind_user:
        return None, None, None
    if "\\" in bind_user or bind_user.lower().startswith("cn="):
        auth = NTLM if "\\" in bind_user else SIMPLE
        return bind_user, bind_password, auth
    if "@" in bind_user:
        return bind_user, bind_password, SIMPLE
    domain = (settings.get("domain") or "").strip()
    if domain:
        return f"{domain}\\{bind_user}", bind_password, NTLM
    return bind_user, bind_password, SIMPLE


def test_connection(payload: dict | None = None) -> dict:
    settings = load_settings()
    if payload:
        merged = dict(settings)
        merged.update({k: v for k, v in payload.items() if v is not None})
        if not payload.get("bind_password"):
            merged["bind_password"] = settings.get("bind_password") or ""
        settings = merged
    conn = _connect(settings)
    try:
        who = None
        try:
            who = conn.extend.standard.who_am_i()
        except Exception:
            who = settings.get("bind_username") or None
        return {
            "ok": True,
            "bound_as": who,
            "base_dn": (settings.get("base_dn") or "").strip() or None,
            "server": settings.get("host"),
        }
    finally:
        conn.unbind()


def _base_dn(settings: dict, conn) -> str:
    base = (settings.get("base_dn") or "").strip()
    if base:
        return base
    try:
        contexts = conn.server.info.other.get("defaultNamingContext") if conn.server.info else None
        if contexts:
            return contexts[0]
    except Exception:
        pass
    domain = (settings.get("domain") or "").strip()
    if domain and "." in domain:
        return ",".join(f"DC={part}" for part in domain.split("."))
    raise ValueError("Base DN is required (for example DC=plant,DC=local).")


def _find_user(conn, settings: dict, username: str):
    from ldap3 import SUBTREE

    sam = _sam(username)
    if not sam:
        return None
    base = _base_dn(settings, conn)
    filt = f"(&(objectClass=user)(!(objectClass=computer))(sAMAccountName={_escape(sam)}))"
    conn.search(base, filt, search_scope=SUBTREE, attributes=["cn", "displayName", "sAMAccountName", "memberOf", "userPrincipalName", "distinguishedName"])
    if conn.entries:
        return conn.entries[0]
    return None


def _group_dn(conn, settings: dict, group: str) -> str | None:
    from ldap3 import SUBTREE

    text = group.strip()
    if "=" in text:
        return text
    base = _base_dn(settings, conn)
    filt = f"(&(objectClass=group)(|(sAMAccountName={_escape(text)})(cn={_escape(text)})))"
    conn.search(base, filt, search_scope=SUBTREE, attributes=["distinguishedName"], size_limit=1)
    if conn.entries:
        return str(conn.entries[0].entry_dn)
    return None


def _in_group(conn, settings: dict, user_dn: str, group: str) -> bool:
    from ldap3 import BASE, SUBTREE

    group_dn = _group_dn(conn, settings, group)
    if not group_dn:
        return False
    filt = f"(memberOf:{LDAP_MATCHING_RULE_IN_CHAIN}:={group_dn})"
    conn.search(user_dn, filt, search_scope=BASE, attributes=["cn"])
    if conn.entries:
        return True
    base = _base_dn(settings, conn)
    nested = f"(&(objectClass=user)(distinguishedName={_escape(user_dn)})(memberOf:{LDAP_MATCHING_RULE_IN_CHAIN}:={group_dn}))"
    conn.search(base, nested, search_scope=SUBTREE, attributes=["cn"], size_limit=1)
    return bool(conn.entries)


def _allowed_reason(conn, settings: dict, username: str) -> tuple[bool, str, dict]:
    sam = _sam(username)
    users = [_sam(u) for u in _clean_list(settings.get("allowed_users"))]
    groups = _clean_list(settings.get("allowed_groups"))
    entry = _find_user(conn, settings, sam)
    display = sam
    if entry is not None:
        for attr in ("displayName", "cn"):
            try:
                value = getattr(entry, attr).value
                if value:
                    display = str(value)
                    break
            except Exception:
                continue
    info = {
        "sam": sam,
        "display_name": display,
        "dn": str(entry.entry_dn) if entry else None,
    }
    if not entry:
        return False, f"Account '{sam}' was not found in Active Directory.", info
    if users and sam.casefold() in {u.casefold() for u in users}:
        return True, "Listed in the allowed users list.", info
    matched_groups = []
    for group in groups:
        if _in_group(conn, settings, str(entry.entry_dn), group):
            matched_groups.append(group)
    if matched_groups:
        info["groups"] = matched_groups
        return True, f"Member of allowed group: {matched_groups[0]}.", info
    if users or groups:
        return False, f"Account '{sam}' is not in the allowed Active Directory list.", info
    return False, "No allowed users or groups are configured.", info


def check_username(username: str, settings: dict | None = None) -> dict:
    data = settings or load_settings()
    conn = _connect(data)
    try:
        allowed, reason, info = _allowed_reason(conn, data, username)
        return {"ok": allowed, "reason": reason, **info}
    finally:
        conn.unbind()


def authenticate_ad(username: str, password: str) -> dict:
    data = load_settings()
    if not data.get("enabled"):
        raise PermissionError("Active Directory is not enabled.")
    if not username or not password:
        raise PermissionError("Username and password are required.")
    if data.get("bind_username"):
        lookup = check_username(username, data)
        if not lookup["ok"]:
            raise PermissionError(lookup["reason"])
    conn = _connect(data, username=username, password=password)
    try:
        allowed, reason, info = _allowed_reason(conn, data, username)
        if not allowed:
            raise PermissionError(reason)
        return {"ok": True, "reason": reason, **info}
    finally:
        conn.unbind()


def check_current_windows_user() -> dict:
    windows = current_windows_user()
    data = load_settings()
    result = {"windows": windows, "enabled": bool(data.get("enabled"))}
    if not data.get("enabled"):
        result.update({"ok": True, "reason": "Active Directory is not enabled."})
        return result
    if not windows.get("sam"):
        result.update({"ok": False, "reason": "Could not determine the Windows user."})
        return result
    try:
        checked = check_username(windows["sam"], data)
        result.update(checked)
        return result
    except Exception as exc:  # noqa: BLE001
        result.update({"ok": False, "unreachable": True, "reason": str(exc)})
        return result


def enforce_startup_access() -> str | None:
    """Return an error message to block launch, or None to continue."""
    data = load_settings()
    if not data.get("enabled") or not data.get("enforce_at_startup"):
        return None
    if not (data.get("host") or "").strip():
        return None
    result = check_current_windows_user()
    if result.get("ok"):
        return None
    if result.get("unreachable") and data.get("allow_local_fallback"):
        return None
    account = result.get("windows", {}).get("account") or result.get("sam") or "this Windows account"
    reason = result.get("reason") or "not on the allowed Active Directory list"
    return (
        f"PVC Arvand is connected to Active Directory.\n\n"
        f"{account} is not allowed to open this program.\n\n{reason}"
    )


def provision_ad_user(db, username: str, full_name: str | None):
    from . import models
    from .auth import hash_password

    sam = _sam(username)
    user = db.query(models.User).filter(models.User.username == sam).first()
    if user:
        if full_name and not user.full_name:
            user.full_name = full_name
        if hasattr(user, "auth_source"):
            user.auth_source = "ad"
        if not user.is_active:
            raise PermissionError("This account is disabled in the program.")
        db.commit()
        db.refresh(user)
        return user
    user = models.User(
        username=sam,
        full_name=full_name,
        password_hash=hash_password(secrets.token_urlsafe(32)),
        role="user",
        is_active=True,
        auth_source="ad",
    )
    db.add(user)
    db.commit()
    db.refresh(user)
    return user

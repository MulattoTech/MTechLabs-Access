#!/usr/bin/env python3
"""Access #46: read-only, redacted audit of three pinned local client entries.

No subprocesses, imports from the runtime, writes, network, credential output,
client launches, or acceptance claims. Python 3.11+ standard library only.
"""
import json
import ntpath
import os
import stat
import tomllib
from pathlib import Path

# These are the three owner-profile client entry types in the reviewed
# verify-clients.mjs. The executing profile must be verified separately;
# environment/home lookup by itself is NOT an identity attestation.
HOME = Path.home()
TARGETS = (
    ("codex", "toml", HOME / ".codex" / "config.toml"),
    ("claude-code", "json", HOME / ".claude.json"),
    ("claude-desktop", "json", HOME / "AppData" / "Roaming" / "Claude" / "claude_desktop_config.json"),
)
SERVER = "desktop-commander-local"
OLDROOT = r"H:\MTechLabs\MCP"
NODE = r"C:\Program Files\nodejs\node.exe"
MAX_BYTES = 8 * 1024 * 1024


def same_path(a, b):
    return (isinstance(a, str) and isinstance(b, str)
            and ntpath.normcase(ntpath.normpath(a)) == ntpath.normcase(ntpath.normpath(b)))


def inspect_entry(name, data):
    row = {
        "client": name, "sourceStatus": "unverified", "managedEntryPresent": False,
        "managerRootIsLegacyH": False, "gatewayRootIsLegacyH": False,
        "configRootIsLegacyH": False, "expectedNodePath": False,
        "expectedArgumentStructure": False, "knownCommandArgsMatch": False,
        "additionalEnvironmentOmitted": True, "clientStarted": False,
        "configModified": False, "valuesExported": False,
    }
    if not isinstance(data, dict):
        row["sourceStatus"] = "invalid_structure"
        return row
    servers = data.get("mcp_servers") if name == "codex" else data.get("mcpServers")
    if not isinstance(servers, dict):
        row["sourceStatus"] = "managed_table_missing"
        return row
    entry = servers.get(SERVER)
    if not isinstance(entry, dict):
        row["sourceStatus"] = "managed_entry_missing"
        return row
    row["managedEntryPresent"] = True
    if entry.get("enabled", True) is False or entry.get("disabled", False) is True:
        row["sourceStatus"] = "managed_entry_disabled"
        return row
    args = entry.get("args", [])
    if not isinstance(args, list) or not all(isinstance(a, str) for a in args):
        row["sourceStatus"] = "invalid_arguments"
        return row
    row["expectedNodePath"] = same_path(entry.get("command"), NODE)
    row["gatewayRootIsLegacyH"] = len(args) >= 1 and same_path(args[0], ntpath.join(OLDROOT, "runtime", "gateway.mjs"))
    row["configRootIsLegacyH"] = len(args) >= 3 and same_path(args[2], ntpath.join(OLDROOT, "state", "manager.json"))
    row["managerRootIsLegacyH"] = row["gatewayRootIsLegacyH"] or row["configRootIsLegacyH"]
    row["expectedArgumentStructure"] = (
        len(args) == 5 and args[1] == "--config" and args[3] == "--client" and args[4] == name
    )
    row["knownCommandArgsMatch"] = (
        row["expectedNodePath"] and row["gatewayRootIsLegacyH"] and
        row["configRootIsLegacyH"] and row["expectedArgumentStructure"] and
        (entry.get("type", "stdio") == "stdio")
    )
    row["sourceStatus"] = "managed_entry_classified"
    return row


def audit_config(name, kind, path):
    default = {
        "client": name, "sourceStatus": "unverified", "managedEntryPresent": False,
        "managerRootIsLegacyH": False, "gatewayRootIsLegacyH": False,
        "configRootIsLegacyH": False, "expectedNodePath": False,
        "expectedArgumentStructure": False, "knownCommandArgsMatch": False,
        "additionalEnvironmentOmitted": True, "clientStarted": False,
        "configModified": False, "valuesExported": False,
    }
    try:
        meta = path.lstat()
        if not stat.S_ISREG(meta.st_mode) or meta.st_size > MAX_BYTES:
            return {**default, "sourceStatus": "unqualified_file_type_or_size"}
        with open(path, "rb") as file:
            opened = os.fstat(file.fileno())
            if not stat.S_ISREG(opened.st_mode) or opened.st_size > MAX_BYTES:
                return {**default, "sourceStatus": "unqualified_opened_file"}
            data = file.read(MAX_BYTES + 1)
        if len(data) > MAX_BYTES:
            return {**default, "sourceStatus": "size_limit_exceeded"}
        value = data.decode("utf-8-sig", "strict")
        parsed = tomllib.loads(value) if kind == "toml" else json.loads(value)
        return inspect_entry(name, parsed)
    except FileNotFoundError:
        return {**default, "sourceStatus": "configuration_absent"}
    except (OSError, ValueError, UnicodeError, tomllib.TOMLDecodeError):
        return {**default, "sourceStatus": "configuration_unreadable_or_invalid"}


def main():
    records = [audit_config(*target) for target in TARGETS]
    result = {
        "schemaVersion": 1,
        "scope": "owner-local three named client entries, read-only and redacted",
        "sourceMethod": "python standard-library tomllib/json, targeted key only",
        "clientCount": len(records),
        "managedEntriesPresent": sum(r["managedEntryPresent"] for r in records),
        "oldHGatewayMappings": sum(r["gatewayRootIsLegacyH"] for r in records),
        "oldHConfigMappings": sum(r["configRootIsLegacyH"] for r in records),
        "matchingKnownCommandArgs": sum(r["knownCommandArgsMatch"] for r in records),
        "allClientConfigurationsExported": False, "secretValuesExported": False,
        "clientSessionsStarted": False, "networkQueried": False,
        "productionRuntimeQueried": False, "filesModified": False,
        "sourceIntegrityAttested": False, "devActivationAuthorized": False,
        "records": records,
        "limits": [
            "Only the named entry's command, arguments and disabled/type flags are classified; this is not complete verifier parser equivalence or an authenticated client session.",
            "Targeted field classification does not enumerate every other client integration.",
            "File lstat/fstat snapshots do not establish protected parents or eliminate races.",
            "No production files, credentials, executable modules, or app sessions were opened."
        ],
    }
    print(json.dumps(result, separators=(",", ":"), ensure_ascii=True))


if __name__ == "__main__":
    main()

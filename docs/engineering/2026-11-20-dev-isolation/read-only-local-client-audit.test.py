#!/usr/bin/env python3
"""Offline regression tests for the sanitized three-client mapping classifier."""
import hashlib
import importlib.util
import io
import json
import tempfile
import unittest
from pathlib import Path

module_path=Path(__file__).with_name("read-only-local-client-audit.py")
spec=importlib.util.spec_from_file_location("client_audit_r26",module_path)
audit=importlib.util.module_from_spec(spec)
spec.loader.exec_module(audit)

def good_entry(client="codex"):
    return {
        "command": audit.NODE,
        "args": [
            audit.OLDROOT + r"\runtime\gateway.mjs",
            "--config",
            audit.OLDROOT + r"\state\manager.json",
            "--client",
            client
        ],
        "type":"stdio",
        "env":{"UNRELATED_SECRET":"NOT_FOR_OUTPUT"},
    }

def body(client="codex",entry=None):
    return {("mcp_servers" if client=="codex" else "mcpServers"):
            {audit.SERVER:good_entry(client) if entry is None else entry}}

class Checks(unittest.TestCase):
    def test_three_verified_clients(self):
        for c in ["codex","claude-code","claude-desktop"]:
            with self.subTest(c=c):
                a=audit.inspect_entry(c,body(c))
                self.assertTrue(a["knownCommandArgsMatch"])
                self.assertTrue(a["gatewayRootIsLegacyH"])
                self.assertTrue(a["configRootIsLegacyH"])
                self.assertNotIn("UNRELATED_SECRET",json.dumps(a))

    def test_missing_managed_table(self):
        self.assertEqual(audit.inspect_entry("codex",{})["sourceStatus"],"managed_table_missing")

    def test_missing_managed_entry(self):
        self.assertEqual(audit.inspect_entry("codex",{"mcp_servers":{}})["sourceStatus"],"managed_entry_missing")

    def test_wrong_node_path(self):
        e=good_entry();e["command"]="C:\\Untrusted\\node.exe"
        self.assertFalse(audit.inspect_entry("codex",body("codex",e))["knownCommandArgsMatch"])

    def test_gateway_not_old_root(self):
        e=good_entry();e["args"][0]=r"C:\Program Files\MTechLabs\MCP-Production\runtime\gateway.mjs"
        r=audit.inspect_entry("codex",body("codex",e))
        self.assertFalse(r["gatewayRootIsLegacyH"])
        self.assertFalse(r["knownCommandArgsMatch"])

    def test_config_not_old_root(self):
        e=good_entry();e["args"][2]=r"C:\ProgramData\MTechLabs\Production\manager.json"
        r=audit.inspect_entry("codex",body("codex",e))
        self.assertFalse(r["configRootIsLegacyH"])
        self.assertFalse(r["knownCommandArgsMatch"])

    def test_wrong_client(self):
        e=good_entry();e["args"][-1]="another-client"
        self.assertFalse(audit.inspect_entry("codex",body("codex",e))["expectedArgumentStructure"])

    def test_missing_flag(self):
        e=good_entry();e["args"][1]="--wrong"
        self.assertFalse(audit.inspect_entry("codex",body("codex",e))["expectedArgumentStructure"])

    def test_extra_arg(self):
        e=good_entry();e["args"].append("unexpected")
        self.assertFalse(audit.inspect_entry("codex",body("codex",e))["expectedArgumentStructure"])

    def test_disabled_flag(self):
        e=good_entry();e["disabled"]=True
        self.assertEqual(audit.inspect_entry("codex",body("codex",e))["sourceStatus"],"managed_entry_disabled")

    def test_not_stdio(self):
        e=good_entry();e["type"]="http"
        self.assertFalse(audit.inspect_entry("codex",body("codex",e))["knownCommandArgsMatch"])

    def test_invalid_arguments(self):
        e=good_entry();e["args"]="not an array"
        self.assertEqual(audit.inspect_entry("codex",body("codex",e))["sourceStatus"],"invalid_arguments")

    def test_non_object_config(self):
        self.assertEqual(audit.inspect_entry("codex",[])["sourceStatus"],"invalid_structure")

    def test_scrubs_environment_secret(self):
        e=good_entry();e["env"]["AUTH_HEADER"]="BEARER_SENSITIVE_VALUE"
        serialized=json.dumps(audit.inspect_entry("codex",body("codex",e)))
        self.assertNotIn("BEARER_SENSITIVE_VALUE",serialized)
        self.assertNotIn("AUTH_HEADER",serialized)

    def test_missing_file(self):
        with tempfile.TemporaryDirectory(prefix="mterm-client-r26-") as temp:
            r=audit.audit_config("codex","toml",Path(temp)/"absent.toml")
            self.assertEqual(r["sourceStatus"],"configuration_absent")

    def test_directory_rejected(self):
        with tempfile.TemporaryDirectory(prefix="mterm-client-r26-") as temp:
            r=audit.audit_config("codex","toml",Path(temp))
            self.assertEqual(r["sourceStatus"],"unqualified_file_type_or_size")

    def test_readonly_json_fixture(self):
        with tempfile.TemporaryDirectory(prefix="mterm-client-r26-") as temp:
            p=Path(temp)/"client.json"
            p.write_text(json.dumps(body("claude-code")),encoding="utf-8")
            before=hashlib.sha256(p.read_bytes()).digest()
            result=audit.audit_config("claude-code","json",p)
            after=hashlib.sha256(p.read_bytes()).digest()
            self.assertTrue(result["knownCommandArgsMatch"])
            self.assertEqual(before,after)

    def test_readonly_toml_fixture(self):
        with tempfile.TemporaryDirectory(prefix="mterm-client-r26-") as temp:
            p=Path(temp)/"client.toml"
            p.write_text('[mcp_servers."desktop-commander-local"]\n'
                         'command = "C:\\\\Program Files\\\\nodejs\\\\node.exe"\n'
                         'args = ["H:\\\\MTechLabs\\\\MCP\\\\runtime\\\\gateway.mjs", '
                         '"--config", "H:\\\\MTechLabs\\\\MCP\\\\state\\\\manager.json", '
                         '"--client", "codex"]\n',encoding="utf-8")
            r=audit.audit_config("codex","toml",p)
            self.assertTrue(r["knownCommandArgsMatch"],str(r["sourceStatus"]))

    def test_malformed_toml_rejected(self):
        with tempfile.TemporaryDirectory(prefix="mterm-client-r26-") as temp:
            p=Path(temp)/"bad.toml";p.write_text('[broken\n',encoding="utf-8")
            r=audit.audit_config("codex","toml",p)
            self.assertEqual(r["sourceStatus"],"configuration_unreadable_or_invalid")

    def test_malformed_json_rejected(self):
        with tempfile.TemporaryDirectory(prefix="mterm-client-r26-") as temp:
            p=Path(temp)/"bad.json";p.write_text('{"a":',encoding="utf-8")
            r=audit.audit_config("claude-code","json",p)
            self.assertEqual(r["sourceStatus"],"configuration_unreadable_or_invalid")

    def test_too_large_rejected(self):
        with tempfile.TemporaryDirectory(prefix="mterm-client-r26-") as temp:
            p=Path(temp)/"large.json"
            with open(p,"wb") as out:out.truncate(audit.MAX_BYTES+1)
            r=audit.audit_config("claude-code","json",p)
            self.assertEqual(r["sourceStatus"],"unqualified_file_type_or_size")

def main():
    output=io.StringIO()
    suite=unittest.defaultTestLoader.loadTestsFromTestCase(Checks)
    result=unittest.TextTestRunner(stream=output,verbosity=0).run(suite)
    receipt={"suite":"offline-redacted-client-classifier",
             "passed":result.testsRun-len(result.failures)-len(result.errors),
             "total":result.testsRun,
             "failed":len(result.failures)+len(result.errors),
             "userClientFilesRead":False,
             "networkQueried":False,"productionQueried":False,
             "testScratchCleaned":True,"devActivationAuthorized":False}
    print(json.dumps(receipt,separators=(",",":")))
    if not result.wasSuccessful():raise SystemExit(1)

if __name__=="__main__":
    main()

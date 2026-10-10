"""Verify the application checks and Make targets without starting application tools."""
import json
import os
from pathlib import Path
import shutil
import subprocess
import tempfile
import unittest

SOURCE = Path(__file__).resolve().parents[1]

class ApplicationChecks(unittest.TestCase):
    def test_make_targets_enforce_supported_go_before_work(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            shutil.copy2(SOURCE / "Makefile", root / "Makefile")
            tools = root / "tools"
            tools.mkdir()
            go = tools / "go"
            go.write_text('''#!/usr/bin/env python3
import os, sys
from pathlib import Path
if sys.argv[1:] == ["env", "GOVERSION"]:
    print(os.environ["FAKE_GO_VERSION"])
else:
    with Path("calls").open("a") as stream:
        stream.write(" ".join(sys.argv[1:]) + " GOWORK=" + os.environ.get("GOWORK", "") + "\\n")
    if sys.argv[1] == "build":
        Path("dist").mkdir(exist_ok=True)
        Path("dist/tdb").write_text("test executable")
''')
            go.chmod(0o755)
            env = dict(os.environ, PATH=str(tools) + os.pathsep + os.environ["PATH"])
            for target in ("build", "install", "test"):
                for version in ("go1.26.5", "go1.3.0"):
                    with self.subTest(target=target, version=version):
                        result = subprocess.run(["make", target, "PREFIX=" + str(root / "prefix")], cwd=root,
                                                env=dict(env, FAKE_GO_VERSION=version), capture_output=True, text=True)
                        self.assertNotEqual(result.returncode, 0)
                        self.assertIn("Go 1.27 or newer", result.stderr)
                        self.assertFalse((root / "calls").exists())
                        self.assertFalse((root / "prefix/bin/tdb").exists())
            for version in ("go1.27.1", "go1.28.0", "go1.30rc1"):
                for target in ("build", "install", "test"):
                    with self.subTest(target=target, version=version):
                        result = subprocess.run(["make", target, "PREFIX=" + str(root / "prefix")], cwd=root,
                                                env=dict(env, FAKE_GO_VERSION=version), capture_output=True, text=True)
                        self.assertEqual(result.returncode, 0, result.stderr)
            self.assertEqual((root / "prefix/bin/tdb").read_text(), "test executable")
            self.assertIn("test -race . ./internal/... GOWORK=off", (root / "calls").read_text())

    def test_tooling_tests_run_first_and_failures_stop_later_checks(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            for name in ("bin", "internal", "tests", "tools"):
                (root / name).mkdir()
            shutil.copy2(SOURCE / "bin/check-application", root / "bin/check-application")
            (root / "main.go").touch()
            (root / "tests/board-moves.test.mjs").touch()
            (root / "tests/test_app_checks.py").write_text(
                "import json, os, unittest\nfrom pathlib import Path\n"
                "class Tooling(unittest.TestCase):\n"
                "    def test_tooling(self):\n"
                "        with Path('calls').open('a') as f: f.write(json.dumps(['tooling', os.environ.get('GOWORK')]) + '\\n')\n"
                "        self.assertNotIn('TOOLING_FAILURE', os.environ)\n")
            for name in ("go", "gofmt", "node"):
                tool = root / "tools" / name
                tool.write_text("#!/usr/bin/env python3\nimport json, os, sys\nfrom pathlib import Path\n"
                                "with Path('calls').open('a') as f: f.write(json.dumps([Path(sys.argv[0]).name, *sys.argv[1:2], os.environ.get('GOWORK')]) + '\\n')\n"
                                "if sys.argv[1:] == ['version']: print('go version go1.27.1 test/test')\n"
                                "if sys.argv[1:] == ['--version']: print('v24.20.0')\n"
                                "if sys.argv[1:2] == [os.environ.get('FAIL_COMMAND')]: sys.exit(7)\n")
                tool.chmod(0o755)
            env = {key: value for key, value in os.environ.items() if key != "GOWORK"}
            env["PATH"] = str(root / "tools") + os.pathsep + os.environ["PATH"]

            def check(**extra):
                (root / "calls").unlink(missing_ok=True)
                result = subprocess.run([str(root / "bin/check-application")], cwd=root, env=dict(env, **extra),
                                        capture_output=True, text=True)
                return result, [json.loads(line) for line in (root / "calls").read_text().splitlines()]

            result, calls = check()
            self.assertEqual(result.returncode, 0, result.stderr)
            # Tooling tests keep the caller's environment; application tools run with GOWORK=off.
            self.assertEqual(calls, [["tooling", None], ["go", "version", "off"], ["node", "--version", "off"],
                                     ["gofmt", "-l", "off"], ["node", "--test", "off"], ["go", "test", "off"],
                                     ["go", "vet", "off"], ["go", "build", "off"]])
            result, calls = check(TOOLING_FAILURE="1")
            self.assertNotEqual(result.returncode, 0)
            self.assertEqual(calls, [["tooling", None]])
            result, calls = check(FAIL_COMMAND="test")
            self.assertNotEqual(result.returncode, 0)
            self.assertEqual(calls[-1], ["go", "test", "off"])

    def test_application_scope_and_toolchain(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            for name in ("bin", "internal", "tests", "worktrees/nested", "tools"):
                (root / name).mkdir(parents=True)
            shutil.copy2(SOURCE / "bin/check-application", root / "bin/check-application")
            (root / "tests/test_app_checks.py").write_text("import unittest\nclass Stub(unittest.TestCase):\n    def test_ok(self): pass\n")
            (root / "main.go").touch()
            (root / "internal/app.go").touch()
            (root / "tests/board-moves.test.mjs").touch()
            (root / "worktrees/nested/broken.go").write_text("invalid")
            (root / "worktrees/nested/broken.test.mjs").write_text("invalid")
            for name in ("go", "gofmt", "node"):
                tool = root / "tools" / name
                tool.write_text("#!/usr/bin/env python3\nimport os,sys,json\nfrom pathlib import Path\nwith Path('calls').open('a') as f: f.write(json.dumps(sys.argv)+'\\n')\nif sys.argv[1:]==['version']: print(os.environ.get('FAKE_GO_VERSION','go version go1.27.1 test/test'))\nif sys.argv[1:]==['--version']: print(os.environ.get('FAKE_NODE_VERSION','v24.20.0'))\nif Path(sys.argv[0]).name=='gofmt' and os.environ.get('BAD_FORMAT'): print('main.go')\n")
                tool.chmod(0o755)
            env = dict(os.environ, PATH=str(root / "tools") + os.pathsep + os.environ["PATH"])
            for _ in range(2):
                result = subprocess.run([str(root / "bin/check-application")], cwd=root, env=env, capture_output=True, text=True)
                self.assertEqual(result.returncode, 0, result.stderr)
                self.assertNotIn("worktrees", (root / "calls").read_text())
                self.assertIn("./internal/...", (root / "calls").read_text())
                self.assertIn("board-moves.test.mjs", (root / "calls").read_text())
                shutil.rmtree(root / "worktrees", ignore_errors=True)
            (root / "calls").unlink()
            for go, node in (("go1.28.0", "v26.1.0"), ("go1.30.2", "v28.0.0")):
                with self.subTest(go=go, node=node):
                    newer = dict(env, FAKE_GO_VERSION=f"go version {go} test/test", FAKE_NODE_VERSION=node)
                    result = subprocess.run([str(root / "bin/check-application")], cwd=root, env=newer, capture_output=True, text=True)
                    self.assertEqual(result.returncode, 0, result.stderr)
                    self.assertIn("build", (root / "calls").read_text())
                    (root / "calls").unlink()
            for go in ("go1.26.0", "go1.3.0"):
                with self.subTest(go=go):
                    result = subprocess.run([str(root / "bin/check-application")], cwd=root, env=dict(env, FAKE_GO_VERSION=f"go version {go} test/test"), capture_output=True, text=True)
                    self.assertNotEqual(result.returncode, 0)
                    self.assertIn("Go 1.27 or newer", result.stderr)
                    self.assertNotIn("test", (root / "calls").read_text())
                    (root / "calls").unlink()
            for node in ("v22.0.0", "v23.9.0"):
                with self.subTest(node=node):
                    result = subprocess.run([str(root / "bin/check-application")], cwd=root, env=dict(env, FAKE_NODE_VERSION=node), capture_output=True, text=True)
                    self.assertNotEqual(result.returncode, 0)
                    self.assertIn("Node.js 24 or newer", result.stderr)
                    self.assertNotIn("--test", (root / "calls").read_text())
                    (root / "calls").unlink()
            result = subprocess.run([str(root / "bin/check-application")], cwd=root, env=dict(env, BAD_FORMAT="1"), capture_output=True)
            self.assertNotEqual(result.returncode, 0)
            (root / "calls").unlink()
            (root / "tests/board-moves.test.mjs").unlink()
            result = subprocess.run([str(root / "bin/check-application")], cwd=root, env=env, capture_output=True, text=True)
            self.assertNotEqual(result.returncode, 0)
            self.assertIn("No browser event tests", result.stderr)
            self.assertNotIn("--test", (root / "calls").read_text())

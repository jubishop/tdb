"""Verify the adopted check boundary without starting application tools."""
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
                for version in ("go1.26.5", "go1.28.0"):
                    with self.subTest(target=target, version=version):
                        result = subprocess.run(["make", target, "PREFIX=" + str(root / "prefix")], cwd=root,
                                                env=dict(env, FAKE_GO_VERSION=version), capture_output=True, text=True)
                        self.assertNotEqual(result.returncode, 0)
                        self.assertIn("Go 1.27.x", result.stderr)
                        self.assertFalse((root / "calls").exists())
                        self.assertFalse((root / "prefix/bin/tdb").exists())
            for target in ("build", "install", "test"):
                subprocess.run(["make", target, "PREFIX=" + str(root / "prefix")], cwd=root,
                               env=dict(env, FAKE_GO_VERSION="go1.27.1"), check=True, capture_output=True)
            self.assertEqual((root / "prefix/bin/tdb").read_text(), "test executable")
            self.assertIn("test -race . ./internal/... GOWORK=off", (root / "calls").read_text())

    def test_modes_and_failures(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            (root / "bin").mkdir()
            (root / "tests").mkdir()
            (root / "tests/test_app_checks.py").write_text("import unittest\nclass Stub(unittest.TestCase):\n    def test_ok(self): pass\n")
            shutil.copy2(SOURCE / "bin/check", root / "bin/check")
            (root / "bin/_checks.py").write_text("import os\ndef main(): return int(os.environ.get('FOUNDATION_FAILURE', '0'))\n")
            app = root / "bin/check-app"
            app.write_text("#!/usr/bin/env python3\nimport os\nfrom pathlib import Path\nPath('invoked').touch()\nraise SystemExit(int(os.environ.get('APPLICATION_FAILURE', '0')))\n")
            app.chmod(0o755)
            for args in ([], ["--documents-only"]):
                subprocess.run([str(root / "bin/check"), *args], cwd=root, check=True)
                self.assertFalse((root / "invoked").exists())
            subprocess.run([str(root / "bin/check"), "--full"], cwd=root, check=True)
            self.assertTrue((root / "invoked").exists())
            (root / "invoked").unlink()
            env = dict(os.environ, FOUNDATION_FAILURE="3")
            result = subprocess.run([str(root / "bin/check"), "--full"], cwd=root, env=env)
            self.assertEqual(result.returncode, 3)
            self.assertFalse((root / "invoked").exists())
            result = subprocess.run([str(root / "bin/check"), "--full"], cwd=root, env=dict(os.environ, APPLICATION_FAILURE="7"))
            self.assertEqual(result.returncode, 7)

    def test_application_scope_and_toolchain(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            for name in ("bin", "internal", "tests", "worktrees/nested", "tools"):
                (root / name).mkdir(parents=True)
            shutil.copy2(SOURCE / "bin/check-app", root / "bin/check-app")
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
                subprocess.run([str(root / "bin/check-app")], cwd=root, env=env, check=True)
                self.assertNotIn("worktrees", (root / "calls").read_text())
                self.assertIn("./internal/...", (root / "calls").read_text())
                self.assertIn("board-moves.test.mjs", (root / "calls").read_text())
                shutil.rmtree(root / "worktrees", ignore_errors=True)
            (root / "calls").unlink()
            result = subprocess.run([str(root / "bin/check-app")], cwd=root, env=dict(env, FAKE_GO_VERSION="go version go1.26.0 test/test"), capture_output=True, text=True)
            self.assertNotEqual(result.returncode, 0)
            self.assertIn("Go 1.27.x", result.stderr)
            self.assertNotIn("test", (root / "calls").read_text())
            (root / "calls").unlink()
            result = subprocess.run([str(root / "bin/check-app")], cwd=root, env=dict(env, FAKE_NODE_VERSION="v22.0.0"), capture_output=True, text=True)
            self.assertNotEqual(result.returncode, 0)
            self.assertIn("Node.js 24.x", result.stderr)
            self.assertNotIn("--test", (root / "calls").read_text())
            result = subprocess.run([str(root / "bin/check-app")], cwd=root, env=dict(env, BAD_FORMAT="1"), capture_output=True)
            self.assertNotEqual(result.returncode, 0)
            (root / "calls").unlink()
            (root / "tests/board-moves.test.mjs").unlink()
            result = subprocess.run([str(root / "bin/check-app")], cwd=root, env=env, capture_output=True, text=True)
            self.assertNotEqual(result.returncode, 0)
            self.assertIn("No browser event tests", result.stderr)
            self.assertNotIn("--test", (root / "calls").read_text())

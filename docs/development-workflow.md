---
status: current
---

# Development workflow

This page records this project's own commands and integrations. Shared rules
are in the [foundation pages](foundation/README.md).

## Setup

```sh
bin/setup
bin/doctor
bin/check --full
```

Setup needs Git and Python 3.9 or later, and checks also need ShellCheck.
QMD and direnv are optional; setup reports skipped features. Install td and
run `td init` as described in [task tracking](foundation/task-tracking.md).
Create `.envrc` only when the project needs environment settings, and review
it before running `direnv allow`; search does not need it.

## Checks

Follow the [check schedule](foundation/engineering-policy.md#checks).
`bin/check-application` first runs the tooling tests in
`tests/test_app_checks.py` with the caller's environment. It then runs the
[application validation](#application-commands) with `GOWORK=off`: version
checks, formatting, browser event tests, Go race tests, vet, and build.

## Runtime and toolchain versions

tdb supports macOS and Linux with Go 1.27.x, declared in `go.mod` and
enforced by `bin/check-application` and the Make targets. Application checks
use Node.js 24.x; CI selects both with setup actions. tdb needs td v0.66.0 or
later at runtime. See [application commands](#application-commands) and the
[version policy](foundation/engineering-policy.md#runtime-and-toolchain-versions).

## Deployment

Pushes trigger no deployment or release. After pushing functional changes,
`make install` rebuilds and installs the local executable to
`~/.local/bin/tdb`; skip it when every change since the last installation is
nonfunctional. Follow the
[deployment policy](foundation/engineering-policy.md#deployment-decisions).

## Application commands

The application supports macOS and Linux with Go 1.27.x. The compiled binary
has no JavaScript runtime dependency. `go.mod` declares the compiler baseline;
CI selects it with setup-go. Application checks also use Node.js 24.x and its
built-in test runner to exercise browser events and API requests without npm
dependencies. `bin/check-application` rejects unsupported Go and Node.js
versions before application validation starts. Building and running tdb does
not need Node.js.
The Make targets also check Go before building, installing, or testing.

- `make build`: compile to `dist/tdb`.
- `make install`: build and install to `~/.local/bin/tdb`.
- `bin/check-application`: tooling tests, browser event tests, formatting, Go
  race tests, vet, and build.
- `bin/check --full`: foundation checks plus `bin/check-application`.

Application validation explicitly selects the root Go package, `internal/`,
and `tests/*.test.mjs`.
It does not traverse worktrees, nested checkouts, or local caches. Build output
stays in the active checkout's ignored `dist/` directory. The
[GitHub workflow](../.github/workflows/check.yml) runs the full gate on macOS
and Linux. No deployment or release is triggered by pushes.

The two application dependencies are Goldmark for GitHub-style Markdown and
Bluemonday for HTML sanitization. Their versions preserve the safe rendering
behavior of the extracted browser. Go's standard library supplies the HTTP
server, proxy, process lifecycle, embedding, and CLI flags.

### Browser verification

Use a disposable td project inside the active checkout for browser checks.
Create its `.td-root` marker before running `td init`. Without that marker,
td can resolve a nested directory to the parent project's database even when
`--work-dir` names the nested directory.

From the repository root, run these commands in a POSIX shell:

```sh
mkdir -p .cache/browser-check
browser_project=$(mktemp -d "$PWD/.cache/browser-check/project.XXXXXX")
printf '.\n' > "$browser_project/.td-root"
td --work-dir "$browser_project" init
td --work-dir "$browser_project" info --json
make build
dist/tdb --work-dir "$browser_project" --no-open
```

Confirm that `base_dir` from `td info` and the startup `project` path both
match the disposable directory before creating test tasks. Use a compatible
td build, selecting it with `--td` if needed. Open the printed browser URL,
check the changed interaction, and read back saved values through td's public
CLI or HTTP API. Keep screenshots and other check output under `.cache/`.
Press Ctrl+C in the terminal that started this tdb process when finished;
stop only processes started for the check.

## Project Starter

`.project-starter.json` records the installed Project Starter release and the
hashes of its managed files. Update them with Project Starter's `bin/sync`,
and record any intentional local change as an override with its reason.

# tdb

A local browser workspace for [td](https://github.com/marcus/td). Run `tdb`
inside a td project to manage tasks, boards, reviews, and agent activity.
The interface is embedded in one Go executable. Node is not needed.

## Install and run

Requires macOS or Linux and a compatible `td` on PATH. To build from source,
use Go 1.27.x:

```sh
go install github.com/jubishop/tdb@latest
cd /path/to/your/project
tdb
```

For a local checkout, `make install` installs to `~/.local/bin`. Ensure that
directory is on PATH. `tdb --help` lists all options.

```sh
tdb -w /path/to/project
tdb --port 8080 --no-open
tdb --td /path/to/compatible/td
tdb --api-url http://127.0.0.1:54321
```

`tdb` uses td's project resolution, including subdirectories, `.td-root`, and
Git worktrees. It reuses a compatible server when possible. Otherwise, it
starts a loopback-only `td serve` with a random bearer token. Press Ctrl+C to
stop tdb and the server it started. A server you started yourself stays running.
Set `TDB_TD_TOKEN` when connecting to a server protected by a known token.
A second tdb process cannot reuse an automatically generated token; reuse the
first browser URL, or start td serve yourself with a known token.

### Required td API changes

The initial tdb version requires the core changes in
[jubishop/td#1](https://github.com/jubishop/td/pull/1). Homebrew td 0.65.0 lacks
these changes. Until they ship in a td release, build that branch and select
the executable with `--td`:

```sh
git clone --branch worktree-browserView https://github.com/jubishop/td.git td-api
cd td-api
go build -o td .
cd /path/to/your/project
tdb --td /absolute/path/to/td-api/td
```

The required API provides project metadata, conditional task writes, and board
moves. tdb checks these capabilities before opening the workspace. It refuses
an older server instead of silently losing protection against concurrent edits.

See the [browser guide](docs/browser.md) for the views, editing, conflict
resolution, review actions, and keyboard shortcuts. td remains responsible for
all task storage, workflow rules, and action history.

## Development

```sh
td init
bin/setup
bin/check --full
make build
```

Use `td` for local work and GitHub Issues for shared scope. See the
[development workflow](docs/development-workflow.md) and
[task tracking guide](docs/task-tracking.md). Routine `bin/check` validates the
foundation only; `bin/check --full` also runs Go tests, vet, formatting, and build.
The frontend is plain JavaScript and CSS with no build step.

## License

[MIT](LICENSE). Browser code was extracted from jubishop/td at commit
`998049ea9777a4b37d54773ddc28cb4d7241610d`. The original td license is retained.
The repository foundation uses Project Starter under its
[MIT notice](LICENSE.project-starter).

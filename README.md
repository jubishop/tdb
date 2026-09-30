# tdb

A local browser workspace for [td](https://github.com/marcus/td). Run `tdb`
inside a td project to manage tasks, boards, reviews, and agent activity.
The interface is embedded in one Go executable. Node is not needed.

## Install and run

Requires macOS or Linux and `td` v0.66.0 or later on PATH. To build from source,
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

Use the same `--port` on each launch to keep browser preferences and task
bookmarks. The default selects an available port, which can change between
launches. See [saved preferences and bookmarks](docs/browser.md#saved-preferences-and-bookmarks).

`tdb` uses td's project resolution, including subdirectories, `.td-root`, and
Git worktrees. It reuses a compatible server when possible. Otherwise, it
starts a loopback-only `td serve` with a random bearer token. Press Ctrl+C to
stop tdb and the server it started. A server you started yourself stays running.
Set `TDB_TD_TOKEN` when connecting to a server protected by a known token.
A second tdb process cannot reuse an automatically generated token; reuse the
first browser URL, or start td serve yourself with a known token.

### Required td version

The client API ships in [td v0.66.0](https://github.com/marcus/td/releases/tag/v0.66.0)
and later. Install or upgrade td using its
[official instructions](https://github.com/marcus/td#installation).
To build td from source and select the executable with `--td`:

```sh
git clone https://github.com/marcus/td.git td-api
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
The frontend is plain JavaScript and CSS with no build step. Application checks
use Node.js 24.x for browser event regression tests, with no npm dependencies.
Running or building tdb does not require Node.js.

## License

[MIT](LICENSE). Browser code was extracted from jubishop/td at commit
`998049ea9777a4b37d54773ddc28cb4d7241610d`. The original td license is retained.
The repository foundation uses Project Starter under its
[MIT notice](LICENSE.project-starter).

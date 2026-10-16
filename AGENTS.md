# tdb project instructions

<!-- project-starter:begin -->
Project Starter manages this block; add project rules after it. Project rules
take precedence over this block and the foundation pages wherever they differ.

- Keep durable guidance and non-derivable context in [memory](memory/README.md),
  and designs, decisions, and research in [docs](docs/README.md). Before
  non-trivial work or writing memory, search with `bin/knowledge search "term"`
  or `bin/knowledge query "question" --no-rerank`, then read results with
  `bin/knowledge get <path> -l 80`. Markdown sources are authoritative.
- If configured QMD fails, tell the user immediately and attempt repair. If
  repair fails, pause knowledge-dependent work until the user approves a
  fallback; never silently substitute `rg` or direct reads. See
  [search failures](docs/foundation/knowledge-search.md#search-failures).
- Use td for work with multiple stages, interruptions, blockers, or handoffs;
  run `td usage --new-session -q` once per new context and keep handoffs
  current. See [task tracking](docs/foundation/task-tracking.md).
- Follow the [engineering policy](docs/foundation/engineering-policy.md):
  fewer dependencies, red-green tests for behavior changes, flaky tests fixed
  or tracked in an issue, cohesive files and pages, checkout-isolated
  validation, and the latest stable toolchains.
- Deliver by [kind of change](docs/foundation/engineering-policy.md#kinds-of-change):
  commit text, such as Markdown and AI skill prose, directly on the default
  branch without checks; commit development code, such as tests, CI, and
  tooling, directly after its checks pass; and deliver production code through
  a pull request after its checks.
- Run [checks](docs/foundation/engineering-policy.md#checks) by change: the
  relevant checks while editing, and `bin/check --full` before merging or
  releasing production code unless an enforced CI gate runs it. Reuse passing
  results.
- Keep accepted decisions separate from proposals, preserve unrelated changes,
  and keep generated caches out of Git. Keep secrets out of public
  repositories only; a private one may commit them.
- Run `bin/setup` after cloning, `bin/doctor` to diagnose setup, and
  `bin/qmd-index` after uncommitted knowledge edits. Managed files listed in
  `.project-starter.json` change only through Project Starter or a recorded
  override with its reason.
<!-- project-starter:end -->

## Application

Go 1.27 or newer; plain JavaScript and CSS embedded under `internal/web/assets/`.
Use `make build` and `make install` for the local executable. Run
`bin/check-application` for tooling tests, browser event tests, Go tests, vet,
formatting, and build after code changes. Application checks require Node.js
24 or newer; no npm packages are needed. Use `bin/check --full`, which runs it after
the foundation checks, for the full delivery gate.

After committing and successfully pushing functional changes, run `make install`
to rebuild and deploy the executable to `/Users/jubi/.local/bin/tdb`. Verify that
the installed file matches `dist/tdb` and that its help command runs. Skip this
local deployment only when all changes since the last installation are
nonfunctional, such as documentation, comments, or agent instructions. Include
the installation result in the delivery report. Do not stop servers owned by
another process when updating the executable.

Use td's public CLI and HTTP API. Do not import td internals or write its
SQLite database directly. Keep backend process ownership explicit: stop only
servers started by this process. Verify browser changes against a disposable
td project using a compatible core build.

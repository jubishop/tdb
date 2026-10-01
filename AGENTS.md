# tdb project instructions

Keep designs, decisions, and research in [docs](docs/README.md).

Use `td` for work with multiple stages, interruptions, blockers, or agent
handoffs. Tasks are optional for straightforward work completed in one session;
read-only questions and small edits need no artificial task records. In each
new agent context, run `td usage --new-session -q` once. Before substantive
work, inspect and reuse relevant tasks. Record meaningful checkpoints and keep
the current handoff accurate. Reuse required checks and actual review; task
statuses do not add a separate review gate. Follow the
[task workflow](docs/task-tracking.md) for setup and commands. Keep
GitHub Issues for shared scope and acceptance criteria; link related issues
from td.

Before non-trivial work or writing memory, search the relevant knowledge.
Use `bin/knowledge search "term"` for known terms and
`bin/knowledge query "question" --no-rerank` for broader questions.
Read focused results with `bin/knowledge get <path> -l 80`.
Use direct reads or `rg` for known paths or after a successful lookup with no
matches. Markdown source files are authoritative. Update existing pages when possible.
If configured QMD fails, report it to the user immediately and attempt repair.
If repair fails, pause knowledge-dependent work until the user approves a
fallback; never silently bypass broken QMD with `rg` or direct reads. Follow
the [search failure policy](docs/development-workflow.md#search-failures).

Follow the engineering policies linked below:

- Prefer fewer dependencies; justify additions by their concrete benefits
  under the [dependency policy](docs/development-workflow.md#third-party-dependencies).
- Cover regression fixes and functional changes with automated tests. Use
  [red-green TDD](docs/development-workflow.md#test-driven-development)
  when practical; explain exceptions. Test observable behavior through public
  interfaces, with fakes at external-system boundaries.
- Keep [test cost proportional](docs/development-workflow.md#test-cost-and-coverage)
  while preserving coverage, independence, and useful complete journeys.
- Keep [files cohesive](docs/development-workflow.md#file-organization);
  approximately 1,000 lines is a review threshold for source, tests, and styles.
- Keep [Markdown pages focused](docs/development-workflow.md#markdown-pages)
  on one topic or reader task, without numeric size limits.
- Isolate [validation inputs and output](docs/development-workflow.md#validation-checkout-isolation)
  to the active checkout.
- Declare supported [runtime and toolchain versions](docs/development-workflow.md#runtime-and-toolchain-versions)
  and keep development, CI, and deployment compatible.

Run `bin/setup` after cloning. Choose checks for the changed files: use
`bin/check --documents-only` for Markdown edits and `bin/check` for foundation
checks only. Keep application tools out of both modes; run relevant application
checks explicitly for code edits.
Run `bin/check --full` locally after setup, test/build infrastructure changes,
or when focused checks leave material uncertainty. Require successful full
validation before merge or release. An enforced full CI gate can supply that
result for ordinary code changes; otherwise run the full check locally before
delivery. Do not run checks for discussion or read-only work. Batch edits
before checking; reuse passing results while relevant inputs are unchanged.
See [the workflow](docs/development-workflow.md#checks-and-project-extensions).
Nonfunctional changes may be pushed without deployment or a package release;
follow the [deployment policy](docs/development-workflow.md#deployment-decisions).
Use `bin/doctor` to inspect local setup and `bin/qmd-index` to refresh search
after uncommitted knowledge edits when current search results are needed.
Hooks refresh search after Git events.

Read the relevant memory or docs index for its format and maintenance rules.
Keep accepted decisions separate from proposals. Preserve existing project
instructions, setup commands, hooks, and unrelated changes when adapting this
foundation. Keep secrets and generated caches out of Git.

## Application

Go 1.27.x; plain JavaScript and CSS embedded under `internal/web/assets/`.
Use `make build` and `make install` for the local executable. Run
`bin/check-app` for browser event tests, Go tests, vet, formatting, and build
after code changes. Application checks require Node.js 24.x; no npm packages
are needed.
Use `bin/check --full` for the full delivery gate.

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

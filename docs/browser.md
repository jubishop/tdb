---
status: current
---

# Browser workspace

`tdb` opens a local web interface for the current project. Use it to
manage the backlog and review agent work while agents continue to use td in
their own tools.

```bash
tdb
tdb --port 8080
tdb --no-open
tdb -w /path/to/project
```

The interface is included in the tdb binary. It needs no account or JavaScript
runtime. Install tdb and a compatible td as described in the [README](../README.md). The server binds to `127.0.0.1` and stays attached
to your terminal. Press **Ctrl+C** to stop it. Closing a browser tab leaves the
server running. tdb starts or reuses the project's `td serve` API. On exit, it stops only a
server it started. Use `--api-url` to connect to an explicit loopback server
and `TDB_TD_TOKEN` for its bearer token when required.

## Views

- **Board:** View tasks by status. Choose a saved board from the sidebar, or
  create one using a [TDQ query](https://github.com/marcus/td/blob/main/website/docs/query-language.md). Drag cards to reorder them
  or perform supported status changes. A status change can remove a task from
  a board whose query no longer matches it. The workspace confirms the change
  and removes the card. If the status changes but reordering fails, the error
  explains which part succeeded.
  In a task's side panel, **Move up** and **Move down** change its order within
  the current status column. These buttons work with the keyboard and move
  past the previous or next visible task. Search and filters determine which
  tasks are visible; reordering preserves every task's status.
- **List:** Search and filter project tasks in a compact table.
- **Reviews:** Open tasks submitted for review. Read their acceptance criteria,
  handoffs, comments, dependencies, and logs before using **Approve** or
  **Reject**. Approval and rejection are explicit actions, never drag gestures.
  Available actions follow the project's review policy. Approval records who
  reviewed the work; self-review requires an explicit choice and a reason.
  A task with a recorded approval can be closed using that review.
- **Activity:** Follow recent task changes, logs, and handoffs. Session timestamps
  show the last recorded activity; they do not indicate whether an agent process
  is currently running.

The **Blocked or waiting** summary includes tasks waiting on dependencies.
The Board's **Blocked** column contains only tasks whose status is Blocked.

Select a task to open its side panel. Its URL can be bookmarked. Use **Edit** to
change its fields, including its parent task or epic. The panel also supports
comments and dependency editing. Descriptions and acceptance criteria use
Markdown, with a **Preview** button. **More fields** contains points, sprint,
due date, deferral, and the minor-task flag.

Text search is the default. It matches task IDs, titles, descriptions, and
labels in Board, List, and Reviews. Select **TDQ** to enter an explicit query.
Type and priority filters apply to task views. Enable **Closed** to include
completed tasks.

## Saved preferences and bookmarks

Use the same fixed port on each launch to retain your selected view, board,
filters, and theme, and to reuse task bookmarks:

```sh
tdb --port 8080
```

Open the printed `http://127.0.0.1:8080` address in the same browser profile.
Browser storage belongs to the full address, including its host and port.
Using `localhost` instead of `127.0.0.1`, changing the port, or changing the
browser profile gives you separate preferences. Clearing site data removes
the saved preferences.

The default `tdb` command selects an available port on each launch. Settings
saved at a previous port remain there, but are not available at the new one.
Use a different fixed port for each workspace you run at the same time.

## Live updates and conflicts

Changes from the CLI, agents, and other browser tabs appear automatically.
The default change-check interval is two seconds; change it with
`--interval 1s`. A disconnected indicator appears if the server stops, and the
browser reconnects automatically when that address is available again.

Live updates preserve unsaved drafts. If a task changes after you open it,
saving the old draft returns a conflict. The saved version remains in place.
The comparison shows the original value, the current saved value, and your
draft for each changed field. Conflicting fields default to the saved value.
Choose the values you want, select **Review selected values**, then edit and
save explicitly. A further concurrent change triggers another comparison.

Changed dialog fields also receive draft protection. Closing a board or review
dialog with Escape, Cancel, or its close button asks before discarding edits.
Leaving or reloading the page also warns when a dialog contains unsaved edits.

Task edits, comments, and dependency saves keep their panel open until the
write finishes. You can leave after success, or retry after an error. A
successful write is reported separately from a failed reload; use **Retry
loading task** if the saved task cannot be displayed.
Reloading or leaving the page also warns while a dialog action is pending,
even when its fields are unchanged. After a failed save, keyboard focus
returns to the submitted control if you have not moved to another control.
After a successful comment or dependency save, focus returns to that form's
input if you are still on the same task and have not moved focus elsewhere.

Writes use the existing HTTP API's shared web session and appear in td's action
history. **Close without review** is for administrative closures such as
duplicates or cancellations, when the project's policy permits it. See the [HTTP API](https://github.com/marcus/td/blob/main/website/docs/http-api/overview.md) for its
workflow and session model. Code review stays in your existing tools; links in
task descriptions can point to code or pull requests.

## Keyboard shortcuts

| Key | Action |
| --- | --- |
| `N` | Create a task |
| `/` | Focus search |
| `1`, `2`, `3`, `4` | Board, List, Reviews, Activity |
| `J`, `K` | Focus the next or previous task |
| `Enter` | Open the focused task |
| `Esc` | Close a panel or dialog |
| `?` | Show shortcuts |

Shortcuts are inactive while typing in a form. Use the sidebar theme control
to choose system, light, or dark mode. All status actions are also available as
buttons in the task panel.

## Development

The server embeds the files in `internal/web/assets/`. Build with `make build`; there is no frontend build step. Rebuild and restart the binary after
editing these files. `td serve` supplies the API and `td monitor` supplies the terminal interface.
Markdown rendering and the browser request boundary belong to tdb.

Preference storage decision (2026-09-30): retain automatic port assignment as
the default and use an explicit fixed port for persistence. This keeps browser
preferences in browser storage and avoids a port registry or additional
server-side storage. The tradeoff is that persistence across launches requires
the user to choose a stable port.

Dialog draft decision (2026-09-30): the user chose the same discard warning for
dialog edits as for task drafts, including Escape and Cancel. This protects
board queries and review reasons at the cost of one confirmation when
discarding changed fields.

Text search decision (2026-09-30): the user chose to include labels consistently
in Board, List, and Reviews. This preserves label search from Board and makes
the same search behave consistently across task views. Text searches use a
quoted TDQ expression so filtering and pagination stay on the td server;
explicit TDQ queries retain their existing behavior.

Pending-save decision (2026-09-30): the user chose to wait for task edits,
comments, and dependency saves before leaving the panel, matching dialog saves.
This prevents a discard action from appearing to cancel a write already sent
to td. Navigation waits for the request at the cost of a delay on slow saves.

Keyboard ordering decision (2026-09-30): the user chose to add **Move up** and
**Move down** controls for a selected task on a board. This makes board ordering
available without dragging, at the cost of two additional task-panel controls.
Moves use the visible order within the task's current status column.

Blocked summary decision (2026-09-30): the user chose to retain the existing
count and label it **Blocked or waiting**. This keeps dependency-blocked work
visible while distinguishing the summary from the Board's Blocked status column.

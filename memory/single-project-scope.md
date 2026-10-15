---
name: single-project-scope
description: Keep tdb a single-project workspace; build cross-project views on td sync instead.
type: feedback
---

# Keep tdb single-project

tdb stays a simple browser workspace for one td project. Do not add
multi-project modes, aggregate dashboards, or project-list configuration to it.

**Why:** On 2026-10-14 the user started a `tdb --all` overview, which would have
run one `td serve` per project (about 31 MB each, roughly 700 MB for 23
projects) and polled them all. The user abandoned it the same day. They want
tdb kept simple and the cross-project view built "the right way" on a td sync
server (planned at td.jubishop.com), which already holds every synced project
in one place.

**How to apply:** Send requests for statistics or views across repositories to
the td sync work, not to tdb. Improvements to the single-project workspace are
still in scope.

---
name: Agenda — Proyectos y Tareas module
description: Durable scoping/authz decisions for the agenda (projects + tasks) module and why it sits outside the role-permission system
---

# Agenda is the only non-singleton data

Everything else in this app is a shared singleton (one `taller_state` row). The agenda
(projects + tasks) is the sole per-user / collaborative data. The legacy per-user todos
table is retained ONLY for a one-time startup migration into general tasks — do not build
new features on it.

# Visibility & authorization decisions

- **Personal project**: visible/writable only by owner.
- **Shared project**: visible to all authed users; any authed user may CRUD its tasks, but
  only the owner may rename/delete the project itself.
- **General task** (no project): personal, owner-only.

**Assignees ("Asignado a") are shared-project only, enforced server-side.** On create and
update, assignees are forced empty for personal projects and general tasks, and cleared when
a task is moved off a shared project. The UI hiding the column is NOT the enforcement.
**Why:** assignment only makes sense for multi-person collaboration; allowing it elsewhere
produced inconsistent data via direct API calls. **How to apply:** any new task write path
must re-derive "is destination shared?" and gate assignees on it — never trust the client.

# Why agenda bypasses the role-permission matrix

The agenda is a personal feature every authenticated user should always have, so it is
intentionally excluded from the `can()` permission gate (the sidebar shows it
unconditionally). Do not add it to the module permission list. **Why:** gating it behind
roles would let an admin accidentally remove every user's personal task list.

# completedAt is transition-aware, not a re-stamp

Completion is driven by `estado` (the enum), not a boolean. `completedAt` is stamped only on
a real transition INTO "hecho" and cleared only on a real transition OUT of it — never
re-stamped on an idempotent re-send. **Why:** monthly/period reporting depends on an accurate
first-completion timestamp.

# Técnicos management is admin-only

Técnico list management is a subtab inside the admin page (admin-view only), not a top-level
module. A stale `tecnicos` permission key remains in the module list — kept to avoid
disturbing seeded role permissions; treat it as dead surface.

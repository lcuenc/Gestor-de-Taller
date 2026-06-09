---
name: Personal agenda / todos module
description: How the per-user to-do module is scoped and why "agenda" bypasses the role-permission system
---

# Per-user todos (Agenda module)

`user_todos` table is the only **per-user** data in this otherwise singleton app
(everything else lives in the shared `taller_state` row). All `/todos` routes are
`requireAuth` and scoped to `req.auth.user.id`; PATCH/DELETE use `and(eq(id), eq(userId))`
so a user can never touch another user's rows.

**Why "agenda" is not in the role-permission matrix:** it is a personal feature every
authenticated user should always have. The sidebar filter is
`n.id === "agenda" || can(n.id, "view")` — "agenda" is intentionally excluded from the
`can()` gate. Do not add an "agenda" key to MODULES.

# completedAt is transition-aware

`PATCH /todos/:id` reads the current row first and only stamps `completedAt = now`
on a real `false -> true` transition (and clears it on `true -> false`). Do NOT set
it whenever `hecho:true` is merely present in the body — an idempotent re-send would
overwrite the original completion time. Priority is whitelisted server-side
(alta/media/baja), defaults to "media".

# Técnicos management is admin-only

Técnico list management is NOT a top-level module anymore. It lives as a subtab inside
AdminPage (which only renders for `can("admin","view")`). The `tecnicos` key still exists
in the MODULES permission matrix but is a dead/stale permission surface (no navigable
module maps to it) — kept to avoid touching seeded role permissions.

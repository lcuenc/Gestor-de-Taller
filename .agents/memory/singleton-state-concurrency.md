---
name: Singleton state concurrency & permission diffs (Taller)
description: How the taller_state singleton row enforces atomic optimistic concurrency and section-level write authorization, and the jsonb pitfall behind it.
---

# Taller singleton-state write path

The whole app state (equipos, gpvList, tecnicos, layout) lives in ONE row of
`taller_state`. The `PUT /taller/state` handler is the only writer and must stay
both atomic and permission-aware.

## Atomic optimistic concurrency
- All writes run inside a `db.transaction`. First statement acquires
  `pg_advisory_xact_lock(<key>)` so EVERY writer serializes — including the
  first-ever insert when the table is empty (FOR UPDATE alone can't stop two
  concurrent inserts into an empty singleton table, producing duplicate rows).
- After locking, `SELECT ... .for("update")`, then compare `updatedAt` against
  the client's `expectedUpdatedAt` as ISO **strings** (not `eq(updatedAt, new
  Date(...))` — Postgres timestamps carry microseconds, JS Date only ms, so a
  Date comparison gives spurious 409s).
- An update to an existing row with a missing/mismatched `expectedUpdatedAt` →
  409 (forces client reload). Only the first-create path may omit the stamp.
- **Why:** prevents lost updates between concurrent editors; the frontend always
  sends the stamp it got from the last GET.

## Section-level write authorization
- Each state section is authorized against the user's module permissions on a
  semantic diff: equipos→`taller` OR `venta` write (venta "entregar"/"a
  disponible" legitimately mutates equipos), gpvList→`venta`, layout→`layout`,
  tecnicos→`tecnicos`. A changed section the user can't write → 403.
- **jsonb key-order pitfall:** Postgres `jsonb` does NOT preserve object key
  order, so a naive `JSON.stringify(a) !== JSON.stringify(b)` diff reports
  unchanged sections as changed → spurious 403s for legit editors. Compare with
  a recursive **canonical** serializer that sorts object keys (arrays keep
  order). Any future diff of stored jsonb vs an incoming body must do this.
- GET stays `requireAuth` only (single shared blob; frontend gates tab/visibility).

## Verifying over HTTPS
Session cookie is `secure`, so curl must hit `https://$REPLIT_DEV_DOMAIN`, not
`localhost:80`. Re-fetch the stamp before each write test — any successful (even
no-op) PUT bumps `updatedAt` and invalidates a reused stamp.

---
name: Taller-state jsonb schema evolution
description: How to add a new field to the Equipo/GPV singleton jsonb without breaking GET /taller/state on legacy rows.
---

# Adding a field to the Equipo (or GPV) singleton jsonb

The server validates its **GET /taller/state response** against the generated zod
schema. Equipos live as a single jsonb row in `taller_state` — there is no
per-row migration. Legacy rows already in the DB will NOT have any field you add.

**Rule:** when adding a new Equipo/GPV field, add it to OpenAPI `properties` but
**leave it OUT of `required`**. Keep it required only at the TS `interface` level,
and default it in `normalizeEquipo` (applied at state ingress, ~App.tsx setEquipos).

**Why:** marking a new field `required` in the spec makes the server's response
`.parse()` throw a ZodError on every legacy equipo lacking it, returning 500 and
leaving the app stuck on "Cargando datos…". The optional-in-spec / required-in-TS
asymmetry is a deliberate compatibility bridge — normalization guarantees the
value client-side.

**How to apply:** spec property (optional) → `pnpm --filter @workspace/api-spec run codegen`
→ TS interface (required) → `normalizeEquipo` default → modal initial form state →
filter/render. No server route change needed (equipos persist as generic jsonb).
To eventually make it `required`, do a one-time backfill/save-time canonicalization first.

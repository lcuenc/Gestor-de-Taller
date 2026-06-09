---
name: Taller delivery & history-based reporting
description: Why monthly "salidas" reporting must use history events, not the current equipos list
---

# Equipos leave the list on delivery

When an equipo is delivered/sold it is **removed** from the live `equipos` collection
(alquiler deliveries via `handleListo` filter; venta via `confirmarEntrega`). Both produce
an `"eliminado"` history event. Genuine manual deletions also fire `"eliminado"`.

**Why this matters:** any month-over-month "deliveries/exits" report MUST derive from history
events, not from filtering the current `equipos` list — delivered equipos are gone from it and
would lose modelo/cliente/interno, and any cumplimiento%/SLA denominator built from survivors is
biased.

**How to apply:**
- Derive monthly exits from `campo === "eliminado"` history rows; enrich self-contained from the
  event's `valorAnterior` (stores `"modelo — interno"`), use `h.usuario` / `h.timestamp`.
- Call the metric "Salidas" not "Entregas" — `eliminado` covers all removals, not only deliveries.
  If strict deliveries are ever needed, add a distinct typed history event (e.g. `entregado`).
- `tiempoPorEstado`: when the first estado change has empty `valorAnterior`, the pre-first segment
  is intentionally dropped (conservative, no misattribution) — leave as-is.
- `/taller/history` returns newest rows capped (currently 50000) — fine for this tiny shop; add
  pagination only if row count/response time becomes a real problem.

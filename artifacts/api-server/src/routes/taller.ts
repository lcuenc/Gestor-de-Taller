import { Router, type IRouter } from "express";
import { eq, sql, desc } from "drizzle-orm";
import { db, tallerStateTable, equipoHistoryTable, type InsertEquipoHistory } from "@workspace/db";
import { SaveTallerStateBody, GetTallerStateResponse } from "@workspace/api-zod";
import { requireAuth, type ModuleId } from "../lib/auth";

const router: IRouter = Router();

// Stable key for the transaction-scoped advisory lock guarding the singleton state row.
const TALLER_STATE_LOCK = 728149;

const DEFAULT_TECNICOS = [
  "LUKAS ROBERTO GUILLER","KASPARIAN CHRISTIAN G","TWERDOCHLIB CLAUDIO",
  "GONZALEZ JOSE","VERA ABEL DOLORES","SZAPLAY MATIAS","PEREIRO RODOLFO",
  "URQUIA LUCAS AGUSTIN","SANSOGNE HERNAN ALBERTO","RIVERO CHANIL ALAN",
  "GIMENEZ MARCOS","CABAÑA JESUS","DE LA FUENTE ERIK","LASTRETTI ALAN",
  "HUANCA FACUNDO","CASTRO NEGUEN","RAMIREZ ALEX",
];

// Fields to track for per-equipo audit history.
const TRACKED_FIELDS = ["estado", "tecnicos", "prioridad", "falla", "observacion", "cliente", "modelo", "destino"] as const;
type TrackedField = (typeof TRACKED_FIELDS)[number];

type EquipoLike = { id: number; modelo?: string; interno?: string } & Record<TrackedField, unknown>;

function fieldToString(field: TrackedField, value: unknown): string {
  if (field === "tecnicos" && Array.isArray(value)) {
    return (value as string[]).join(", ") || "—";
  }
  return String(value ?? "—");
}

function buildHistoryRows(
  oldEquipos: EquipoLike[],
  newEquipos: EquipoLike[],
  usuario: string,
): InsertEquipoHistory[] {
  const rows: InsertEquipoHistory[] = [];

  for (const newEq of newEquipos) {
    const oldEq = oldEquipos.find(e => e.id === newEq.id);
    if (!oldEq) {
      // New equipo — ingreso event
      rows.push({
        equipoId: newEq.id,
        campo: "ingreso",
        valorAnterior: null,
        valorNuevo: [newEq.modelo, newEq.interno].filter(Boolean).join(" — ") || String(newEq.id),
        usuario,
      });
    } else {
      // Changed fields
      for (const field of TRACKED_FIELDS) {
        const oldV = JSON.stringify(oldEq[field] ?? null);
        const newV = JSON.stringify(newEq[field] ?? null);
        if (oldV !== newV) {
          rows.push({
            equipoId: newEq.id,
            campo: field,
            valorAnterior: fieldToString(field, oldEq[field]),
            valorNuevo: fieldToString(field, newEq[field]),
            usuario,
          });
        }
      }
    }
  }

  // Deleted equipos
  for (const oldEq of oldEquipos) {
    if (!newEquipos.find(e => e.id === oldEq.id)) {
      rows.push({
        equipoId: oldEq.id,
        campo: "eliminado",
        valorAnterior: [oldEq.modelo, oldEq.interno].filter(Boolean).join(" — ") || String(oldEq.id),
        valorNuevo: null,
        usuario,
      });
    }
  }

  return rows;
}

router.get("/taller/state", requireAuth, async (_req, res): Promise<void> => {
  const rows = await db.select().from(tallerStateTable).limit(1);
  if (!rows.length) {
    res.json(GetTallerStateResponse.parse({
      equipos: [],
      gpvList: [],
      tecnicos: DEFAULT_TECNICOS,
      layout: {},
      updatedAt: null,
    }));
    return;
  }
  const row = rows[0];
  res.json(GetTallerStateResponse.parse({
    equipos: row.equipos,
    gpvList: row.gpvList,
    tecnicos: row.tecnicos,
    layout: row.layout ?? {},
    updatedAt: row.updatedAt?.toISOString() ?? null,
  }));
});

router.get("/taller/equipos/:equipoId/history", requireAuth, async (req, res): Promise<void> => {
  const equipoId = Number(req.params.equipoId);
  if (!Number.isInteger(equipoId) || equipoId <= 0) {
    res.status(400).json({ error: "equipoId inválido" });
    return;
  }
  const rows = await db
    .select()
    .from(equipoHistoryTable)
    .where(eq(equipoHistoryTable.equipoId, equipoId))
    .orderBy(desc(equipoHistoryTable.createdAt))
    .limit(200);

  res.json(rows.map(r => ({
    id: r.id,
    equipoId: r.equipoId,
    campo: r.campo,
    valorAnterior: r.valorAnterior ?? null,
    valorNuevo: r.valorNuevo ?? null,
    usuario: r.usuario,
    timestamp: r.createdAt.toISOString(),
  })));
});

router.put("/taller/state", requireAuth, async (req, res): Promise<void> => {
  const parsed = SaveTallerStateBody.safeParse(req.body);
  if (!parsed.success) {
    req.log.warn({ errors: parsed.error.message }, "Invalid taller state body");
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  const { equipos, gpvList, tecnicos, layout, expectedUpdatedAt } = parsed.data;

  // Any write permission (create/edit/delete) on a module counts as "can write that section".
  const perms = req.auth!.role.permissions;
  const canWrite = (m: ModuleId): boolean => {
    const p = perms?.[m];
    return !!(p && (p.create || p.edit || p.delete));
  };
  // Canonical, key-order-insensitive serialization. Postgres jsonb does not
  // preserve object key order, so a naive JSON.stringify diff yields false
  // positives (and spurious 403s) for semantically-unchanged sections.
  const canonical = (v: unknown): unknown => {
    if (Array.isArray(v)) return v.map(canonical);
    if (v && typeof v === "object") {
      const obj = v as Record<string, unknown>;
      return Object.keys(obj)
        .sort()
        .reduce<Record<string, unknown>>((acc, k) => {
          acc[k] = canonical(obj[k]);
          return acc;
        }, {});
    }
    return v;
  };
  const sectionChanged = (a: unknown, b: unknown): boolean =>
    JSON.stringify(canonical(a ?? null)) !== JSON.stringify(canonical(b ?? null));

  const usuario = req.auth!.user.username;

  try {
    const result = await db.transaction(async (tx) => {
      // Serialize ALL writers (including the first-ever insert when no row
      // exists yet) on a transaction-scoped advisory lock. FOR UPDATE alone
      // can't prevent two concurrent inserts into an empty singleton table.
      await tx.execute(sql`select pg_advisory_xact_lock(${TALLER_STATE_LOCK})`);

      const existing = await tx.select().from(tallerStateTable).limit(1).for("update");
      const cur = existing[0];

      // Optimistic-concurrency guard. Updates to an existing row MUST carry the
      // expected stamp; a missing stamp means a blind write and is rejected to
      // avoid silent lost updates. String compare avoids timestamp-precision pitfalls.
      if (cur) {
        const currentStamp = cur.updatedAt?.toISOString() ?? null;
        if (!expectedUpdatedAt || currentStamp !== expectedUpdatedAt) {
          return { conflict: true as const, row: cur };
        }
      }

      // Authorize each changed section against the user's module permissions.
      if (cur) {
        // equipos are mutated both from Taller (edits) and Venta (entrega / pasar a disponible).
        if (sectionChanged(equipos, cur.equipos) && !canWrite("taller") && !canWrite("venta")) {
          return { forbidden: true as const, module: "taller" };
        }
        if (sectionChanged(gpvList, cur.gpvList) && !canWrite("venta")) {
          return { forbidden: true as const, module: "venta" };
        }
        if (sectionChanged(layout ?? {}, cur.layout ?? {}) && !canWrite("layout")) {
          return { forbidden: true as const, module: "layout" };
        }
        if (sectionChanged(tecnicos, cur.tecnicos) && !canWrite("tecnicos")) {
          return { forbidden: true as const, module: "tecnicos" };
        }

        // Record equipo history before updating
        const historyRows = buildHistoryRows(
          cur.equipos as EquipoLike[],
          equipos as EquipoLike[],
          usuario,
        );
        if (historyRows.length > 0) {
          await tx.insert(equipoHistoryTable).values(historyRows);
        }

        const updated = await tx
          .update(tallerStateTable)
          .set({ equipos, gpvList, tecnicos, layout })
          .where(eq(tallerStateTable.id, cur.id))
          .returning();
        return { row: updated[0] };
      }

      // Creating the initial state requires operational write access.
      if (!canWrite("taller") && !canWrite("venta")) {
        return { forbidden: true as const, module: "taller" };
      }

      // Record ingreso events for all equipos in the initial save
      const historyRows = buildHistoryRows([], equipos as EquipoLike[], usuario);
      if (historyRows.length > 0) {
        await tx.insert(equipoHistoryTable).values(historyRows);
      }

      const inserted = await tx
        .insert(tallerStateTable)
        .values({ equipos, gpvList, tecnicos, layout })
        .returning();
      return { row: inserted[0] };
    });

    if ("forbidden" in result) {
      res.status(403).json({ error: "No tenés permiso para modificar esta sección." });
      return;
    }
    if ("conflict" in result) {
      res.status(409).json({
        error: "Otro usuario guardó cambios más recientes. Se recargaron los datos.",
        current: GetTallerStateResponse.parse({
          equipos: result.row.equipos,
          gpvList: result.row.gpvList,
          tecnicos: result.row.tecnicos,
          layout: result.row.layout ?? {},
          updatedAt: result.row.updatedAt?.toISOString() ?? null,
        }),
      });
      return;
    }

    const row = result.row;
    res.json(GetTallerStateResponse.parse({
      equipos: row.equipos,
      gpvList: row.gpvList,
      tecnicos: row.tecnicos,
      layout: row.layout ?? {},
      updatedAt: row.updatedAt?.toISOString() ?? null,
    }));
  } catch (err) {
    req.log.error({ err }, "Failed to save taller state");
    res.status(500).json({ error: "No se pudo guardar el estado." });
  }
});

export default router;

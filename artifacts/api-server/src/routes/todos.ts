import { Router, type IRouter } from "express";
import { and, eq, desc } from "drizzle-orm";
import { db, userTodosTable } from "@workspace/db";
import { CreateTodoBody, UpdateTodoBody } from "@workspace/api-zod";
import { requireAuth } from "../lib/auth";

const router: IRouter = Router();

type Prioridad = "alta" | "media" | "baja";
const PRIORIDADES: Prioridad[] = ["alta", "media", "baja"];

function toDTO(r: typeof userTodosTable.$inferSelect) {
  return {
    id: r.id,
    texto: r.texto,
    hecho: r.hecho,
    prioridad: (PRIORIDADES.includes(r.prioridad as Prioridad) ? r.prioridad : "media") as Prioridad,
    createdAt: r.createdAt.toISOString(),
    completedAt: r.completedAt ? r.completedAt.toISOString() : null,
    updatedAt: r.updatedAt.toISOString(),
  };
}

router.get("/todos", requireAuth, async (req, res): Promise<void> => {
  const userId = req.auth!.user.id;
  const rows = await db
    .select()
    .from(userTodosTable)
    .where(eq(userTodosTable.userId, userId))
    .orderBy(desc(userTodosTable.createdAt));
  res.json(rows.map(toDTO));
});

router.post("/todos", requireAuth, async (req, res): Promise<void> => {
  const userId = req.auth!.user.id;
  const parsed = CreateTodoBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Datos inválidos" });
    return;
  }
  const texto = parsed.data.texto.trim();
  if (!texto) {
    res.status(400).json({ error: "El texto no puede estar vacío" });
    return;
  }
  const prioridad = PRIORIDADES.includes(parsed.data.prioridad as Prioridad)
    ? (parsed.data.prioridad as Prioridad)
    : "media";
  const [row] = await db
    .insert(userTodosTable)
    .values({ userId, texto, prioridad })
    .returning();
  res.status(201).json(toDTO(row));
});

router.patch("/todos/:id", requireAuth, async (req, res): Promise<void> => {
  const userId = req.auth!.user.id;
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id <= 0) {
    res.status(400).json({ error: "id inválido" });
    return;
  }
  const parsed = UpdateTodoBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Datos inválidos" });
    return;
  }
  const [current] = await db
    .select()
    .from(userTodosTable)
    .where(and(eq(userTodosTable.id, id), eq(userTodosTable.userId, userId)));
  if (!current) {
    res.status(404).json({ error: "Tarea no encontrada" });
    return;
  }

  const patch: { texto?: string; hecho?: boolean; prioridad?: Prioridad; completedAt?: Date | null } = {};
  if (parsed.data.texto !== undefined) {
    const texto = parsed.data.texto.trim();
    if (!texto) {
      res.status(400).json({ error: "El texto no puede estar vacío" });
      return;
    }
    patch.texto = texto;
  }
  if (parsed.data.hecho !== undefined && parsed.data.hecho !== current.hecho) {
    patch.hecho = parsed.data.hecho;
    // Only stamp completedAt on a real transition so an idempotent
    // PATCH {hecho:true} never overwrites the original completion time.
    patch.completedAt = parsed.data.hecho ? new Date() : null;
  }
  if (parsed.data.prioridad !== undefined && PRIORIDADES.includes(parsed.data.prioridad as Prioridad)) {
    patch.prioridad = parsed.data.prioridad as Prioridad;
  }
  if (Object.keys(patch).length === 0) {
    res.json(toDTO(current));
    return;
  }
  const [row] = await db
    .update(userTodosTable)
    .set(patch)
    .where(and(eq(userTodosTable.id, id), eq(userTodosTable.userId, userId)))
    .returning();
  if (!row) {
    res.status(404).json({ error: "Tarea no encontrada" });
    return;
  }
  res.json(toDTO(row));
});

router.delete("/todos/:id", requireAuth, async (req, res): Promise<void> => {
  const userId = req.auth!.user.id;
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id <= 0) {
    res.status(400).json({ error: "id inválido" });
    return;
  }
  const [row] = await db
    .delete(userTodosTable)
    .where(and(eq(userTodosTable.id, id), eq(userTodosTable.userId, userId)))
    .returning();
  if (!row) {
    res.status(404).json({ error: "Tarea no encontrada" });
    return;
  }
  res.json({ status: "ok" });
});

export default router;

import { Router, type IRouter } from "express";
import { and, eq, desc } from "drizzle-orm";
import { db, userTodosTable } from "@workspace/db";
import { CreateTodoBody, UpdateTodoBody } from "@workspace/api-zod";
import { requireAuth } from "../lib/auth";

const router: IRouter = Router();

function toDTO(r: typeof userTodosTable.$inferSelect) {
  return {
    id: r.id,
    texto: r.texto,
    hecho: r.hecho,
    createdAt: r.createdAt.toISOString(),
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
  const [row] = await db
    .insert(userTodosTable)
    .values({ userId, texto })
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
  const patch: { texto?: string; hecho?: boolean } = {};
  if (parsed.data.texto !== undefined) {
    const texto = parsed.data.texto.trim();
    if (!texto) {
      res.status(400).json({ error: "El texto no puede estar vacío" });
      return;
    }
    patch.texto = texto;
  }
  if (parsed.data.hecho !== undefined) patch.hecho = parsed.data.hecho;
  if (Object.keys(patch).length === 0) {
    res.status(400).json({ error: "Nada para actualizar" });
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

import { db, userTodosTable, agendaTasksTable } from "@workspace/db";
import { logger } from "./logger";

// One-time move of legacy per-user todos into the agenda as general tasks.
// Idempotent: once moved, user_todos is empty so subsequent runs are no-ops.
export async function migrateTodosToAgenda(): Promise<void> {
  await db.transaction(async (tx) => {
    const todos = await tx.select().from(userTodosTable);
    if (!todos.length) return;
    await tx.insert(agendaTasksTable).values(
      todos.map((t) => ({
        projectId: null,
        ownerId: t.userId,
        texto: t.texto,
        estado: t.hecho ? ("hecho" as const) : ("pendiente" as const),
        prioridad: t.prioridad,
        fechaLimite: null,
        asignados: [],
        orden: t.orden,
        completedAt: t.completedAt,
        createdAt: t.createdAt,
      })),
    );
    await tx.delete(userTodosTable);
    logger.info({ count: todos.length }, "Migrated legacy todos into agenda");
  });
}

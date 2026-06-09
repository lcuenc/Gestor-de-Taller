import { Router, type IRouter } from "express";
import { and, eq, or, inArray, isNull, asc, desc } from "drizzle-orm";
import {
  db,
  agendaProjectsTable,
  agendaTasksTable,
  usersTable,
  type AgendaProjectRow,
  type AgendaTaskRow,
} from "@workspace/db";
import {
  CreateAgendaProjectBody,
  UpdateAgendaProjectBody,
  CreateAgendaTaskBody,
  UpdateAgendaTaskBody,
} from "@workspace/api-zod";
import { requireAuth } from "../lib/auth";

const router: IRouter = Router();

type Estado = "pendiente" | "en_progreso" | "hecho";
const ESTADOS: Estado[] = ["pendiente", "en_progreso", "hecho"];
type Prioridad = "alta" | "media" | "baja";
const PRIORIDADES: Prioridad[] = ["alta", "media", "baja"];

function normEstado(v: unknown): Estado {
  return ESTADOS.includes(v as Estado) ? (v as Estado) : "pendiente";
}
function normPrioridad(v: unknown): Prioridad {
  return PRIORIDADES.includes(v as Prioridad) ? (v as Prioridad) : "media";
}
function normAsignados(v: unknown): number[] {
  if (!Array.isArray(v)) return [];
  const ids = v.filter((x): x is number => Number.isInteger(x) && (x as number) > 0);
  return Array.from(new Set(ids));
}

function projectDTO(r: AgendaProjectRow, ownerNombre: string) {
  return {
    id: r.id,
    nombre: r.nombre,
    compartido: r.compartido,
    ownerId: r.ownerId,
    ownerNombre,
    color: r.color,
    orden: r.orden,
    createdAt: r.createdAt.toISOString(),
  };
}

function taskDTO(r: AgendaTaskRow) {
  return {
    id: r.id,
    projectId: r.projectId,
    ownerId: r.ownerId,
    texto: r.texto,
    estado: normEstado(r.estado),
    prioridad: normPrioridad(r.prioridad),
    fechaLimite: r.fechaLimite,
    asignados: normAsignados(r.asignados),
    completedAt: r.completedAt ? r.completedAt.toISOString() : null,
    createdAt: r.createdAt.toISOString(),
    updatedAt: r.updatedAt.toISOString(),
  };
}

// A user can manage tasks inside a project if it's shared (anyone) or they own it.
function canManageProjectTasks(project: AgendaProjectRow, userId: number): boolean {
  return project.compartido || project.ownerId === userId;
}

router.get("/agenda", requireAuth, async (req, res): Promise<void> => {
  const userId = req.auth!.user.id;

  const projectRows = await db
    .select({ project: agendaProjectsTable, ownerNombre: usersTable.nombre, ownerUsername: usersTable.username })
    .from(agendaProjectsTable)
    .leftJoin(usersTable, eq(agendaProjectsTable.ownerId, usersTable.id))
    .where(or(eq(agendaProjectsTable.compartido, true), eq(agendaProjectsTable.ownerId, userId)))
    .orderBy(asc(agendaProjectsTable.orden), asc(agendaProjectsTable.createdAt));

  const visibleProjectIds = projectRows.map((r) => r.project.id);

  // Tasks the user can see: tasks in any visible project, plus their own general tasks.
  const taskRows = await db
    .select()
    .from(agendaTasksTable)
    .where(
      or(
        and(isNull(agendaTasksTable.projectId), eq(agendaTasksTable.ownerId, userId)),
        visibleProjectIds.length
          ? inArray(agendaTasksTable.projectId, visibleProjectIds)
          : undefined,
      ),
    )
    .orderBy(asc(agendaTasksTable.orden), desc(agendaTasksTable.createdAt));

  const usuarios = await db
    .select({ id: usersTable.id, username: usersTable.username, nombre: usersTable.nombre })
    .from(usersTable)
    .where(eq(usersTable.activo, true))
    .orderBy(asc(usersTable.username));

  res.json({
    projects: projectRows.map((r) => projectDTO(r.project, r.ownerNombre ?? r.ownerUsername ?? "")),
    tasks: taskRows.map(taskDTO),
    usuarios,
  });
});

router.post("/agenda/projects", requireAuth, async (req, res): Promise<void> => {
  const userId = req.auth!.user.id;
  const parsed = CreateAgendaProjectBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Datos inválidos" });
    return;
  }
  const nombre = parsed.data.nombre.trim();
  if (!nombre) {
    res.status(400).json({ error: "El nombre no puede estar vacío" });
    return;
  }
  const [row] = await db
    .insert(agendaProjectsTable)
    .values({
      nombre,
      compartido: parsed.data.compartido ?? false,
      color: parsed.data.color?.trim() || "blue",
      ownerId: userId,
    })
    .returning();
  res.status(201).json(projectDTO(row, req.auth!.user.nombre || req.auth!.user.username));
});

router.patch("/agenda/projects/:id", requireAuth, async (req, res): Promise<void> => {
  const userId = req.auth!.user.id;
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id <= 0) {
    res.status(400).json({ error: "id inválido" });
    return;
  }
  const parsed = UpdateAgendaProjectBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Datos inválidos" });
    return;
  }
  const [current] = await db
    .select()
    .from(agendaProjectsTable)
    .where(eq(agendaProjectsTable.id, id));
  if (!current) {
    res.status(404).json({ error: "Proyecto no encontrado" });
    return;
  }
  if (current.ownerId !== userId) {
    res.status(403).json({ error: "Solo el dueño puede editar el proyecto" });
    return;
  }
  const patch: Partial<typeof agendaProjectsTable.$inferInsert> = {};
  if (parsed.data.nombre !== undefined) {
    const nombre = parsed.data.nombre.trim();
    if (!nombre) {
      res.status(400).json({ error: "El nombre no puede estar vacío" });
      return;
    }
    patch.nombre = nombre;
  }
  if (parsed.data.compartido !== undefined) patch.compartido = parsed.data.compartido;
  if (parsed.data.color !== undefined) patch.color = parsed.data.color.trim() || "blue";

  const [row] = Object.keys(patch).length
    ? await db.update(agendaProjectsTable).set(patch).where(eq(agendaProjectsTable.id, id)).returning()
    : [current];
  res.json(projectDTO(row, req.auth!.user.nombre || req.auth!.user.username));
});

router.delete("/agenda/projects/:id", requireAuth, async (req, res): Promise<void> => {
  const userId = req.auth!.user.id;
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id <= 0) {
    res.status(400).json({ error: "id inválido" });
    return;
  }
  const [current] = await db
    .select()
    .from(agendaProjectsTable)
    .where(eq(agendaProjectsTable.id, id));
  if (!current) {
    res.status(404).json({ error: "Proyecto no encontrado" });
    return;
  }
  if (current.ownerId !== userId) {
    res.status(403).json({ error: "Solo el dueño puede eliminar el proyecto" });
    return;
  }
  await db.delete(agendaProjectsTable).where(eq(agendaProjectsTable.id, id));
  res.json({ status: "ok" });
});

router.post("/agenda/tasks", requireAuth, async (req, res): Promise<void> => {
  const userId = req.auth!.user.id;
  const parsed = CreateAgendaTaskBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Datos inválidos" });
    return;
  }
  const texto = parsed.data.texto.trim();
  if (!texto) {
    res.status(400).json({ error: "El texto no puede estar vacío" });
    return;
  }
  const projectId = parsed.data.projectId ?? null;
  // Assignees are only meaningful on shared projects; personal/general tasks force [].
  let allowAsignados = false;
  if (projectId !== null) {
    const [project] = await db
      .select()
      .from(agendaProjectsTable)
      .where(eq(agendaProjectsTable.id, projectId));
    if (!project) {
      res.status(404).json({ error: "Proyecto no encontrado" });
      return;
    }
    if (!canManageProjectTasks(project, userId)) {
      res.status(403).json({ error: "No podés agregar tareas a este proyecto" });
      return;
    }
    allowAsignados = project.compartido;
  }
  const estado = normEstado(parsed.data.estado);
  const [row] = await db
    .insert(agendaTasksTable)
    .values({
      projectId,
      ownerId: userId,
      texto,
      estado,
      prioridad: normPrioridad(parsed.data.prioridad),
      fechaLimite: parsed.data.fechaLimite ?? null,
      asignados: allowAsignados ? normAsignados(parsed.data.asignados) : [],
      completedAt: estado === "hecho" ? new Date() : null,
    })
    .returning();
  res.status(201).json(taskDTO(row));
});

// Resolve whether the current user may write to a task (given its project).
// Returns the task and its project (null for general tasks) on success.
async function loadTaskForWrite(
  taskId: number,
  userId: number,
): Promise<{ task: AgendaTaskRow; project: AgendaProjectRow | null } | { error: { status: number; message: string } }> {
  const [task] = await db.select().from(agendaTasksTable).where(eq(agendaTasksTable.id, taskId));
  if (!task) return { error: { status: 404, message: "Tarea no encontrada" } };
  if (task.projectId === null) {
    if (task.ownerId !== userId) return { error: { status: 403, message: "No tenés acceso a esta tarea" } };
    return { task, project: null };
  }
  const [project] = await db
    .select()
    .from(agendaProjectsTable)
    .where(eq(agendaProjectsTable.id, task.projectId));
  if (!project) return { error: { status: 404, message: "Proyecto no encontrado" } };
  if (!canManageProjectTasks(project, userId)) {
    return { error: { status: 403, message: "No tenés acceso a esta tarea" } };
  }
  return { task, project };
}

router.patch("/agenda/tasks/:id", requireAuth, async (req, res): Promise<void> => {
  const userId = req.auth!.user.id;
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id <= 0) {
    res.status(400).json({ error: "id inválido" });
    return;
  }
  const parsed = UpdateAgendaTaskBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Datos inválidos" });
    return;
  }
  const loaded = await loadTaskForWrite(id, userId);
  if ("error" in loaded) {
    res.status(loaded.error.status).json({ error: loaded.error.message });
    return;
  }
  const current = loaded.task;

  const patch: Partial<typeof agendaTasksTable.$inferInsert> = {};
  if (parsed.data.texto !== undefined) {
    const texto = parsed.data.texto.trim();
    if (!texto) {
      res.status(400).json({ error: "El texto no puede estar vacío" });
      return;
    }
    patch.texto = texto;
  }
  if (parsed.data.estado !== undefined) {
    const estado = normEstado(parsed.data.estado);
    if (estado !== current.estado) {
      patch.estado = estado;
      // Stamp completedAt only on a real transition into/out of "hecho".
      if (estado === "hecho") patch.completedAt = new Date();
      else if (current.estado === "hecho") patch.completedAt = null;
    }
  }
  if (parsed.data.prioridad !== undefined) patch.prioridad = normPrioridad(parsed.data.prioridad);
  if (parsed.data.fechaLimite !== undefined) patch.fechaLimite = parsed.data.fechaLimite ?? null;

  // Track the effective destination project so assignees can be enforced as shared-only.
  let destProject: AgendaProjectRow | null = loaded.project;
  if (parsed.data.projectId !== undefined) {
    const newProjectId = parsed.data.projectId ?? null;
    if (newProjectId !== current.projectId) {
      if (newProjectId !== null) {
        const [project] = await db
          .select()
          .from(agendaProjectsTable)
          .where(eq(agendaProjectsTable.id, newProjectId));
        if (!project) {
          res.status(404).json({ error: "Proyecto destino no encontrado" });
          return;
        }
        if (!canManageProjectTasks(project, userId)) {
          res.status(403).json({ error: "No podés mover la tarea a ese proyecto" });
          return;
        }
        destProject = project;
      } else {
        destProject = null;
      }
      patch.projectId = newProjectId;
    }
  }

  // Assignees only persist on shared projects; otherwise force [].
  const destAllowsAsignados = destProject?.compartido ?? false;
  if (parsed.data.asignados !== undefined) {
    patch.asignados = destAllowsAsignados ? normAsignados(parsed.data.asignados) : [];
  } else if (patch.projectId !== undefined && !destAllowsAsignados) {
    // Moving a task off a shared project clears any stale assignees.
    patch.asignados = [];
  }

  if (Object.keys(patch).length === 0) {
    res.json(taskDTO(current));
    return;
  }
  const [row] = await db
    .update(agendaTasksTable)
    .set(patch)
    .where(eq(agendaTasksTable.id, id))
    .returning();
  res.json(taskDTO(row));
});

router.delete("/agenda/tasks/:id", requireAuth, async (req, res): Promise<void> => {
  const userId = req.auth!.user.id;
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id <= 0) {
    res.status(400).json({ error: "id inválido" });
    return;
  }
  const loaded = await loadTaskForWrite(id, userId);
  if ("error" in loaded) {
    res.status(loaded.error.status).json({ error: loaded.error.message });
    return;
  }
  await db.delete(agendaTasksTable).where(eq(agendaTasksTable.id, id));
  res.json({ status: "ok" });
});

export default router;

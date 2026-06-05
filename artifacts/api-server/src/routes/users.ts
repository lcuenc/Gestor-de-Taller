import { Router, type IRouter } from "express";
import { eq } from "drizzle-orm";
import { db, usersTable, rolesTable } from "@workspace/db";
import {
  ListUsersResponse,
  CreateUserBody,
  UpdateUserBody,
  UpdateUserParams,
  DeleteUserParams,
} from "@workspace/api-zod";
import { requireAuth, requirePermission, userDTO, hashPassword } from "../lib/auth";

const router: IRouter = Router();

router.get(
  "/users",
  requireAuth,
  requirePermission("admin", "view"),
  async (_req, res): Promise<void> => {
    const rows = await db
      .select({ user: usersTable, roleName: rolesTable.name })
      .from(usersTable)
      .leftJoin(rolesTable, eq(usersTable.roleId, rolesTable.id))
      .orderBy(usersTable.username);
    res.json(ListUsersResponse.parse(rows.map((r) => userDTO(r.user, r.roleName ?? ""))));
  },
);

router.post(
  "/users",
  requireAuth,
  requirePermission("admin", "create"),
  async (req, res): Promise<void> => {
    const parsed = CreateUserBody.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.message });
      return;
    }
    const { username, password, roleId, nombre, activo } = parsed.data;

    const role = (await db.select().from(rolesTable).where(eq(rolesTable.id, roleId)))[0];
    if (!role) {
      res.status(400).json({ error: "El rol indicado no existe" });
      return;
    }

    const existing = await db.select().from(usersTable).where(eq(usersTable.username, username));
    if (existing.length) {
      res.status(400).json({ error: "Ya existe un usuario con ese nombre" });
      return;
    }

    const passwordHash = await hashPassword(password);
    const inserted = await db
      .insert(usersTable)
      .values({
        username,
        passwordHash,
        nombre: nombre ?? "",
        roleId,
        activo: activo ?? true,
      })
      .returning();
    res.status(201).json(userDTO(inserted[0], role.name));
  },
);

router.put(
  "/users/:id",
  requireAuth,
  requirePermission("admin", "edit"),
  async (req, res): Promise<void> => {
    const params = UpdateUserParams.safeParse(req.params);
    if (!params.success) {
      res.status(400).json({ error: params.error.message });
      return;
    }
    const parsed = UpdateUserBody.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.message });
      return;
    }

    const existing = (await db.select().from(usersTable).where(eq(usersTable.id, params.data.id)))[0];
    if (!existing) {
      res.status(404).json({ error: "Usuario no encontrado" });
      return;
    }

    const { nombre, password, roleId, activo } = parsed.data;
    const update: Partial<typeof usersTable.$inferInsert> = {};
    if (nombre !== undefined) update.nombre = nombre;
    if (activo !== undefined) update.activo = activo;
    if (password !== undefined) update.passwordHash = await hashPassword(password);
    if (roleId !== undefined) {
      const role = (await db.select().from(rolesTable).where(eq(rolesTable.id, roleId)))[0];
      if (!role) {
        res.status(400).json({ error: "El rol indicado no existe" });
        return;
      }
      update.roleId = roleId;
    }

    const updated = (
      await db.update(usersTable).set(update).where(eq(usersTable.id, params.data.id)).returning()
    )[0];
    const role = (await db.select().from(rolesTable).where(eq(rolesTable.id, updated.roleId)))[0];
    res.json(userDTO(updated, role?.name ?? ""));
  },
);

router.delete(
  "/users/:id",
  requireAuth,
  requirePermission("admin", "delete"),
  async (req, res): Promise<void> => {
    const params = DeleteUserParams.safeParse(req.params);
    if (!params.success) {
      res.status(400).json({ error: params.error.message });
      return;
    }
    if (req.auth && req.auth.user.id === params.data.id) {
      res.status(400).json({ error: "No podés eliminar tu propio usuario" });
      return;
    }
    const deleted = await db
      .delete(usersTable)
      .where(eq(usersTable.id, params.data.id))
      .returning();
    if (!deleted.length) {
      res.status(404).json({ error: "Usuario no encontrado" });
      return;
    }
    res.sendStatus(204);
  },
);

export default router;

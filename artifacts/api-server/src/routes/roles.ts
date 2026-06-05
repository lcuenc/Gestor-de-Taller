import { Router, type IRouter } from "express";
import { eq } from "drizzle-orm";
import { db, rolesTable, usersTable } from "@workspace/db";
import {
  ListRolesResponse,
  CreateRoleBody,
  UpdateRoleBody,
  UpdateRoleParams,
  DeleteRoleParams,
} from "@workspace/api-zod";
import { requireAuth, requirePermission, roleDTO } from "../lib/auth";

const router: IRouter = Router();

router.get(
  "/roles",
  requireAuth,
  requirePermission("admin", "view"),
  async (_req, res): Promise<void> => {
    const rows = await db.select().from(rolesTable).orderBy(rolesTable.id);
    res.json(ListRolesResponse.parse(rows.map(roleDTO)));
  },
);

router.post(
  "/roles",
  requireAuth,
  requirePermission("admin", "create"),
  async (req, res): Promise<void> => {
    const parsed = CreateRoleBody.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.message });
      return;
    }
    const existing = await db.select().from(rolesTable).where(eq(rolesTable.name, parsed.data.name));
    if (existing.length) {
      res.status(400).json({ error: "Ya existe un rol con ese nombre" });
      return;
    }
    const inserted = await db
      .insert(rolesTable)
      .values({
        name: parsed.data.name,
        permissions: parsed.data.permissions,
        isSystem: false,
      })
      .returning();
    res.status(201).json(roleDTO(inserted[0]));
  },
);

router.put(
  "/roles/:id",
  requireAuth,
  requirePermission("admin", "edit"),
  async (req, res): Promise<void> => {
    const params = UpdateRoleParams.safeParse(req.params);
    if (!params.success) {
      res.status(400).json({ error: params.error.message });
      return;
    }
    const parsed = UpdateRoleBody.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.message });
      return;
    }
    const existing = (await db.select().from(rolesTable).where(eq(rolesTable.id, params.data.id)))[0];
    if (!existing) {
      res.status(404).json({ error: "Rol no encontrado" });
      return;
    }
    if (existing.isSystem) {
      res.status(400).json({ error: "El rol de administrador no se puede modificar" });
      return;
    }
    const update: Partial<typeof rolesTable.$inferInsert> = {};
    if (parsed.data.name !== undefined) update.name = parsed.data.name;
    if (parsed.data.permissions !== undefined) update.permissions = parsed.data.permissions;
    const updated = (
      await db.update(rolesTable).set(update).where(eq(rolesTable.id, params.data.id)).returning()
    )[0];
    res.json(roleDTO(updated));
  },
);

router.delete(
  "/roles/:id",
  requireAuth,
  requirePermission("admin", "delete"),
  async (req, res): Promise<void> => {
    const params = DeleteRoleParams.safeParse(req.params);
    if (!params.success) {
      res.status(400).json({ error: params.error.message });
      return;
    }
    const existing = (await db.select().from(rolesTable).where(eq(rolesTable.id, params.data.id)))[0];
    if (!existing) {
      res.status(404).json({ error: "Rol no encontrado" });
      return;
    }
    if (existing.isSystem) {
      res.status(400).json({ error: "El rol de administrador no se puede eliminar" });
      return;
    }
    const assigned = await db.select().from(usersTable).where(eq(usersTable.roleId, params.data.id));
    if (assigned.length) {
      res.status(400).json({ error: "No se puede eliminar: hay usuarios con este rol" });
      return;
    }
    await db.delete(rolesTable).where(eq(rolesTable.id, params.data.id));
    res.sendStatus(204);
  },
);

export default router;

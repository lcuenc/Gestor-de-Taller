import type { Request, Response, NextFunction } from "express";
import bcrypt from "bcryptjs";
import { eq } from "drizzle-orm";
import {
  db,
  usersTable,
  rolesTable,
  type RolePermissions,
  type ModulePermission,
  type RoleRow,
  type UserRow,
} from "@workspace/db";
import { logger } from "./logger";

declare module "express-session" {
  interface SessionData {
    userId?: number;
  }
}

export interface AuthContext {
  user: UserRow;
  role: RoleRow;
}

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      auth?: AuthContext;
    }
  }
}

export const MODULES = [
  "dashboard",
  "taller",
  "venta",
  "kpis",
  "layout",
  "tecnicos",
  "admin",
] as const;
export type ModuleId = (typeof MODULES)[number];
export type PermissionAction = keyof ModulePermission;

const ALL: ModulePermission = { view: true, create: true, edit: true, delete: true };
const VIEW: ModulePermission = { view: true, create: false, edit: false, delete: false };
const NONE: ModulePermission = { view: false, create: false, edit: false, delete: false };

function buildPerms(fn: (m: ModuleId) => ModulePermission): RolePermissions {
  const p: RolePermissions = {};
  for (const m of MODULES) p[m] = { ...fn(m) };
  return p;
}

const adminPerms = buildPerms(() => ALL);
const supervisorPerms = buildPerms((m) => (m === "admin" ? NONE : ALL));
const operarioPerms = buildPerms((m) => {
  switch (m) {
    case "dashboard":
      return VIEW;
    case "taller":
      return { view: true, create: true, edit: true, delete: false };
    case "layout":
      return { view: true, create: false, edit: true, delete: false };
    case "venta":
      return VIEW;
    case "kpis":
      return VIEW;
    default:
      return NONE;
  }
});

const DEFAULT_ROLES = [
  { name: "Administrador", permissions: adminPerms, isSystem: true },
  { name: "Supervisor", permissions: supervisorPerms, isSystem: false },
  { name: "Operario", permissions: operarioPerms, isSystem: false },
] as const;

const ADMIN_ROLE_NAME = "Administrador";
// Seed credentials are env-overridable so the default can be rotated without a
// code change (set SEED_ADMIN_USERNAME / SEED_ADMIN_PASSWORD). The fallback only
// matters for the very first seed of an empty database.
const SEED_ADMIN_USERNAME = process.env.SEED_ADMIN_USERNAME?.trim() || "lcuenca";
const SEED_ADMIN_PASSWORD = process.env.SEED_ADMIN_PASSWORD || "Movimiento2026*";

export async function hashPassword(plain: string): Promise<string> {
  return bcrypt.hash(plain, 10);
}

export function userDTO(u: UserRow, roleName: string) {
  return {
    id: u.id,
    username: u.username,
    nombre: u.nombre,
    roleId: u.roleId,
    roleName,
    activo: u.activo,
  };
}

export function roleDTO(r: RoleRow) {
  return {
    id: r.id,
    name: r.name,
    isSystem: r.isSystem,
    permissions: r.permissions,
  };
}

export function sessionDTO(ctx: AuthContext) {
  return { user: userDTO(ctx.user, ctx.role.name), role: roleDTO(ctx.role) };
}

export async function getSessionContext(req: Request): Promise<AuthContext | null> {
  const userId = req.session?.userId;
  if (!userId) return null;
  const users = await db.select().from(usersTable).where(eq(usersTable.id, userId));
  const user = users[0];
  if (!user || !user.activo) return null;
  const roles = await db.select().from(rolesTable).where(eq(rolesTable.id, user.roleId));
  const role = roles[0];
  if (!role) return null;
  return { user, role };
}

export function requireAuth(req: Request, res: Response, next: NextFunction): void {
  getSessionContext(req)
    .then((ctx) => {
      if (!ctx) {
        res.status(401).json({ error: "No autenticado" });
        return;
      }
      req.auth = ctx;
      next();
    })
    .catch(next);
}

export function requirePermission(moduleId: ModuleId, action: PermissionAction) {
  return (req: Request, res: Response, next: NextFunction): void => {
    const ctx = req.auth;
    if (!ctx) {
      res.status(401).json({ error: "No autenticado" });
      return;
    }
    const perm = ctx.role.permissions?.[moduleId];
    if (!perm || !perm[action]) {
      res.status(403).json({ error: "No tenés permiso para esta acción" });
      return;
    }
    next();
  };
}

export async function verifyCredentials(
  username: string,
  password: string,
): Promise<AuthContext | null> {
  const users = await db.select().from(usersTable).where(eq(usersTable.username, username));
  const user = users[0];
  if (!user || !user.activo) return null;
  const ok = await bcrypt.compare(password, user.passwordHash);
  if (!ok) return null;
  const roles = await db.select().from(rolesTable).where(eq(rolesTable.id, user.roleId));
  const role = roles[0];
  if (!role) return null;
  return { user, role };
}

export async function seedAuth(): Promise<void> {
  for (const r of DEFAULT_ROLES) {
    const existing = await db.select().from(rolesTable).where(eq(rolesTable.name, r.name));
    if (!existing.length) {
      await db.insert(rolesTable).values({
        name: r.name,
        permissions: r.permissions,
        isSystem: r.isSystem,
      });
    } else if (r.isSystem) {
      await db
        .update(rolesTable)
        .set({ permissions: r.permissions, isSystem: true })
        .where(eq(rolesTable.id, existing[0].id));
    }
  }

  const adminRoles = await db
    .select()
    .from(rolesTable)
    .where(eq(rolesTable.name, ADMIN_ROLE_NAME));
  const adminRole = adminRoles[0];
  if (!adminRole) return;

  const existingAdmin = await db
    .select()
    .from(usersTable)
    .where(eq(usersTable.username, SEED_ADMIN_USERNAME));
  if (!existingAdmin.length) {
    const passwordHash = await hashPassword(SEED_ADMIN_PASSWORD);
    await db.insert(usersTable).values({
      username: SEED_ADMIN_USERNAME,
      passwordHash,
      nombre: "L. Cuenca",
      roleId: adminRole.id,
      activo: true,
    });
    logger.info({ username: SEED_ADMIN_USERNAME }, "Seeded admin user");
  }
}

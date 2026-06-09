import { pgTable, serial, text, integer, boolean, jsonb, timestamp } from "drizzle-orm/pg-core";
import { usersTable } from "./auth";

export const agendaProjectsTable = pgTable("agenda_projects", {
  id: serial("id").primaryKey(),
  nombre: text("nombre").notNull(),
  // false = personal (owner only), true = shared with every authenticated user
  compartido: boolean("compartido").notNull().default(false),
  ownerId: integer("owner_id").notNull().references(() => usersTable.id, { onDelete: "cascade" }),
  color: text("color").notNull().default("blue"),
  orden: integer("orden").notNull().default(0),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
});

export const agendaTasksTable = pgTable("agenda_tasks", {
  id: serial("id").primaryKey(),
  // null = general task (no project)
  projectId: integer("project_id").references(() => agendaProjectsTable.id, { onDelete: "cascade" }),
  ownerId: integer("owner_id").notNull().references(() => usersTable.id, { onDelete: "cascade" }),
  texto: text("texto").notNull(),
  estado: text("estado").notNull().default("pendiente"),
  prioridad: text("prioridad").notNull().default("media"),
  fechaLimite: text("fecha_limite"),
  asignados: jsonb("asignados").notNull().default([]).$type<number[]>(),
  orden: integer("orden").notNull().default(0),
  completedAt: timestamp("completed_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
});

export type AgendaProjectRow = typeof agendaProjectsTable.$inferSelect;
export type AgendaTaskRow = typeof agendaTasksTable.$inferSelect;

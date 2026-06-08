import { pgTable, serial, jsonb, timestamp, integer, bigint, text } from "drizzle-orm/pg-core";

export const tallerStateTable = pgTable("taller_state", {
  id: serial("id").primaryKey(),
  equipos: jsonb("equipos").notNull().default([]),
  gpvList: jsonb("gpv_list").notNull().default([]),
  tecnicos: jsonb("tecnicos").notNull().default([]),
  layout: jsonb("layout").notNull().default({}),
  licencias: jsonb("licencias").notNull().default({ saldos: {}, registros: [] }),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
});

export const equipoHistoryTable = pgTable("equipo_history", {
  id: serial("id").primaryKey(),
  equipoId: bigint("equipo_id", { mode: "number" }).notNull(),
  campo: text("campo").notNull(),
  valorAnterior: text("valor_anterior"),
  valorNuevo: text("valor_nuevo"),
  usuario: text("usuario").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export type TallerStateRow = typeof tallerStateTable.$inferSelect;
export type EquipoHistoryRow = typeof equipoHistoryTable.$inferSelect;
export type InsertEquipoHistory = typeof equipoHistoryTable.$inferInsert;

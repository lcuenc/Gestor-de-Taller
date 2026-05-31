import { pgTable, serial, jsonb, timestamp } from "drizzle-orm/pg-core";

export const tallerStateTable = pgTable("taller_state", {
  id: serial("id").primaryKey(),
  equipos: jsonb("equipos").notNull().default([]),
  gpvList: jsonb("gpv_list").notNull().default([]),
  tecnicos: jsonb("tecnicos").notNull().default([]),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
});

export type TallerStateRow = typeof tallerStateTable.$inferSelect;

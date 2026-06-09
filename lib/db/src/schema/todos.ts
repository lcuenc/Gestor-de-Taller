import { pgTable, serial, text, integer, boolean, timestamp } from "drizzle-orm/pg-core";
import { usersTable } from "./auth";

export const userTodosTable = pgTable("user_todos", {
  id: serial("id").primaryKey(),
  userId: integer("user_id").notNull().references(() => usersTable.id, { onDelete: "cascade" }),
  texto: text("texto").notNull(),
  hecho: boolean("hecho").notNull().default(false),
  prioridad: text("prioridad").notNull().default("media"),
  orden: integer("orden").notNull().default(0),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  completedAt: timestamp("completed_at", { withTimezone: true }),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
});

export type UserTodoRow = typeof userTodosTable.$inferSelect;
export type InsertUserTodo = typeof userTodosTable.$inferInsert;

import { pgTable, varchar, json, timestamp, index } from "drizzle-orm/pg-core";

// Session store table for connect-pg-simple. The runtime store does not create
// this table itself (its bundled table.sql is not present in the esbuild output),
// so it is defined here and provisioned via drizzle push.
export const sessionTable = pgTable(
  "session",
  {
    sid: varchar("sid").primaryKey(),
    sess: json("sess").notNull(),
    expire: timestamp("expire", { precision: 6 }).notNull(),
  },
  (table) => [index("IDX_session_expire").on(table.expire)],
);

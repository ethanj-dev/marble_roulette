import { integer, sqliteTable, text } from "drizzle-orm/sqlite-core";

export const savedMaps = sqliteTable("saved_maps", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  seed: integer("seed").notNull(),
  complexity: integer("complexity").notNull(),
  structure: text("structure").notNull(),
  mapJson: text("map_json").notNull(),
  createdAt: integer("created_at").notNull(),
});

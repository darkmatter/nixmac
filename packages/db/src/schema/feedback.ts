import { pgEnum, pgTable, text, json, timestamp } from "drizzle-orm/pg-core";

export const feedbackType = pgEnum("feedback_type", ["bug", "suggestion", "general"]);

export const feedback = pgTable("feedback", {
  id: text("id").primaryKey(),
  type: feedbackType("type").notNull(),
  email: text("email"),
  payload: json("payload").$type<any>().notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

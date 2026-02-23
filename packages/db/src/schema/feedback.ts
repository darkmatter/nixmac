import { pgEnum, pgTable, text, json, timestamp } from "drizzle-orm/pg-core";

// Example query to get all bugs to JSON:
/*
psql "$DATABASE_URL" -t -A \
  -c "SELECT jsonb_pretty(payload) 
      FROM public.feedback 
      WHERE type = 'bug';" \
  > bugs.json
*/

export const feedbackType = pgEnum("feedback_type", [
  "bug",
  "suggestion",
  "general",
  "issue",
  "error",
]);

export const feedback = pgTable("feedback", {
  id: text("id").primaryKey(),
  type: feedbackType("type").notNull(),
  email: text("email"),
  payload: json("payload").$type<any>().notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

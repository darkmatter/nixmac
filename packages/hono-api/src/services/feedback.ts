import { db } from "@nixmac/db";
import { feedback as feedbackTable } from "@nixmac/db/schema/feedback";

export type FeedbackRecord = {
  id: string;
  type: "bug" | "suggestion" | "general";
  email?: string | null;
  payload: any;
};

export async function insertFeedback(record: FeedbackRecord) {
  const [row] = await db
    .insert(feedbackTable)
    .values({
      id: record.id,
      type: record.type,
      email: record.email ?? null,
      payload: record.payload,
    })
    .returning();
  return row;
}

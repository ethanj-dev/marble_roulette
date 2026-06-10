import { eq } from "drizzle-orm";
import { getDb } from "@/db";
import { savedMaps } from "@/db/schema";

type RouteContext = {
  params: Promise<{
    id: string;
  }>;
};

export async function DELETE(_request: Request, context: RouteContext) {
  try {
    const { id } = await context.params;

    if (!id) {
      return Response.json({ error: "id is required" }, { status: 400 });
    }

    const db = getDb();
    await db.delete(savedMaps).where(eq(savedMaps.id, id));

    return Response.json({ ok: true });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unexpected error";
    return Response.json({ error: message }, { status: 500 });
  }
}

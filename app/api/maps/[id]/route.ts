import { eq } from "drizzle-orm";
import { getDb } from "@/db";
import { savedMaps } from "@/db/schema";

type RouteContext = {
  params: Promise<{
    id: string;
  }>;
};

type SaveMapPayload = {
  name?: string;
  seed?: number;
  complexity?: number;
  structure?: string;
  map?: unknown;
};

function serializeRow(row: typeof savedMaps.$inferSelect) {
  return {
    id: row.id,
    name: row.name,
    seed: row.seed,
    complexity: row.complexity,
    structure: row.structure,
    map: JSON.parse(row.mapJson),
    createdAt: row.createdAt,
    storage: "d1" as const,
  };
}

export async function PUT(request: Request, context: RouteContext) {
  try {
    const { id } = await context.params;

    if (!id) {
      return Response.json({ error: "id is required" }, { status: 400 });
    }

    const payload = (await request.json()) as SaveMapPayload;
    const name = payload.name?.trim() || "저장된 맵";
    const seed = Number.isFinite(payload.seed) ? Number(payload.seed) : 0;
    const complexity = Number.isFinite(payload.complexity)
      ? Number(payload.complexity)
      : 1;
    const structure = payload.structure?.trim() || "random";

    if (!payload.map || typeof payload.map !== "object") {
      return Response.json({ error: "map is required" }, { status: 400 });
    }

    const db = getDb();
    const [updated] = await db
      .update(savedMaps)
      .set({
        name: name.slice(0, 80),
        seed,
        complexity: Math.min(5, Math.max(1, Math.round(complexity))),
        structure: structure.slice(0, 40),
        mapJson: JSON.stringify(payload.map),
        createdAt: Date.now(),
      })
      .where(eq(savedMaps.id, id))
      .returning();

    if (!updated) {
      return Response.json({ error: "map not found" }, { status: 404 });
    }

    return Response.json({ map: serializeRow(updated) });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unexpected error";
    return Response.json({ error: message }, { status: 500 });
  }
}

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

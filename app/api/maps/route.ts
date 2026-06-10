import { desc } from "drizzle-orm";
import { getDb } from "@/db";
import { savedMaps } from "@/db/schema";

type SaveMapPayload = {
  name?: string;
  seed?: number;
  complexity?: number;
  structure?: string;
  map?: unknown;
};

function toRouteErrorMessage(error: unknown) {
  const message = error instanceof Error ? error.message : "Unexpected error";
  const detail =
    error instanceof Error && error.cause instanceof Error
      ? error.cause.message
      : "";
  const combined = `${message}\n${detail}`;

  if (
    combined.includes("no such table") ||
    combined.includes("saved_maps")
  ) {
    return "The saved_maps table is unavailable. Generate and apply the D1 migration before saving maps.";
  }

  return message;
}

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

export async function GET() {
  try {
    const db = getDb();
    const rows = await db
      .select()
      .from(savedMaps)
      .orderBy(desc(savedMaps.createdAt))
      .limit(40);

    return Response.json({ maps: rows.map(serializeRow) });
  } catch (error) {
    return Response.json(
      { error: toRouteErrorMessage(error), maps: [] },
      { status: 500 }
    );
  }
}

export async function POST(request: Request) {
  try {
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

    const row = {
      id: crypto.randomUUID(),
      name: name.slice(0, 80),
      seed,
      complexity: Math.min(5, Math.max(1, Math.round(complexity))),
      structure: structure.slice(0, 40),
      mapJson: JSON.stringify(payload.map),
      createdAt: Date.now(),
    };

    const db = getDb();
    const [saved] = await db.insert(savedMaps).values(row).returning();

    return Response.json({ map: serializeRow(saved) }, { status: 201 });
  } catch (error) {
    return Response.json(
      { error: toRouteErrorMessage(error) },
      { status: 500 }
    );
  }
}

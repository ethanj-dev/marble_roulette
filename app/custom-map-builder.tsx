"use client";

import {
  type PointerEvent as ReactPointerEvent,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import Link from "./app-link";
import { isStaticSpa } from "./static-spa";

const BOARD_WIDTH = 430;
const BOARD_HEIGHT = 1420;
const STORAGE_KEY = "pinball-roulette-saved-maps-v3";

type Point = {
  x: number;
  y: number;
};

type PathNode = Point & {
  width: number;
};

type Segment = {
  id: string;
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  bounce: number;
};

type CircleObstacle = {
  id: string;
  x: number;
  y: number;
  radius: number;
  strength: number;
};

type Booster = {
  id: string;
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  strength: number;
};

type CustomMapLayout = {
  version: 1;
  seed: number;
  complexity: number;
  structure: "custom";
  height?: number;
  path?: PathNode[];
  walls: Segment[];
  pins: CircleObstacle[];
  bumpers: CircleObstacle[];
  exploders: CircleObstacle[];
  boosters: Booster[];
};

type SavedMapRecord = {
  id: string;
  name: string;
  seed: number;
  complexity: number;
  structure: "custom";
  map: CustomMapLayout;
  createdAt: number;
  storage: "local";
};

type Tool = "wall" | "pin" | "bumper" | "exploder" | "booster" | "erase";

type DragPreview = {
  tool: Extract<Tool, "wall" | "booster">;
  start: Point;
  end: Point;
};

const TOOL_LABELS: Record<Tool, string> = {
  wall: "벽",
  pin: "핀",
  bumper: "범퍼",
  exploder: "폭발",
  booster: "회전 막대",
  erase: "삭제",
};

const DEFAULT_GUIDE_PATH: PathNode[] = [
  { x: 214, y: 88, width: 142 },
  { x: 268, y: 246, width: 138 },
  { x: 176, y: 430, width: 132 },
  { x: 226, y: 600, width: 136 },
  { x: 156, y: 804, width: 130 },
  { x: 260, y: 978, width: 140 },
  { x: 206, y: 1182, width: 148 },
  { x: 216, y: 1328, width: 150 },
];

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

function randomSeed() {
  return Math.floor(Math.random() * 2147483647);
}

function randomId(prefix: string) {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return `${prefix}-${crypto.randomUUID()}`;
  }

  return `${prefix}-${Date.now()}-${Math.round(Math.random() * 100000)}`;
}

function createEmptyCustomMap(): CustomMapLayout {
  return {
    version: 1,
    seed: randomSeed(),
    complexity: 1,
    structure: "custom",
    height: BOARD_HEIGHT,
    walls: [],
    pins: [],
    bumpers: [],
    exploders: [],
    boosters: [],
  };
}

function createGuideWalls(): Segment[] {
  const walls: Segment[] = [];

  for (let index = 0; index < DEFAULT_GUIDE_PATH.length - 1; index += 1) {
    const current = DEFAULT_GUIDE_PATH[index];
    const next = DEFAULT_GUIDE_PATH[index + 1];

    walls.push({
      id: randomId("wall"),
      x1: current.x - current.width / 2,
      y1: current.y,
      x2: next.x - next.width / 2,
      y2: next.y,
      bounce: 0.86,
    });
    walls.push({
      id: randomId("wall"),
      x1: current.x + current.width / 2,
      y1: current.y,
      x2: next.x + next.width / 2,
      y2: next.y,
      bounce: 0.86,
    });
  }

  return walls;
}

function distanceToSegment(point: Point, segment: Pick<Segment, "x1" | "y1" | "x2" | "y2">) {
  const dx = segment.x2 - segment.x1;
  const dy = segment.y2 - segment.y1;
  const lengthSquared = dx * dx + dy * dy;

  if (lengthSquared <= 0.0001) {
    return Math.hypot(point.x - segment.x1, point.y - segment.y1);
  }

  const t = clamp(
    ((point.x - segment.x1) * dx + (point.y - segment.y1) * dy) / lengthSquared,
    0,
    1
  );
  const px = segment.x1 + dx * t;
  const py = segment.y1 + dy * t;

  return Math.hypot(point.x - px, point.y - py);
}

function getWallIntersectionsAtY(walls: Segment[], y: number) {
  return walls
    .flatMap((wall) => {
      const minY = Math.min(wall.y1, wall.y2);
      const maxY = Math.max(wall.y1, wall.y2);
      const spanY = wall.y2 - wall.y1;

      if (Math.abs(spanY) < 0.001 || y < minY || y > maxY) {
        return [];
      }

      const t = (y - wall.y1) / spanY;
      return [wall.x1 + (wall.x2 - wall.x1) * t];
    })
    .sort((a, b) => a - b);
}

function isPointInsideCustomPath(map: CustomMapLayout, point: Point, margin: number) {
  const intersections = getWallIntersectionsAtY(map.walls, point.y);

  if (intersections.length < 2) {
    return false;
  }

  const left = intersections[0];
  const right = intersections[intersections.length - 1];

  return point.x >= left + margin && point.x <= right - margin;
}

function isSegmentInsideCustomPath(
  map: CustomMapLayout,
  segment: Pick<Segment, "x1" | "y1" | "x2" | "y2">,
  margin: number
) {
  for (let index = 0; index <= 4; index += 1) {
    const t = index / 4;
    const point = {
      x: segment.x1 + (segment.x2 - segment.x1) * t,
      y: segment.y1 + (segment.y2 - segment.y1) * t,
    };

    if (!isPointInsideCustomPath(map, point, margin)) {
      return false;
    }
  }

  return true;
}

function isSegmentMostlyInsideCustomPath(
  map: CustomMapLayout,
  segment: Pick<Segment, "x1" | "y1" | "x2" | "y2">,
  margin: number
) {
  let insideCount = 0;

  for (let index = 0; index <= 5; index += 1) {
    const t = index / 5;
    const point = {
      x: segment.x1 + (segment.x2 - segment.x1) * t,
      y: segment.y1 + (segment.y2 - segment.y1) * t,
    };

    if (isPointInsideCustomPath(map, point, margin)) {
      insideCount += 1;
    }
  }

  return insideCount >= 5;
}

function removeNearest(map: CustomMapLayout, point: Point): CustomMapLayout {
  let best:
    | { kind: "walls" | "pins" | "bumpers" | "exploders" | "boosters"; index: number; distance: number }
    | null = null;

  const consider = (
    kind: NonNullable<typeof best>["kind"],
    index: number,
    distance: number
  ) => {
    if (distance > 34) {
      return;
    }

    if (!best || distance < best.distance) {
      best = { kind, index, distance };
    }
  };

  map.walls.forEach((wall, index) => consider("walls", index, distanceToSegment(point, wall)));
  map.boosters.forEach((booster, index) =>
    consider("boosters", index, distanceToSegment(point, booster))
  );
  map.pins.forEach((pin, index) =>
    consider("pins", index, Math.hypot(point.x - pin.x, point.y - pin.y) - pin.radius)
  );
  map.bumpers.forEach((bumper, index) =>
    consider("bumpers", index, Math.hypot(point.x - bumper.x, point.y - bumper.y) - bumper.radius)
  );
  map.exploders.forEach((exploder, index) =>
    consider(
      "exploders",
      index,
      Math.hypot(point.x - exploder.x, point.y - exploder.y) - exploder.radius
    )
  );

  if (!best) {
    return map;
  }

  return {
    ...map,
    [best.kind]: map[best.kind].filter((_, index) => index !== best.index),
  };
}

function drawGlowLine(
  ctx: CanvasRenderingContext2D,
  segment: Pick<Segment, "x1" | "y1" | "x2" | "y2">,
  color: string,
  width: number
) {
  ctx.save();
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  ctx.shadowColor = color;
  ctx.shadowBlur = 12;
  ctx.strokeStyle = color;
  ctx.lineWidth = width;
  ctx.beginPath();
  ctx.moveTo(segment.x1, segment.y1);
  ctx.lineTo(segment.x2, segment.y2);
  ctx.stroke();
  ctx.restore();
}

function drawCustomBoard(
  ctx: CanvasRenderingContext2D,
  map: CustomMapLayout,
  preview: DragPreview | null
) {
  ctx.clearRect(0, 0, BOARD_WIDTH, BOARD_HEIGHT);
  ctx.fillStyle = "#252727";
  ctx.fillRect(0, 0, BOARD_WIDTH, BOARD_HEIGHT);

  ctx.save();
  ctx.globalAlpha = 0.16;
  ctx.strokeStyle = "#0b191b";
  ctx.lineWidth = 1;
  for (let x = 80; x < BOARD_WIDTH; x += 80) {
    ctx.beginPath();
    ctx.moveTo(x, 24);
    ctx.lineTo(x, BOARD_HEIGHT - 24);
    ctx.stroke();
  }
  for (let y = 88; y < BOARD_HEIGHT; y += 88) {
    ctx.beginPath();
    ctx.moveTo(34, y);
    ctx.lineTo(BOARD_WIDTH - 34, y);
    ctx.stroke();
  }
  ctx.restore();

  ctx.strokeStyle = "#ffe147";
  ctx.lineWidth = 4;
  ctx.strokeRect(8, 8, BOARD_WIDTH - 16, BOARD_HEIGHT - 16);

  ctx.save();
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  for (const wall of map.walls) {
    ctx.strokeStyle = "#1b1d1d";
    ctx.lineWidth = 16;
    ctx.beginPath();
    ctx.moveTo(wall.x1, wall.y1);
    ctx.lineTo(wall.x2, wall.y2);
    ctx.stroke();
    ctx.strokeStyle = "#8f9794";
    ctx.globalAlpha = 0.58;
    ctx.lineWidth = 3;
    ctx.stroke();
    ctx.globalAlpha = 1;
  }
  ctx.restore();

  for (const booster of map.boosters) {
    drawGlowLine(ctx, booster, "#32f7ff", 8);
    ctx.fillStyle = "#031719";
    ctx.beginPath();
    ctx.arc((booster.x1 + booster.x2) / 2, (booster.y1 + booster.y2) / 2, 8, 0, Math.PI * 2);
    ctx.fill();
  }

  for (const pin of map.pins) {
    ctx.save();
    ctx.shadowColor = "#35f4ff";
    ctx.shadowBlur = 8;
    ctx.fillStyle = "#35f4ff";
    ctx.beginPath();
    ctx.arc(pin.x, pin.y, pin.radius, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }

  for (const bumper of map.bumpers) {
    ctx.save();
    ctx.shadowColor = "#56ff86";
    ctx.shadowBlur = 18;
    ctx.fillStyle = "#13351f";
    ctx.beginPath();
    ctx.arc(bumper.x, bumper.y, bumper.radius, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = "#56ff86";
    ctx.lineWidth = 3;
    ctx.stroke();
    ctx.fillStyle = "#ddffe4";
    ctx.beginPath();
    ctx.moveTo(bumper.x, bumper.y - 8);
    ctx.lineTo(bumper.x - 8, bumper.y + 6);
    ctx.lineTo(bumper.x + 8, bumper.y + 6);
    ctx.closePath();
    ctx.fill();
    ctx.restore();
  }

  for (const exploder of map.exploders) {
    ctx.save();
    ctx.shadowColor = "#ff5064";
    ctx.shadowBlur = 18;
    ctx.fillStyle = "#371014";
    ctx.beginPath();
    ctx.arc(exploder.x, exploder.y, exploder.radius, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = "#ff5064";
    ctx.lineWidth = 3;
    ctx.stroke();
    ctx.strokeStyle = "#ffe147";
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(exploder.x - 8, exploder.y);
    ctx.lineTo(exploder.x + 8, exploder.y);
    ctx.moveTo(exploder.x, exploder.y - 8);
    ctx.lineTo(exploder.x, exploder.y + 8);
    ctx.stroke();
    ctx.restore();
  }

  if (preview) {
    drawGlowLine(
      ctx,
      { x1: preview.start.x, y1: preview.start.y, x2: preview.end.x, y2: preview.end.y },
      preview.tool === "booster" ? "#32f7ff" : "#fff2a1",
      preview.tool === "booster" ? 8 : 5
    );
  }
}

function readLocalMaps(): SavedMapRecord[] {
  if (typeof window === "undefined") {
    return [];
  }

  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    return raw ? (JSON.parse(raw) as SavedMapRecord[]) : [];
  } catch {
    return [];
  }
}

function writeLocalMaps(records: SavedMapRecord[]) {
  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(records.slice(0, 40)));
}

export default function CustomMapBuilder() {
  const [map, setMap] = useState<CustomMapLayout>(() => createEmptyCustomMap());
  const [tool, setTool] = useState<Tool>("wall");
  const [mapName, setMapName] = useState("커스텀 핀볼 맵");
  const [dragPreview, setDragPreview] = useState<DragPreview | null>(null);
  const [saveStatus, setSaveStatus] = useState("저장 대기");
  const [isSaving, setIsSaving] = useState(false);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const dragStartRef = useRef<Point | null>(null);

  const counts = useMemo(
    () => ({
      walls: map.walls.length,
      pins: map.pins.length,
      bumpers: map.bumpers.length,
      exploders: map.exploders.length,
      boosters: map.boosters.length,
    }),
    [map]
  );

  useEffect(() => {
    const ctx = canvasRef.current?.getContext("2d");

    if (ctx) {
      drawCustomBoard(ctx, map, dragPreview);
    }
  }, [dragPreview, map]);

  const toBoardPoint = useCallback((event: ReactPointerEvent<HTMLCanvasElement>) => {
    const rect = event.currentTarget.getBoundingClientRect();

    return {
      x: clamp(((event.clientX - rect.left) / rect.width) * BOARD_WIDTH, 24, BOARD_WIDTH - 24),
      y: clamp(((event.clientY - rect.top) / rect.height) * BOARD_HEIGHT, 24, BOARD_HEIGHT - 24),
    };
  }, []);

  const addCircleObstacle = useCallback((point: Point) => {
    setMap((current) => {
      if (tool === "pin") {
        return {
          ...current,
          pins: [
            ...current.pins,
            { id: randomId("pin"), x: point.x, y: point.y, radius: 3.8, strength: 0 },
          ],
        };
      }

      if (tool === "bumper") {
        return {
          ...current,
          bumpers: [
            ...current.bumpers,
            { id: randomId("bumper"), x: point.x, y: point.y, radius: 20, strength: 9 },
          ],
        };
      }

      if (tool === "exploder") {
        return {
          ...current,
          exploders: [
            ...current.exploders,
            { id: randomId("blast"), x: point.x, y: point.y, radius: 18, strength: 11 },
          ],
        };
      }

      return current;
    });
  }, [tool]);

  const commitSegment = useCallback((start: Point, end: Point) => {
    if (Math.hypot(end.x - start.x, end.y - start.y) < 18) {
      return;
    }

    const segment = { x1: start.x, y1: start.y, x2: end.x, y2: end.y };

    if (tool === "wall" && isSegmentMostlyInsideCustomPath(map, segment, 14)) {
      setSaveStatus("길 안 단독 벽 금지");
      return;
    }

    if (
      tool === "booster" &&
      !isSegmentInsideCustomPath(map, segment, 18)
    ) {
      setSaveStatus("장애물은 길 안쪽에 배치");
      return;
    }

    setMap((current) => {
      if (tool === "wall") {
        return {
          ...current,
          walls: [
            ...current.walls,
            {
              id: randomId("wall"),
              x1: start.x,
              y1: start.y,
              x2: end.x,
              y2: end.y,
              bounce: 0.86,
            },
          ],
        };
      }

      if (tool === "booster") {
        return {
          ...current,
          boosters: [
            ...current.boosters,
            {
              id: randomId("boost"),
              x1: start.x,
              y1: start.y,
              x2: end.x,
              y2: end.y,
              strength: 9,
            },
          ],
        };
      }

      return current;
    });
  }, [map, tool]);

  const handlePointerDown = useCallback(
    (event: ReactPointerEvent<HTMLCanvasElement>) => {
      const point = toBoardPoint(event);

      if (tool === "erase") {
        setMap((current) => removeNearest(current, point));
        return;
      }

      if (tool === "pin" || tool === "bumper" || tool === "exploder") {
        const margin = tool === "pin" ? 12 : tool === "bumper" ? 34 : 32;

        if (!isPointInsideCustomPath(map, point, margin)) {
          setSaveStatus("장애물은 길 안쪽에 배치");
          return;
        }

        addCircleObstacle(point);
        return;
      }

      dragStartRef.current = point;
      setDragPreview({ tool, start: point, end: point });
      event.currentTarget.setPointerCapture(event.pointerId);
    },
    [addCircleObstacle, map, toBoardPoint, tool]
  );

  const handlePointerMove = useCallback(
    (event: ReactPointerEvent<HTMLCanvasElement>) => {
      const start = dragStartRef.current;

      if (!start || (tool !== "wall" && tool !== "booster")) {
        return;
      }

      setDragPreview({ tool, start, end: toBoardPoint(event) });
    },
    [toBoardPoint, tool]
  );

  const handlePointerUp = useCallback(
    (event: ReactPointerEvent<HTMLCanvasElement>) => {
      const start = dragStartRef.current;

      if (!start) {
        return;
      }

      commitSegment(start, toBoardPoint(event));
      dragStartRef.current = null;
      setDragPreview(null);
    },
    [commitSegment, toBoardPoint]
  );

  const clearMap = useCallback(() => {
    setMap(createEmptyCustomMap());
    setSaveStatus("초기화됨");
  }, []);

  const addGuide = useCallback(() => {
    setMap((current) => ({
      ...current,
      path: DEFAULT_GUIDE_PATH.map((node) => ({ ...node })),
      walls: [...current.walls, ...createGuideWalls()],
    }));
    setSaveStatus("가이드 추가됨");
  }, []);

  const saveMap = useCallback(async () => {
    const payload = {
      name: mapName.trim() || "커스텀 핀볼 맵",
      seed: map.seed,
      complexity: map.complexity,
      structure: map.structure,
      map,
    };

    setIsSaving(true);
    setSaveStatus("저장 중");

    try {
      if (isStaticSpa()) {
        throw new Error("Static SPA uses local saved maps only");
      }

      const response = await fetch("/api/maps", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });

      if (!response.ok) {
        throw new Error("D1 save failed");
      }

      setSaveStatus("D1 저장됨");
    } catch {
      const localRecord: SavedMapRecord = {
        id: `local-${randomId("custom")}`,
        name: payload.name,
        seed: payload.seed,
        complexity: payload.complexity,
        structure: "custom",
        map,
        createdAt: Date.now(),
        storage: "local",
      };
      writeLocalMaps([localRecord, ...readLocalMaps()]);
      setSaveStatus("로컬 저장됨");
    } finally {
      setIsSaving(false);
    }
  }, [map, mapName]);

  return (
    <main className="builder-shell">
      <header className="builder-topbar">
        <div className="brand-block">
          <p>CUSTOM PINBALL MAP</p>
          <h1>커스텀 맵 생성</h1>
        </div>
        <div className="builder-nav">
          <Link href="/">게임으로</Link>
          <strong>{saveStatus}</strong>
        </div>
      </header>

      <div className="builder-workspace">
        <section className="builder-panel" aria-label="커스텀 맵 도구">
          <div className="panel-title">
            <h2>맵</h2>
            <span>커스텀</span>
          </div>
          <input
            value={mapName}
            maxLength={80}
            onChange={(event) => setMapName(event.target.value)}
          />
          <button
            type="button"
            className="primary-button full-button"
            disabled={isSaving}
            onClick={() => void saveMap()}
          >
            {isSaving ? "저장 중" : "맵 저장"}
          </button>

          <div className="panel-title">
            <h2>도구</h2>
            <span>{TOOL_LABELS[tool]}</span>
          </div>
          <div className="tool-grid">
            {(Object.keys(TOOL_LABELS) as Tool[]).map((toolKey) => (
              <button
                key={toolKey}
                type="button"
                aria-pressed={tool === toolKey}
                onClick={() => setTool(toolKey)}
              >
                {TOOL_LABELS[toolKey]}
              </button>
            ))}
          </div>

          <div className="button-grid">
            <button type="button" onClick={addGuide}>
              가이드 길
            </button>
            <button type="button" onClick={clearMap}>
              초기화
            </button>
          </div>
        </section>

        <section className="editor-stage-wrap" aria-label="커스텀 맵 캔버스">
          <div className="editor-board-frame">
            <canvas
              ref={canvasRef}
              className="editor-canvas"
              width={BOARD_WIDTH}
              height={BOARD_HEIGHT}
              onPointerDown={handlePointerDown}
              onPointerMove={handlePointerMove}
              onPointerUp={handlePointerUp}
              onPointerCancel={() => {
                dragStartRef.current = null;
                setDragPreview(null);
              }}
            />
          </div>
        </section>

        <aside className="builder-panel" aria-label="커스텀 맵 상태">
          <div className="panel-title">
            <h2>구성</h2>
            <span>{counts.walls + counts.pins + counts.bumpers + counts.exploders + counts.boosters}</span>
          </div>
          <dl className="summary-grid">
            <div>
              <dt>벽</dt>
              <dd>{counts.walls}</dd>
            </div>
            <div>
              <dt>핀</dt>
              <dd>{counts.pins}</dd>
            </div>
            <div>
              <dt>범퍼</dt>
              <dd>{counts.bumpers}</dd>
            </div>
            <div>
              <dt>폭발</dt>
              <dd>{counts.exploders}</dd>
            </div>
            <div>
              <dt>회전</dt>
              <dd>{counts.boosters}</dd>
            </div>
          </dl>
          <Link className="builder-game-link" href="/">
            저장된 맵 불러오기
          </Link>
        </aside>
      </div>
    </main>
  );
}

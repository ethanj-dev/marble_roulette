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
const BALL_RADIUS = 10;
const ROUTE_CLEARANCE = BALL_RADIUS + 10;
const WALL_TRAP_CLEARANCE = BALL_RADIUS * 2 + 18;
const BUMPER_WALL_CLEARANCE = BALL_RADIUS * 2 + 20;
const FINISH_DROP_CLEARANCE = BALL_RADIUS + 8;
const MIN_CUSTOM_PATH_WIDTH = BALL_RADIUS * 2 + 76;
const MAX_CUSTOM_PATH_STEP = 96;
const CUSTOM_PATH_TOP_Y = 88;
const CUSTOM_PATH_BOTTOM_Y = BOARD_HEIGHT - 132;
const CUSTOM_PATH_SAMPLE_STEP = 44;
const CUSTOM_WALL_SAMPLE_TOLERANCE = 18;
const MAX_CUSTOM_MISSING_SAMPLES = 1;

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
  wall: "경계벽",
  pin: "핀",
  bumper: "범퍼",
  exploder: "폭발",
  booster: "회전 막대",
  erase: "삭제",
};

type PathBuildResult = {
  path: PathNode[];
  ready: boolean;
  message: string;
  minWidth: number;
  missingSamples: number;
  narrowSamples: number;
  steepSamples: number;
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

function getWallIntersectionsAtY(
  walls: Segment[],
  y: number,
  tolerance = 0
) {
  const intersections = walls
    .flatMap((wall) => {
      const minY = Math.min(wall.y1, wall.y2);
      const maxY = Math.max(wall.y1, wall.y2);
      const spanY = wall.y2 - wall.y1;

      if (
        Math.abs(spanY) < 0.001 ||
        y < minY - tolerance ||
        y > maxY + tolerance
      ) {
        return [];
      }

      const t = clamp((y - wall.y1) / spanY, 0, 1);
      return [wall.x1 + (wall.x2 - wall.x1) * t];
    })
    .sort((a, b) => a - b);

  return intersections.filter(
    (x, index) => index === 0 || Math.abs(x - intersections[index - 1]) > 2
  );
}

function getWallIntersectionsNearY(walls: Segment[], y: number) {
  const direct = getWallIntersectionsAtY(walls, y);

  if (direct.length >= 2) {
    return direct;
  }

  return getWallIntersectionsAtY(walls, y, CUSTOM_WALL_SAMPLE_TOLERANCE);
}

function getFinishLineY() {
  return BOARD_HEIGHT - 58;
}

function getFinishClearStartY() {
  return BOARD_HEIGHT - 340;
}

function getPathBandAtY(path: PathNode[], y: number) {
  for (let index = 0; index < path.length - 1; index += 1) {
    const current = path[index];
    const next = path[index + 1];
    const minY = Math.min(current.y, next.y);
    const maxY = Math.max(current.y, next.y);

    if (y >= minY && y <= maxY) {
      const span = next.y - current.y;
      const t = span === 0 ? 0 : clamp((y - current.y) / span, 0, 1);

      return {
        x: current.x + (next.x - current.x) * t,
        width: current.width + (next.width - current.width) * t,
      };
    }
  }

  const nearest = path.reduce((best, point) =>
    Math.abs(point.y - y) < Math.abs(best.y - y) ? point : best
  );

  return { x: nearest.x, width: nearest.width };
}

function buildCustomPathFromWalls(walls: Segment[]): PathBuildResult {
  if (walls.length < 2) {
    return {
      path: [],
      ready: false,
      message: "경계벽 2개 이상 필요",
      minWidth: 0,
      missingSamples: 0,
      narrowSamples: 0,
      steepSamples: 0,
    };
  }

  const path: PathNode[] = [];
  let minWidth = Number.POSITIVE_INFINITY;
  let missingSamples = 0;
  let narrowSamples = 0;
  let steepSamples = 0;
  let consecutiveMissingSamples = 0;
  let maxConsecutiveMissingSamples = 0;
  let previous: PathNode | null = null;

  for (
    let y = CUSTOM_PATH_TOP_Y;
    y <= CUSTOM_PATH_BOTTOM_Y;
    y += CUSTOM_PATH_SAMPLE_STEP
  ) {
    const intersections = getWallIntersectionsNearY(walls, y);

    if (intersections.length < 2) {
      missingSamples += 1;
      consecutiveMissingSamples += 1;
      maxConsecutiveMissingSamples = Math.max(
        maxConsecutiveMissingSamples,
        consecutiveMissingSamples
      );
      continue;
    }

    consecutiveMissingSamples = 0;

    const left = intersections[0];
    const right = intersections[intersections.length - 1];
    const width = right - left;
    const node = {
      x: (left + right) / 2,
      y,
      width,
    };

    minWidth = Math.min(minWidth, width);

    if (width < MIN_CUSTOM_PATH_WIDTH) {
      narrowSamples += 1;
    }

    if (previous && Math.abs(node.x - previous.x) > MAX_CUSTOM_PATH_STEP) {
      steepSamples += 1;
    }

    path.push(node);
    previous = node;
  }

  if (path[path.length - 1]?.y !== CUSTOM_PATH_BOTTOM_Y) {
    const intersections = getWallIntersectionsNearY(walls, CUSTOM_PATH_BOTTOM_Y);

    if (intersections.length >= 2) {
      const left = intersections[0];
      const right = intersections[intersections.length - 1];
      path.push({
        x: (left + right) / 2,
        y: CUSTOM_PATH_BOTTOM_Y,
        width: right - left,
      });
      minWidth = Math.min(minWidth, right - left);
    }
  }

  if (
    path.length < 6 ||
    missingSamples > MAX_CUSTOM_MISSING_SAMPLES ||
    maxConsecutiveMissingSamples > MAX_CUSTOM_MISSING_SAMPLES
  ) {
    return {
      path,
      ready: false,
      message: "경계벽이 위부터 아래까지 이어져야 함",
      minWidth: Number.isFinite(minWidth) ? minWidth : 0,
      missingSamples,
      narrowSamples,
      steepSamples,
    };
  }

  if (narrowSamples > 0) {
    return {
      path,
      ready: false,
      message: "길 폭이 너무 좁음",
      minWidth,
      missingSamples,
      narrowSamples,
      steepSamples,
    };
  }

  if (steepSamples > 0) {
    return {
      path,
      ready: false,
      message: "가로 꺾임이 너무 큼",
      minWidth,
      missingSamples,
      narrowSamples,
      steepSamples,
    };
  }

  return {
    path,
    ready: true,
    message: "경로 준비됨",
    minWidth,
    missingSamples,
    narrowSamples,
    steepSamples,
  };
}

function isPointInsidePath(path: PathNode[], point: Point, margin: number) {
  if (path.length < 2) {
    return false;
  }

  const band = getPathBandAtY(path, point.y);
  const halfWidth = Math.max(0, band.width / 2 - margin);

  return Math.abs(point.x - band.x) <= halfWidth;
}

function isCircleClearOfWalls(
  walls: Segment[],
  circle: Pick<CircleObstacle, "x" | "y" | "radius">,
  padding: number
) {
  return walls.every(
    (wall) => distanceToSegment(circle, wall) > circle.radius + padding
  );
}

function findCirclePlacementPoint(
  path: PathNode[],
  walls: Segment[],
  point: Point,
  radius: number,
  pathMargin: number,
  wallPadding: number
) {
  const band = getPathBandAtY(path, point.y);
  const halfWidth = Math.max(0, band.width / 2 - pathMargin);

  if (halfWidth <= 0) {
    return null;
  }

  const baseX = clamp(point.x, band.x - halfWidth, band.x + halfWidth);
  const offsets = [0];

  for (let offset = 4; offset <= Math.min(halfWidth * 2, 96); offset += 4) {
    offsets.push(-offset, offset);
  }

  for (const offset of offsets) {
    const candidate = {
      x: clamp(baseX + offset, band.x - halfWidth, band.x + halfWidth),
      y: point.y,
    };
    const circle = { ...candidate, radius };

    if (!isPointInsidePath(path, candidate, pathMargin)) {
      continue;
    }

    if (blocksFinishDropLane(path, candidate, radius)) {
      continue;
    }

    if (!isCircleClearOfWalls(walls, circle, wallPadding)) {
      continue;
    }

    return candidate;
  }

  return null;
}

function isBoosterClearOfWalls(
  walls: Segment[],
  booster: Booster,
  padding = BALL_RADIUS + 22
) {
  const center = {
    x: (booster.x1 + booster.x2) / 2,
    y: (booster.y1 + booster.y2) / 2,
    radius: Math.hypot(booster.x2 - booster.x1, booster.y2 - booster.y1) / 2,
  };

  return isCircleClearOfWalls(walls, center, padding);
}

function isSegmentInsidePath(
  path: PathNode[],
  segment: Pick<Segment, "x1" | "y1" | "x2" | "y2">,
  margin: number
) {
  for (let index = 0; index <= 4; index += 1) {
    const t = index / 4;
    const point = {
      x: segment.x1 + (segment.x2 - segment.x1) * t,
      y: segment.y1 + (segment.y2 - segment.y1) * t,
    };

    if (!isPointInsidePath(path, point, margin)) {
      return false;
    }
  }

  return true;
}

function blocksFinishDropLane(
  path: PathNode[],
  point: Point,
  radius: number
) {
  if (point.y < getFinishClearStartY() || point.y > getFinishLineY() + 10) {
    return false;
  }

  const band = getPathBandAtY(path, point.y);
  return Math.abs(point.x - band.x) < radius + FINISH_DROP_CLEARANCE;
}

function segmentBlocksFinishDropLane(
  path: PathNode[],
  segment: Pick<Segment, "x1" | "y1" | "x2" | "y2">,
  padding: number
) {
  for (let index = 0; index <= 8; index += 1) {
    const t = index / 8;
    const point = {
      x: segment.x1 + (segment.x2 - segment.x1) * t,
      y: segment.y1 + (segment.y2 - segment.y1) * t,
    };

    if (blocksFinishDropLane(path, point, padding)) {
      return true;
    }
  }

  return false;
}

function hasFinishDropLane(walls: Segment[], path: PathNode[]) {
  for (let y = getFinishClearStartY(); y <= getFinishLineY(); y += 24) {
    const band = getPathBandAtY(path, y);
    const point = { x: band.x, y };

    if (!isPointInsidePath(path, point, FINISH_DROP_CLEARANCE)) {
      return false;
    }

    if (
      walls.some((wall) => distanceToSegment(point, wall) <= ROUTE_CLEARANCE)
    ) {
      return false;
    }
  }

  return true;
}

function getCircleRouteClearance(circle: CircleObstacle) {
  return circle.id.startsWith("pin-")
    ? BALL_RADIUS + 4
    : ROUTE_CLEARANCE;
}

function hasOpenRoute(
  walls: Segment[],
  path: PathNode[],
  circles: CircleObstacle[],
  boosters: Booster[]
) {
  const stepX = 10;
  const stepY = 16;
  let reachable: Point[] = [];
  let started = false;

  for (let y = path[0].y + 26; y <= BOARD_HEIGHT - 64; y += stepY) {
    const band = getPathBandAtY(path, y);
    const minX = band.x - band.width / 2 + ROUTE_CLEARANCE;
    const maxX = band.x + band.width / 2 - ROUTE_CLEARANCE;
    const nodes: Point[] = [];

    for (let x = minX; x <= maxX; x += stepX) {
      const point = { x, y };

      if (
        walls.every((wall) => distanceToSegment(point, wall) > ROUTE_CLEARANCE) &&
        circles.every(
          (circle) =>
            Math.hypot(point.x - circle.x, point.y - circle.y) >
            circle.radius + getCircleRouteClearance(circle)
        ) &&
        boosters.every(
          (booster) => distanceToSegment(point, booster) > ROUTE_CLEARANCE + 4
        )
      ) {
        nodes.push(point);
      }
    }

    if (nodes.length === 0) {
      if (started) {
        return false;
      }

      continue;
    }

    if (!started) {
      reachable = nodes;
      started = true;
      continue;
    }

    reachable = nodes.filter((node) =>
      reachable.some(
        (previous) =>
          Math.abs(previous.x - node.x) <= stepX * 1.8 &&
          Math.abs(previous.y - node.y) <= stepY * 1.2
      )
    );

    if (reachable.length === 0) {
      return false;
    }
  }

  return reachable.length > 0;
}

function validateCustomMapForSave(map: CustomMapLayout, path: PathNode[]) {
  const pins = map.pins.filter(
    (pin) =>
      isPointInsidePath(path, pin, pin.radius + BALL_RADIUS + 8) &&
      !blocksFinishDropLane(path, pin, pin.radius) &&
      isCircleClearOfWalls(map.walls, pin, WALL_TRAP_CLEARANCE)
  );
  const bumpers = map.bumpers.filter(
    (bumper) =>
      isPointInsidePath(path, bumper, bumper.radius + BALL_RADIUS + 10) &&
      !blocksFinishDropLane(path, bumper, bumper.radius) &&
      isCircleClearOfWalls(map.walls, bumper, BUMPER_WALL_CLEARANCE)
  );
  const exploders = map.exploders.filter(
    (exploder) =>
      isPointInsidePath(path, exploder, exploder.radius + BALL_RADIUS + 10) &&
      !blocksFinishDropLane(path, exploder, exploder.radius) &&
      isCircleClearOfWalls(map.walls, exploder, WALL_TRAP_CLEARANCE)
  );
  const boosters = map.boosters.filter(
    (booster) =>
      isSegmentInsidePath(path, booster, BALL_RADIUS + 18) &&
      !segmentBlocksFinishDropLane(path, booster, 8) &&
      isBoosterClearOfWalls(map.walls, booster)
  );
  const removedObstacleCount =
    map.pins.length -
    pins.length +
    map.bumpers.length -
    bumpers.length +
    map.exploders.length -
    exploders.length +
    map.boosters.length -
    boosters.length;

  if (removedObstacleCount > 0) {
    return {
      ok: false,
      message: "장애물이 길/벽/피니시 조건을 벗어남",
      map,
    };
  }

  if (!hasFinishDropLane(map.walls, path)) {
    return {
      ok: false,
      message: "피니시 중앙 길이 막힘",
      map,
    };
  }

  if (!hasOpenRoute(map.walls, path, [...pins, ...bumpers, ...exploders], boosters)) {
    return {
      ok: false,
      message: "위에서 아래까지 열린 길이 없음",
      map,
    };
  }

  return {
    ok: true,
    message: "저장 가능",
    map: {
      ...map,
      path,
      pins,
      bumpers,
      exploders,
      boosters,
    },
  };
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
  pathBuild: PathBuildResult,
  preview: DragPreview | null
) {
  ctx.clearRect(0, 0, BOARD_WIDTH, BOARD_HEIGHT);
  const backdrop = ctx.createLinearGradient(0, 0, 0, BOARD_HEIGHT);
  backdrop.addColorStop(0, "#131726");
  backdrop.addColorStop(0.5, "#0e1220");
  backdrop.addColorStop(1, "#0b0e1a");
  ctx.fillStyle = backdrop;
  ctx.fillRect(0, 0, BOARD_WIDTH, BOARD_HEIGHT);

  ctx.save();
  ctx.globalAlpha = 0.12;
  ctx.strokeStyle = "#4a5a8c";
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

  ctx.strokeStyle = "rgba(255, 216, 77, 0.4)";
  ctx.lineWidth = 2;
  ctx.strokeRect(8, 8, BOARD_WIDTH - 16, BOARD_HEIGHT - 16);

  if (pathBuild.path.length >= 2) {
    ctx.save();
    ctx.globalAlpha = pathBuild.ready ? 0.16 : 0.08;
    ctx.fillStyle = pathBuild.ready ? "#32f7ff" : "#ffcf47";
    ctx.beginPath();
    pathBuild.path.forEach((node, index) => {
      const x = node.x - node.width / 2;
      if (index === 0) {
        ctx.moveTo(x, node.y);
      } else {
        ctx.lineTo(x, node.y);
      }
    });
    [...pathBuild.path].reverse().forEach((node) => {
      ctx.lineTo(node.x + node.width / 2, node.y);
    });
    ctx.closePath();
    ctx.fill();
    ctx.globalAlpha = 0.55;
    ctx.strokeStyle = pathBuild.ready ? "#32f7ff" : "#ffcf47";
    ctx.lineWidth = 1;
    ctx.setLineDash([6, 7]);
    ctx.beginPath();
    pathBuild.path.forEach((node, index) => {
      if (index === 0) {
        ctx.moveTo(node.x, node.y);
      } else {
        ctx.lineTo(node.x, node.y);
      }
    });
    ctx.stroke();
    ctx.restore();
  }

  ctx.save();
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  for (const wall of map.walls) {
    ctx.strokeStyle = "#1d2336";
    ctx.lineWidth = 16;
    ctx.beginPath();
    ctx.moveTo(wall.x1, wall.y1);
    ctx.lineTo(wall.x2, wall.y2);
    ctx.stroke();
    ctx.strokeStyle = "#93a7d8";
    ctx.globalAlpha = 0.55;
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
  const pathBuild = useMemo(() => buildCustomPathFromWalls(map.walls), [map.walls]);

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
      drawCustomBoard(ctx, map, pathBuild, dragPreview);
    }
  }, [dragPreview, map, pathBuild]);

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

    if (tool === "wall" && Math.abs(end.y - start.y) < 32) {
      setSaveStatus("경계벽은 위아래 방향 필요");
      return;
    }

    if (tool === "booster") {
      if (!pathBuild.ready) {
        setSaveStatus(pathBuild.message);
        return;
      }

      if (!isSegmentInsidePath(pathBuild.path, segment, BALL_RADIUS + 18)) {
        setSaveStatus("회전 막대는 길 안쪽에 배치");
        return;
      }

      if (segmentBlocksFinishDropLane(pathBuild.path, segment, 8)) {
        setSaveStatus("피니시 중앙 길은 비워두기");
        return;
      }

      if (!isBoosterClearOfWalls(map.walls, { ...segment, id: "preview", strength: 9 })) {
        setSaveStatus("회전 막대가 벽에 너무 가까움");
        return;
      }
    }

    if (tool === "wall") {
      const isInternalWall =
        pathBuild.ready && isSegmentInsidePath(pathBuild.path, segment, 14);
      setSaveStatus(
        isInternalWall ? "내부 벽은 저장 검증에서 막힐 수 있음" : "경계벽 추가됨"
      );
    } else {
      setSaveStatus("회전 막대 추가됨");
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
  }, [map, pathBuild, tool]);

  const handlePointerDown = useCallback(
    (event: ReactPointerEvent<HTMLCanvasElement>) => {
      const point = toBoardPoint(event);

      if (tool === "erase") {
        setMap((current) => removeNearest(current, point));
        return;
      }

      if (tool === "pin" || tool === "bumper" || tool === "exploder") {
        if (!pathBuild.ready) {
          setSaveStatus(pathBuild.message);
          return;
        }

        const radius = tool === "pin" ? 3.8 : tool === "bumper" ? 20 : 18;
        const margin =
          radius + BALL_RADIUS + (tool === "pin" ? 8 : 10);
        const wallPadding =
          tool === "bumper" ? BUMPER_WALL_CLEARANCE : WALL_TRAP_CLEARANCE;
        const placementPoint = findCirclePlacementPoint(
          pathBuild.path,
          map.walls,
          point,
          radius,
          margin,
          wallPadding
        );

        if (!placementPoint) {
          setSaveStatus("장애물 여유 공간 부족");
          return;
        }

        addCircleObstacle(placementPoint);
        setSaveStatus(
          Math.abs(placementPoint.x - point.x) < 0.5
            ? `${TOOL_LABELS[tool]} 추가됨`
            : `${TOOL_LABELS[tool]} 안전 위치로 이동`
        );
        return;
      }

      dragStartRef.current = point;
      setDragPreview({ tool, start: point, end: point });
      event.currentTarget.setPointerCapture(event.pointerId);
    },
    [addCircleObstacle, map, pathBuild, toBoardPoint, tool]
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
      path: undefined,
      walls: [...current.walls, ...createGuideWalls()],
    }));
    setSaveStatus("샘플 경계 추가됨");
  }, []);

  const saveMap = useCallback(async () => {
    if (!pathBuild.ready) {
      setSaveStatus(pathBuild.message);
      return;
    }

    const validation = validateCustomMapForSave(map, pathBuild.path);

    if (!validation.ok) {
      setSaveStatus(validation.message);
      return;
    }

    const readyMap = validation.map;
    const payload = {
      name: mapName.trim() || "커스텀 핀볼 맵",
      seed: readyMap.seed,
      complexity: readyMap.complexity,
      structure: readyMap.structure,
      map: readyMap,
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
        map: readyMap,
        createdAt: Date.now(),
        storage: "local",
      };
      writeLocalMaps([localRecord, ...readLocalMaps()]);
      setSaveStatus("로컬 저장됨");
    } finally {
      setIsSaving(false);
    }
  }, [map, mapName, pathBuild]);

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
              샘플 경계
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
            <h2>경로</h2>
            <span>{pathBuild.ready ? "준비" : "미완성"}</span>
          </div>
          <dl className="summary-grid">
            <div>
              <dt>상태</dt>
              <dd>{pathBuild.ready ? "OK" : "NO"}</dd>
            </div>
            <div>
              <dt>최소폭</dt>
              <dd>{pathBuild.minWidth > 0 ? Math.round(pathBuild.minWidth) : "-"}</dd>
            </div>
          </dl>
          <div className="builder-status-line">{pathBuild.message}</div>
          <div className="builder-criteria" aria-label="커스텀 맵 최소 조건">
            <strong>최소 조건</strong>
            <dl>
              <div>
                <dt>경계</dt>
                <dd>좌/우 벽 2개가 y {CUSTOM_PATH_TOP_Y}-{CUSTOM_PATH_BOTTOM_Y} 연결</dd>
              </div>
              <div>
                <dt>폭</dt>
                <dd>
                  {MIN_CUSTOM_PATH_WIDTH}px 이상
                  {pathBuild.minWidth > 0
                    ? ` · 현재 ${Math.round(pathBuild.minWidth)}px`
                    : ""}
                </dd>
              </div>
              <div>
                <dt>꺾임</dt>
                <dd>샘플 사이 중심 이동 {MAX_CUSTOM_PATH_STEP}px 이하</dd>
              </div>
              <div>
                <dt>샘플</dt>
                <dd>
                  누락 {MAX_CUSTOM_MISSING_SAMPLES}개 이하
                  {pathBuild.path.length > 0
                    ? ` · 현재 ${pathBuild.missingSamples}개`
                    : ""}
                </dd>
              </div>
              <div>
                <dt>장애물</dt>
                <dd>벽 여유와 피니시 중앙 차선 확보</dd>
              </div>
            </dl>
          </div>

          <div className="panel-title">
            <h2>구성</h2>
            <span>{counts.walls + counts.pins + counts.bumpers + counts.exploders + counts.boosters}</span>
          </div>
          <dl className="summary-grid">
            <div>
              <dt>경계벽</dt>
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

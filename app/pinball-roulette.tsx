"use client";

import {
  type CSSProperties,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import Link from "./app-link";
import { isStaticSpa } from "./static-spa";

const BOARD_WIDTH = 430;
const DEFAULT_BOARD_HEIGHT = 1420;
const STORAGE_KEY = "pinball-roulette-saved-maps-v3";
const FEEDBACK_STORAGE_KEY = "pinball-roulette-feedback-v1";

const GENERATED_STRUCTURES = [
  "zigzag",
  "funnel",
  "chambers",
  "split",
  "cascade",
  "chaos",
] as const;
const STRUCTURES = [...GENERATED_STRUCTURES, "custom"] as const;

type GeneratedStructureKind = (typeof GENERATED_STRUCTURES)[number];
type StructureKind = (typeof STRUCTURES)[number];
type StructureChoice = GeneratedStructureKind | "random";

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

type RouteObstacles = {
  pins: CircleObstacle[];
  bumpers: CircleObstacle[];
  exploders: CircleObstacle[];
  boosters: Booster[];
};

type MapLayout = {
  version: 1;
  seed: number;
  complexity: number;
  structure: StructureKind;
  height?: number;
  path?: PathNode[];
  walls: Segment[];
  pins: CircleObstacle[];
  bumpers: CircleObstacle[];
  exploders: CircleObstacle[];
  boosters: Booster[];
};

type Player = {
  id: number;
  name: string;
  color: string;
};

type Ball = {
  id: string;
  name: string;
  color: string;
  x: number;
  y: number;
  vx: number;
  vy: number;
  radius: number;
  finished: boolean;
  blastCooldown: number;
  bumperCooldown: number;
  bumperChain: number;
  racePhase: number;
  raceSpeedBonus: number;
  trail: Point[];
};

type Pulse = {
  x: number;
  y: number;
  radius: number;
  life: number;
  maxLife: number;
  color: string;
};

type SavedMapRecord = {
  id: string;
  name: string;
  seed: number;
  complexity: number;
  structure: StructureKind;
  map: MapLayout;
  createdAt: number;
  storage: "d1" | "local";
};

type FeedbackRecord = {
  id: string;
  message: string;
  mapName: string;
  seed: number;
  complexity: number;
  structure: StructureKind;
  createdAt: number;
};

type Telemetry = {
  falling: number;
  finished: number;
};

type RankingEntry = {
  id: string;
  name: string;
  color: string;
};

type WinnerMode = "first" | "last";

type ObstacleFootprint = {
  x: number;
  y: number;
  radius: number;
};

const STRUCTURE_LABELS: Record<StructureKind | "random", string> = {
  random: "랜덤",
  zigzag: "지그재그",
  funnel: "깔때기",
  chambers: "방 구조",
  split: "분기",
  cascade: "계단",
  chaos: "혼합",
  custom: "커스텀",
};

const BALL_COLORS = [
  "#38d5ff",
  "#746cff",
  "#ff4aa2",
  "#ffdc3a",
  "#46f07f",
  "#ff7a2f",
  "#b26cff",
  "#f85858",
  "#7cf7df",
  "#f6a7ff",
];

const MIN_OBSTACLE_GAP = 64;
const BALL_RADIUS = 10;
const ROUTE_CLEARANCE = BALL_RADIUS + 10;
const WALL_TRAP_CLEARANCE = BALL_RADIUS * 2 + 18;
const BUMPER_WALL_CLEARANCE = BALL_RADIUS * 2 + 20;
const MIN_BRANCH_LANE_WIDTH = BALL_RADIUS * 2 + 44;
const FINISH_DROP_CLEARANCE = BALL_RADIUS + 8;
const MAX_PATH_HORIZONTAL_STEP = 76;
const MAX_HIGH_COMPLEXITY_PATH_STEP = 88;
const RACE_DRAFT_GAP = 120;
const RACE_DRAFT_ACCEL = 0.2;
const RACE_LEADER_PRESSURE_GAP = 92;
const RACE_LEADER_DRAG = 0.18;
const RACE_LEADER_BREAKAWAY_DRAG = 0.22;
const RACE_SWIRL_ACCEL = 0.026;
const RACE_PULSE_ACCEL = 0.055;
const RACE_DRAFT_SPEED_BONUS = 4.2;
const RACE_PULSE_SPEED_BONUS = 0.35;
const RACE_TRAILING_PROGRESS_FLOOR = 4.3;
const PATH_FLOW_ACCEL = 0.0032;
const PATH_FLOW_MAX_ACCEL = 0.16;

function getGeneratedBoardHeight(complexity: number) {
  const level = clamp(Math.round(complexity), 1, 5);
  return 1180 + level * 150;
}

function getPathBoardHeight(path?: PathNode[]) {
  if (!path || path.length === 0) {
    return DEFAULT_BOARD_HEIGHT;
  }

  return Math.max(DEFAULT_BOARD_HEIGHT, Math.round(path[path.length - 1].y + 132));
}

function getBoardHeight(map: Pick<MapLayout, "height" | "path">) {
  return map.height ?? getPathBoardHeight(map.path);
}

function getFinishLineY(boardHeight: number) {
  return boardHeight - 58;
}

function getFinishClearStartY(boardHeight: number) {
  return boardHeight - 340;
}

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

function createRng(seed: number) {
  let value = seed >>> 0;

  return () => {
    value += 0x6d2b79f5;
    let next = value;
    next = Math.imul(next ^ (next >>> 15), next | 1);
    next ^= next + Math.imul(next ^ (next >>> 7), next | 61);
    return ((next ^ (next >>> 14)) >>> 0) / 4294967296;
  };
}

function randomSeed() {
  return Math.floor(Math.random() * 2147483647);
}

function randomRange(rng: () => number, min: number, max: number) {
  return min + rng() * (max - min);
}

function shuffleWithRng<T>(items: T[], rng: () => number) {
  const shuffled = [...items];

  for (let index = shuffled.length - 1; index > 0; index -= 1) {
    const swapIndex = Math.floor(rng() * (index + 1));
    [shuffled[index], shuffled[swapIndex]] = [
      shuffled[swapIndex],
      shuffled[index],
    ];
  }

  return shuffled;
}

function computeWinnerLabel(
  ranking: RankingEntry[],
  totalPlayers: number,
  winnerMode: WinnerMode,
  winnerCount: number
) {
  const count = clamp(Math.round(winnerCount), 1, Math.max(1, totalPlayers));

  if (winnerMode === "first") {
    if (ranking.length < count) {
      return null;
    }

    return ranking
      .slice(0, count)
      .map((entry) => entry.name)
      .join(", ");
  }

  if (ranking.length < totalPlayers || totalPlayers === 0) {
    return null;
  }

  return ranking
    .slice(-count)
    .reverse()
    .map((entry) => entry.name)
    .join(", ");
}

function pickStructure(rng: () => number, choice: StructureChoice) {
  if (choice !== "random") {
    return choice;
  }

  return GENERATED_STRUCTURES[Math.floor(rng() * GENERATED_STRUCTURES.length)] ?? "zigzag";
}

function addWall(
  walls: Segment[],
  id: string,
  x1: number,
  y1: number,
  x2: number,
  y2: number,
  bounce = 0.82
) {
  walls.push({ id, x1, y1, x2, y2, bounce });
}

function hasObstacleSpace(
  candidate: ObstacleFootprint,
  footprints: ObstacleFootprint[],
  gap = MIN_OBSTACLE_GAP
) {
  return footprints.every((footprint) => {
    const distance = Math.hypot(candidate.x - footprint.x, candidate.y - footprint.y);
    return distance >= candidate.radius + footprint.radius + gap;
  });
}

function getObstacleGap(complexity: number) {
  return MIN_OBSTACLE_GAP - (clamp(complexity, 1, 5) - 1) * 4;
}

function pickDistributedPathPoint(
  path: PathNode[],
  itemIndex: number,
  itemCount: number,
  attempt: number,
  minIndex: number,
  maxIndex: number
) {
  const span = Math.max(1, maxIndex - minIndex);
  const targetIndex =
    minIndex +
    Math.floor(
      ((itemIndex + 1 + attempt * 0.21) * span) / (itemCount + 1)
    );

  return path[clamp(targetIndex, minIndex, maxIndex)];
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

function constrainXToPath(path: PathNode[], y: number, x: number, margin: number) {
  const band = getPathBandAtY(path, y);
  const halfWidth = Math.max(10, band.width / 2 - margin);

  return clamp(x, band.x - halfWidth, band.x + halfWidth);
}

function isPointInsidePath(path: PathNode[], point: Point, margin: number) {
  const band = getPathBandAtY(path, point.y);
  const halfWidth = Math.max(0, band.width / 2 - margin);

  return Math.abs(point.x - band.x) <= halfWidth;
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
  const boardHeight = getPathBoardHeight(path);
  const finishClearStartY = getFinishClearStartY(boardHeight);
  const finishLineY = getFinishLineY(boardHeight);

  if (point.y < finishClearStartY || point.y > finishLineY + 10) {
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

function hasBranchLaneClearance(
  path: PathNode[],
  segments: Pick<Segment, "x1" | "y1" | "x2" | "y2">[]
) {
  return segments.every((segment) => {
    for (let index = 0; index <= 16; index += 1) {
      const t = index / 16;
      const point = {
        x: segment.x1 + (segment.x2 - segment.x1) * t,
        y: segment.y1 + (segment.y2 - segment.y1) * t,
      };
      const band = getPathBandAtY(path, point.y);
      const leftBoundary = band.x - band.width / 2;
      const rightBoundary = band.x + band.width / 2;
      const leftGap = point.x - leftBoundary;
      const rightGap = rightBoundary - point.x;

      if (
        leftGap < MIN_BRANCH_LANE_WIDTH ||
        rightGap < MIN_BRANCH_LANE_WIDTH
      ) {
        return false;
      }
    }

    return true;
  });
}

function distanceToSegmentPoint(
  point: Point,
  segment: Pick<Segment, "x1" | "y1" | "x2" | "y2">
) {
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

function isCircleClearOfWalls(
  walls: Segment[],
  circle: Pick<CircleObstacle, "x" | "y" | "radius">,
  padding = ROUTE_CLEARANCE
) {
  return walls.every(
    (wall) => distanceToSegmentPoint(circle, wall) > circle.radius + padding
  );
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

function getCircleRouteClearance(circle: CircleObstacle) {
  return circle.id.startsWith("pin-")
    ? BALL_RADIUS + 4
    : ROUTE_CLEARANCE;
}

function hasOpenRoute(
  walls: Segment[],
  path: PathNode[],
  circles: CircleObstacle[] = [],
  boosters: Booster[] = []
) {
  const clearance = ROUTE_CLEARANCE;
  const stepX = 10;
  const stepY = 16;
  let reachable: Point[] = [];
  let started = false;
  const boardHeight = getPathBoardHeight(path);

  for (
    let y = path[0].y + 26;
    y <= boardHeight - 64;
    y += stepY
  ) {
    const band = getPathBandAtY(path, y);
    const minX = band.x - band.width / 2 + clearance;
    const maxX = band.x + band.width / 2 - clearance;
    const nodes: Point[] = [];

    for (let x = minX; x <= maxX; x += stepX) {
      const point = { x, y };

      if (
        walls.every(
          (wall) => distanceToSegmentPoint(point, wall) > clearance
        ) &&
        circles.every(
          (circle) =>
            Math.hypot(point.x - circle.x, point.y - circle.y) >
            circle.radius + getCircleRouteClearance(circle)
        ) &&
        boosters.every(
          (booster) => distanceToSegmentPoint(point, booster) > clearance + 4
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

function routeIsOpen(
  walls: Segment[],
  path: PathNode[],
  obstacles: RouteObstacles
) {
  return hasOpenRoute(
    walls,
    path,
    [...obstacles.pins, ...obstacles.bumpers, ...obstacles.exploders],
    obstacles.boosters
  );
}

function makeObstaclesRouteSafe(
  walls: Segment[],
  path: PathNode[],
  obstacles: RouteObstacles
): RouteObstacles {
  let next = obstacles;

  if (routeIsOpen(walls, path, next)) {
    return next;
  }

  const tryPrune = (prune: (current: RouteObstacles) => RouteObstacles) => {
    next = prune(next);
    return routeIsOpen(walls, path, next);
  };

  if (
    tryPrune((current) => ({
      ...current,
      pins: current.pins.filter((pin) => !pin.id.startsWith("finish-pin-")),
      bumpers: current.bumpers.filter(
        (bumper) => !bumper.id.startsWith("finish-bumper-")
      ),
      boosters: current.boosters.filter(
        (booster) => !booster.id.startsWith("finish-kicker-")
      ),
    }))
  ) {
    return next;
  }

  if (
    tryPrune((current) => ({
      pins: current.pins.filter((pin) => pin.y < getFinishClearStartY(getPathBoardHeight(path))),
      bumpers: current.bumpers.filter(
        (bumper) => bumper.y < getFinishClearStartY(getPathBoardHeight(path))
      ),
      exploders: current.exploders.filter(
        (exploder) => exploder.y < getFinishClearStartY(getPathBoardHeight(path))
      ),
      boosters: current.boosters.filter(
        (booster) =>
          isProtectedBooster(booster) ||
          Math.max(booster.y1, booster.y2) < getFinishClearStartY(getPathBoardHeight(path))
      ),
    }))
  ) {
    return next;
  }

  const inNarrowPath = (point: Point) => getPathBandAtY(path, point.y).width < 132;
  const pruningSteps: Array<(current: RouteObstacles) => RouteObstacles> = [
    (current) => ({
      ...current,
      pins: current.pins.filter(
        (pin) => isRouteDeflectorPin(pin) || !inNarrowPath(pin)
      ),
      bumpers: current.bumpers.filter((bumper) => !inNarrowPath(bumper)),
      exploders: current.exploders.filter((exploder) => !inNarrowPath(exploder)),
      boosters: current.boosters.filter(
        (booster) =>
          isProtectedBooster(booster) ||
          !inNarrowPath({
            x: (booster.x1 + booster.x2) / 2,
            y: (booster.y1 + booster.y2) / 2,
          })
      ),
    }),
    (current) => ({ ...current, boosters: current.boosters.filter(isProtectedBooster) }),
    (current) => ({ ...current, exploders: [] }),
  ];

  for (const prune of pruningSteps) {
    if (tryPrune(prune)) {
      return next;
    }
  }

  return next;
}

function unblockMapWalls(walls: Segment[], path: PathNode[]) {
  if (hasOpenRoute(walls, path)) {
    return walls;
  }

  const optionalPrefixes = ["divider-", "split-island-", "pocket-"];
  let candidate = walls;

  for (const prefix of optionalPrefixes) {
    candidate = candidate.filter((wall) => !wall.id.startsWith(prefix));

    if (hasOpenRoute(candidate, path)) {
      return candidate;
    }
  }

  return candidate;
}

function isFinishBumper(bumper: CircleObstacle) {
  return bumper.id.startsWith("finish-bumper");
}

function isRouteDeflectorPin(pin: CircleObstacle) {
  return (
    pin.id.startsWith("pin-zigzag-deflector-") ||
    pin.id.startsWith("pin-route-deflector-")
  );
}

function isRequiredBooster(booster: Booster) {
  return booster.id.startsWith("boost-required-");
}

function isFinishSideBooster(booster: Booster) {
  return booster.id.startsWith("boost-finish-side-");
}

function isProtectedBooster(booster: Booster) {
  return isRequiredBooster(booster) || isFinishSideBooster(booster);
}

function getBoosterFootprint(booster: Booster): ObstacleFootprint {
  return {
    x: (booster.x1 + booster.x2) / 2,
    y: (booster.y1 + booster.y2) / 2,
    radius: Math.hypot(booster.x2 - booster.x1, booster.y2 - booster.y1) / 2 + 18,
  };
}

function hasBumperLaneSpace(
  candidate: CircleObstacle,
  bumpers: CircleObstacle[]
) {
  return bumpers.every((bumper) => {
    const verticalGap = Math.abs(candidate.y - bumper.y);
    const horizontalGap = Math.abs(candidate.x - bumper.x);

    return verticalGap >= 150 || horizontalGap >= candidate.radius + bumper.radius + 58;
  });
}

function addRequiredBooster(
  path: PathNode[],
  walls: Segment[],
  pins: CircleObstacle[],
  bumpers: CircleObstacle[],
  exploders: CircleObstacle[],
  boosters: Booster[],
  obstacleFootprints: ObstacleFootprint[],
  rng: () => number,
  level: number,
  obstacleGap: number
) {
  if (boosters.some(isRequiredBooster)) {
    return;
  }

  const boardHeight = getPathBoardHeight(path);
  const minY = path[1].y + 116;
  const maxY = getFinishClearStartY(boardHeight) - 190;
  const baseRouteIsOpen = hasOpenRoute(
    walls,
    path,
    [...pins, ...bumpers, ...exploders],
    boosters
  );

  for (let attempt = 0; attempt < 48; attempt += 1) {
    const progress = clamp(0.22 + (attempt % 12) * 0.045 + randomRange(rng, -0.018, 0.018), 0.18, 0.72);
    const pathIndex = clamp(
      Math.round(progress * (path.length - 1)),
      2,
      path.length - 4
    );
    const node = path[pathIndex];

    if (!node) {
      continue;
    }

    const centerY = clamp(
      node.y + randomRange(rng, -28, 48),
      minY,
      maxY
    );
    const band = getPathBandAtY(path, centerY);

    if (band.width < 126) {
      continue;
    }

    const length = clamp(34 + level * 1.4 + randomRange(rng, -2, 4), 34, 43);
    const halfLength = length / 2;
    const centerX = constrainXToPath(
      path,
      centerY,
      band.x + randomRange(rng, -16, 16),
      halfLength + 26
    );
    const candidate = {
      id: "boost-required-0",
      x1: centerX - halfLength,
      y1: centerY + 11,
      x2: centerX + halfLength,
      y2: centerY - 11 + randomRange(rng, -7, 7),
      strength: randomRange(rng, 7, 9),
    };
    const footprint = getBoosterFootprint(candidate);

    if (!isSegmentInsidePath(path, candidate, 16)) {
      continue;
    }

    if (segmentBlocksFinishDropLane(path, candidate, 8)) {
      continue;
    }

    if (!isBoosterClearOfWalls(walls, candidate)) {
      continue;
    }

    if (!hasObstacleSpace(footprint, obstacleFootprints, Math.max(36, obstacleGap - 18))) {
      continue;
    }

    if (
      baseRouteIsOpen &&
      !hasOpenRoute(walls, path, [...pins, ...bumpers, ...exploders], [...boosters, candidate])
    ) {
      continue;
    }

    obstacleFootprints.push(footprint);
    boosters.push(candidate);
    return;
  }

  const fallbackNodes = path
    .slice(2, -4)
    .filter((node) => node.y >= minY && node.y <= maxY)
    .sort(
      (a, b) =>
        getPathBandAtY(path, b.y).width - getPathBandAtY(path, a.y).width
    );

  for (const node of fallbackNodes) {
    const band = getPathBandAtY(path, node.y);

    if (band.width < 108) {
      continue;
    }

    const length = clamp(Math.min(36, band.width * 0.28), 28, 36);
    const halfLength = length / 2;
    const candidate = {
      id: "boost-required-0",
      x1: band.x - halfLength,
      y1: node.y + 9,
      x2: band.x + halfLength,
      y2: node.y - 9,
      strength: 7.5,
    };
    const footprint = getBoosterFootprint(candidate);

    if (!isSegmentInsidePath(path, candidate, 12)) {
      continue;
    }

    if (segmentBlocksFinishDropLane(path, candidate, 8)) {
      continue;
    }

    if (!isBoosterClearOfWalls(walls, candidate)) {
      continue;
    }

    if (!hasObstacleSpace(footprint, obstacleFootprints, Math.max(24, obstacleGap - 32))) {
      continue;
    }

    if (
      baseRouteIsOpen &&
      !hasOpenRoute(walls, path, [...pins, ...bumpers, ...exploders], [...boosters, candidate])
    ) {
      continue;
    }

    obstacleFootprints.push(footprint);
    boosters.push(candidate);
    return;
  }
}

function ensureRequiredBoosterAfterPrune(
  walls: Segment[],
  path: PathNode[],
  obstacles: RouteObstacles
): RouteObstacles {
  if (obstacles.boosters.length > 0) {
    return obstacles;
  }

  const boardHeight = getPathBoardHeight(path);
  const minY = path[1].y + 116;
  const maxY = getFinishClearStartY(boardHeight) - 190;
  const baseRouteIsOpen = routeIsOpen(walls, path, obstacles);
  const fallbackNodes = path
    .slice(2, -4)
    .filter((node) => node.y >= minY && node.y <= maxY)
    .sort(
      (a, b) =>
        getPathBandAtY(path, b.y).width - getPathBandAtY(path, a.y).width
    );

  for (const node of fallbackNodes) {
    const band = getPathBandAtY(path, node.y);

    if (band.width < 104) {
      continue;
    }

    const preferredLength = clamp(Math.min(34, band.width * 0.26), 26, 34);
    const lengthOptions = [preferredLength, 30, 26, 22, 18, 14, 10];
    const tiltOptions = [8, 5, 2, 0];

    for (const length of lengthOptions) {
      const halfLength = length / 2;

      for (const tilt of tiltOptions) {
        const candidate = {
          id: "boost-required-0",
          x1: band.x - halfLength,
          y1: node.y + tilt,
          x2: band.x + halfLength,
          y2: node.y - tilt,
          strength: 7.5,
        };
        const footprint = getBoosterFootprint(candidate);

        if (!isSegmentInsidePath(path, candidate, 12)) {
          continue;
        }

        if (segmentBlocksFinishDropLane(path, candidate, 8)) {
          continue;
        }

        if (!isBoosterClearOfWalls(walls, candidate)) {
          continue;
        }

        const gap = 16;
        const circleIsClear = (circle: CircleObstacle) =>
          Math.hypot(circle.x - footprint.x, circle.y - footprint.y) >=
          footprint.radius + circle.radius + gap;
        const next = {
          pins: obstacles.pins.filter(circleIsClear),
          bumpers: obstacles.bumpers.filter(circleIsClear),
          exploders: obstacles.exploders.filter(circleIsClear),
          boosters: [candidate],
        };

        if (baseRouteIsOpen && !routeIsOpen(walls, path, next)) {
          continue;
        }

        return next;
      }
    }
  }

  return obstacles;
}

function addFinishSideBoosters(
  path: PathNode[],
  walls: Segment[],
  pins: CircleObstacle[],
  bumpers: CircleObstacle[],
  exploders: CircleObstacle[],
  boosters: Booster[],
  obstacleFootprints: ObstacleFootprint[],
  level: number,
  obstacleGap: number
) {
  if (level < 4) {
    return;
  }

  const boardHeight = getPathBoardHeight(path);
  const finishLineY = getFinishLineY(boardHeight);
  const finishClearStartY = getFinishClearStartY(boardHeight);
  const yTargets = [finishLineY - 220];
  const baseRouteIsOpen = hasOpenRoute(
    walls,
    path,
    [...pins, ...bumpers, ...exploders],
    boosters
  );

  for (let pairIndex = 0; pairIndex < yTargets.length; pairIndex += 1) {
    const targetY = clamp(
      yTargets[pairIndex],
      finishClearStartY + 44,
      finishLineY - 118
    );

    for (const side of [-1, 1]) {
      const sideName = side < 0 ? "left" : "right";
      let added = false;

      for (const yOffset of [0, -34, 34, -62, 62]) {
        const centerY = clamp(
          targetY + yOffset,
          finishClearStartY + 34,
          finishLineY - 96
        );
        const band = getPathBandAtY(path, centerY);

        if (band.width < 112) {
          continue;
        }

        const lengthOptions = [24, 20, 16, 12, 10, 8, 6];
        const tiltOptions = [7, 5, 3, 2];
        const offsetOptions = [
          clamp(band.width * 0.27, 36, 48),
          clamp(band.width * 0.25, 34, 44),
          clamp(band.width * 0.23, 32, 42),
          42,
          40,
          38,
          36,
          34,
          32,
          30,
        ];

        for (const length of lengthOptions) {
          const halfLength = length / 2;

          for (const tilt of tiltOptions) {
            for (const offset of offsetOptions) {
              const centerX = band.x + side * offset;
              const candidate = {
                id: `boost-finish-side-${pairIndex}-${sideName}`,
                x1: centerX - halfLength,
                y1: centerY + tilt,
                x2: centerX + halfLength,
                y2: centerY - tilt,
                strength: 7.5 + (level - 4) * 0.7,
              };
              const footprint = getBoosterFootprint(candidate);
              const sweepRadius =
                Math.hypot(candidate.x2 - candidate.x1, candidate.y2 - candidate.y1) / 2;

              if (
                Math.abs(footprint.x - band.x) <=
                sweepRadius + FINISH_DROP_CLEARANCE + 6
              ) {
                continue;
              }

              if (!isSegmentInsidePath(path, candidate, 12)) {
                continue;
              }

              if (segmentBlocksFinishDropLane(path, candidate, 8)) {
                continue;
              }

              if (!isBoosterClearOfWalls(walls, candidate, BALL_RADIUS + 20)) {
                continue;
              }

              if (!hasObstacleSpace(footprint, obstacleFootprints, Math.max(8, obstacleGap - 44))) {
                continue;
              }

              if (
                baseRouteIsOpen &&
                !hasOpenRoute(walls, path, [...pins, ...bumpers, ...exploders], [...boosters, candidate])
              ) {
                continue;
              }

              obstacleFootprints.push(footprint);
              boosters.push(candidate);
              added = true;
              break;
            }

            if (added) {
              break;
            }
          }

          if (added) {
            break;
          }
        }

        if (added) {
          break;
        }
      }
    }
  }
}

function ensureFinishSideBoostersAfterPrune(
  walls: Segment[],
  path: PathNode[],
  obstacles: RouteObstacles,
  level: number
): RouteObstacles {
  if (level < 4) {
    return obstacles;
  }

  const boardHeight = getPathBoardHeight(path);
  const finishLineY = getFinishLineY(boardHeight);
  const finishClearStartY = getFinishClearStartY(boardHeight);
  let next = obstacles;

  const findCandidate = (side: -1 | 1, sideName: string) => {
    const baseRouteIsOpen = routeIsOpen(walls, path, next);
    const targetY = clamp(
      finishLineY - 220,
      finishClearStartY + 44,
      finishLineY - 118
    );

    for (const yOffset of [
      0,
      -20,
      20,
      -34,
      34,
      -48,
      48,
      -62,
      62,
      -76,
      76,
      -90,
      90,
      -104,
      104,
      -118,
      118,
      -132,
      132,
      -146,
      146,
      -160,
      160,
      -174,
      174,
    ]) {
      const centerY = clamp(
        targetY + yOffset,
        finishClearStartY + 8,
        finishLineY - 48
      );
      const band = getPathBandAtY(path, centerY);

      if (band.width < 68) {
        continue;
      }

      const lengthOptions = [24, 20, 16, 12, 10, 8, 6, 4, 2];
      const tiltOptions = [7, 5, 4, 3, 2, 1];
      const offsetOptions = [
        clamp(band.width * 0.31, 38, 56),
        clamp(band.width * 0.29, 36, 52),
        clamp(band.width * 0.27, 34, 50),
        clamp(band.width * 0.25, 32, 46),
        clamp(band.width * 0.23, 28, 42),
        56,
        54,
        52,
        50,
        48,
        46,
        44,
        42,
        40,
        38,
        36,
        34,
        32,
        30,
        28,
        26,
        24,
        22,
        20,
      ];

      for (const length of lengthOptions) {
        const halfLength = length / 2;

        for (const tilt of tiltOptions) {
          for (const offset of offsetOptions) {
            const centerX = band.x + side * offset;
            const candidate = {
              id: `boost-finish-side-final-${sideName}`,
              x1: centerX - halfLength,
              y1: centerY + tilt,
              x2: centerX + halfLength,
              y2: centerY - tilt,
              strength: 7.5 + (level - 4) * 0.7,
            };
            const footprint = getBoosterFootprint(candidate);
            const sweepRadius =
              Math.hypot(candidate.x2 - candidate.x1, candidate.y2 - candidate.y1) / 2;

            if (
              Math.abs(footprint.x - band.x) <=
              sweepRadius + FINISH_DROP_CLEARANCE + 6
            ) {
              continue;
            }

            if (!isSegmentInsidePath(path, candidate, 8)) {
              continue;
            }

            if (segmentBlocksFinishDropLane(path, candidate, 8)) {
              continue;
            }

            if (!isBoosterClearOfWalls(walls, candidate, BALL_RADIUS + 20)) {
              continue;
            }

            const gap = 8;
            const circleIsClear = (circle: CircleObstacle) =>
              Math.hypot(circle.x - footprint.x, circle.y - footprint.y) >=
              footprint.radius + circle.radius + gap;
            const candidateObstacles = {
              pins: next.pins.filter(circleIsClear),
              bumpers: next.bumpers.filter(circleIsClear),
              exploders: next.exploders.filter(circleIsClear),
              boosters: [...next.boosters, candidate],
            };

            if (baseRouteIsOpen && !routeIsOpen(walls, path, candidateObstacles)) {
              continue;
            }

            return candidateObstacles;
          }
        }
      }
    }

    return next;
  };

  for (const [side, sideName] of [
    [-1, "left"],
    [1, "right"],
  ] as const) {
    if (next.boosters.some((booster) => booster.id.includes(`-${sideName}`))) {
      continue;
    }

    next = findCandidate(side, sideName);
  }

  return next;
}

function addZigzagDeflectorPins(
  path: PathNode[],
  walls: Segment[],
  pins: CircleObstacle[],
  bumpers: CircleObstacle[],
  exploders: CircleObstacle[],
  boosters: Booster[],
  obstacleFootprints: ObstacleFootprint[],
  rng: () => number,
  level: number,
  obstacleGap: number
) {
  const boardHeight = getPathBoardHeight(path);
  const maxY = getFinishClearStartY(boardHeight) - 160;
  const deflectorCount = level >= 3 ? 2 : 1;
  const existingRouteIsOpen = hasOpenRoute(
    walls,
    path,
    [...pins, ...bumpers, ...exploders],
    boosters
  );

  const tryAddDeflector = (index: number, y: number) => {
    const band = getPathBandAtY(path, y);

    if (band.width < 118) {
      return false;
    }

    const candidate = {
      id: `pin-zigzag-deflector-${index}`,
      x:
        index === 0
          ? constrainXToPath(
              path,
              y,
              BOARD_WIDTH / 2,
              4.4 + BALL_RADIUS + 10
            )
          : band.x,
      y,
      radius: 4.4,
      strength: 0,
    };
    const footprint = {
      x: candidate.x,
      y: candidate.y,
      radius: 16,
    };

    if (!isPointInsidePath(path, candidate, candidate.radius + BALL_RADIUS + 10)) {
      return false;
    }

    if (blocksFinishDropLane(path, candidate, candidate.radius)) {
      return false;
    }

    if (!isCircleClearOfWalls(walls, candidate, WALL_TRAP_CLEARANCE)) {
      return false;
    }

    if (!hasObstacleSpace(footprint, obstacleFootprints, Math.max(36, obstacleGap - 18))) {
      return false;
    }

    if (
      existingRouteIsOpen &&
      !hasOpenRoute(walls, path, [...pins, ...bumpers, ...exploders, candidate], boosters)
    ) {
      return false;
    }

    obstacleFootprints.push(footprint);
    pins.push(candidate);

    return true;
  };

  for (let index = 0; index < deflectorCount; index += 1) {
    const targetProgress = deflectorCount === 1 ? 0.42 : 0.32 + index * 0.23;
    let added = false;

    for (let attempt = 0; attempt < 24; attempt += 1) {
      const progress = clamp(
        targetProgress + randomRange(rng, -0.04, 0.04) + (attempt % 5 - 2) * 0.018,
        0.18,
        0.72
      );
      const pathIndex = clamp(
        Math.round(progress * (path.length - 1)),
        2,
        path.length - 4
      );
      const node = path[pathIndex];

      if (!node) {
        continue;
      }

      const y = clamp(
        node.y + randomRange(rng, -26, 42),
        path[1].y + 70,
        maxY
      );

      if (tryAddDeflector(index, y)) {
        added = true;
        break;
      }
    }

    if (added) {
      continue;
    }

    const fallback = path
      .slice(2, -4)
      .filter((node) => node.y > path[1].y + 70 && node.y < maxY)
      .sort((a, b) => b.width - a.width)
      .find((node) => tryAddDeflector(index, node.y));

    if (!fallback) {
      break;
    }
  }
}

function addRouteDeflectorPins(
  path: PathNode[],
  walls: Segment[],
  pins: CircleObstacle[],
  bumpers: CircleObstacle[],
  exploders: CircleObstacle[],
  boosters: Booster[],
  obstacleFootprints: ObstacleFootprint[],
  rng: () => number,
  level: number,
  obstacleGap: number,
  structure: GeneratedStructureKind
) {
  const boardHeight = getPathBoardHeight(path);
  const maxY = getFinishClearStartY(boardHeight) - 170;
  const deflectorCount = level >= 4 ? 3 : 2;
  const existingRouteIsOpen = hasOpenRoute(
    walls,
    path,
    [...pins, ...bumpers, ...exploders],
    boosters
  );

  const tryAddDeflector = (index: number, y: number) => {
    const band = getPathBandAtY(path, y);

    if (band.width < 118) {
      return false;
    }

    const offsetDirection = index % 2 === 0 ? -1 : 1;
    const structureOffset =
      index === 0 || structure === "funnel"
        ? 0
        : offsetDirection * clamp(band.width * 0.08, 8, 14);
    const targetX =
      index === 0
        ? constrainXToPath(
            path,
            y,
            BOARD_WIDTH / 2,
            4.5 + BALL_RADIUS + 10
          )
        : band.x + structureOffset;
    const candidate = {
      id: `pin-route-deflector-${index}`,
      x: targetX,
      y,
      radius: 4.5,
      strength: 0,
    };
    const footprint = {
      x: candidate.x,
      y: candidate.y,
      radius: 16,
    };

    if (!isPointInsidePath(path, candidate, candidate.radius + BALL_RADIUS + 10)) {
      return false;
    }

    if (blocksFinishDropLane(path, candidate, candidate.radius)) {
      return false;
    }

    if (!isCircleClearOfWalls(walls, candidate, WALL_TRAP_CLEARANCE)) {
      return false;
    }

    if (!hasObstacleSpace(footprint, obstacleFootprints, Math.max(34, obstacleGap - 20))) {
      return false;
    }

    if (
      existingRouteIsOpen &&
      !hasOpenRoute(walls, path, [...pins, ...bumpers, ...exploders, candidate], boosters)
    ) {
      return false;
    }

    obstacleFootprints.push(footprint);
    pins.push(candidate);

    return true;
  };

  for (let index = 0; index < deflectorCount; index += 1) {
    const targetProgress = deflectorCount === 1 ? 0.38 : 0.3 + index * 0.24;
    let added = false;

    for (let attempt = 0; attempt < 28; attempt += 1) {
      const progress = clamp(
        targetProgress + randomRange(rng, -0.045, 0.045) + (attempt % 5 - 2) * 0.016,
        0.18,
        0.72
      );
      const pathIndex = clamp(
        Math.round(progress * (path.length - 1)),
        2,
        path.length - 4
      );
      const node = path[pathIndex];

      if (!node) {
        continue;
      }

      const y = clamp(
        node.y + randomRange(rng, -28, 42),
        path[1].y + 74,
        maxY
      );

      if (tryAddDeflector(index, y)) {
        added = true;
        break;
      }
    }

    if (added) {
      continue;
    }

    const fallback = path
      .slice(2, -4)
      .filter((node) => node.y > path[1].y + 74 && node.y < maxY)
      .sort((a, b) => b.width - a.width)
      .find((node) => tryAddDeflector(index, node.y));

    if (!fallback) {
      break;
    }
  }
}

function addSplitIsland(
  walls: Segment[],
  path: PathNode[],
  rng: () => number,
  id: string,
  startIndex: number
) {
  const startNode = path[startIndex];
  const endNode = path[startIndex + 2];

  if (!startNode || !endNode) {
    return null;
  }

  const side = rng() > 0.5 ? -1 : 1;
  const startY = startNode.y + randomRange(rng, 28, 52);
  const endY = endNode.y - randomRange(rng, 28, 56);

  if (endY - startY < 96) {
    return null;
  }

  const midY = (startY + endY) / 2 + randomRange(rng, -18, 18);
  const startBand = getPathBandAtY(path, startY);
  const midBand = getPathBandAtY(path, midY);
  const endBand = getPathBandAtY(path, endY);
  const startPoint = {
    x: constrainXToPath(
      path,
      startY,
      startBand.x + side * randomRange(rng, 4, 12),
      MIN_BRANCH_LANE_WIDTH
    ),
    y: startY,
  };
  const shoulderPoint = {
    x: constrainXToPath(
      path,
      midY,
      midBand.x - side * randomRange(rng, 24, 36),
      MIN_BRANCH_LANE_WIDTH
    ),
    y: midY,
  };
  const endPoint = {
    x: constrainXToPath(
      path,
      endY,
      endBand.x + side * randomRange(rng, 4, 12),
      MIN_BRANCH_LANE_WIDTH
    ),
    y: endY,
  };
  const segments = [
    { x1: startPoint.x, y1: startPoint.y, x2: shoulderPoint.x, y2: shoulderPoint.y },
    { x1: shoulderPoint.x, y1: shoulderPoint.y, x2: endPoint.x, y2: endPoint.y },
    { x1: endPoint.x, y1: endPoint.y, x2: startPoint.x, y2: startPoint.y },
  ];

  if (!segments.every((segment) => isSegmentInsidePath(path, segment, 18))) {
    return null;
  }

  if (!hasBranchLaneClearance(path, segments)) {
    return null;
  }

  segments.forEach((segment, segmentIndex) => {
    addWall(
      walls,
      `${id}-${segmentIndex}`,
      segment.x1,
      segment.y1,
      segment.x2,
      segment.y2,
      0.82
    );
  });

  return {
    x: (startPoint.x + shoulderPoint.x + endPoint.x) / 3,
    y: (startPoint.y + shoulderPoint.y + endPoint.y) / 3,
    radius: Math.max(
      44,
      Math.hypot(shoulderPoint.x - startPoint.x, shoulderPoint.y - startPoint.y) * 0.28
    ),
  };
}

function addFinishGauntlet(
  walls: Segment[],
  path: PathNode[],
  boardHeight: number
) {
  const topY = boardHeight - 300;
  const neckY = boardHeight - 92;
  const topBand = getPathBandAtY(path, topY);
  const neckBand = getPathBandAtY(path, neckY);
  const topOpening = clamp(topBand.width * 0.52, 72, 94);
  const neckOpening = 56;
  const guides = [
    {
      id: "finish-guide-left",
      x1: topBand.x - topOpening,
      y1: topY,
      x2: neckBand.x - neckOpening,
      y2: neckY,
    },
    {
      id: "finish-guide-right",
      x1: topBand.x + topOpening,
      y1: topY,
      x2: neckBand.x + neckOpening,
      y2: neckY,
    },
  ];

  for (const guide of guides) {
    if (
      isSegmentInsidePath(path, guide, 12) &&
      !segmentBlocksFinishDropLane(path, guide, 8)
    ) {
      addWall(
        walls,
        guide.id,
        guide.x1,
        guide.y1,
        guide.x2,
        guide.y2,
        0.58
      );
    }
  }
}

function getRotatingBoosterSegment(
  booster: Booster,
  elapsedSeconds: number
): Pick<Segment, "x1" | "y1" | "x2" | "y2"> {
  const cx = (booster.x1 + booster.x2) / 2;
  const cy = (booster.y1 + booster.y2) / 2;
  const dx = booster.x2 - booster.x1;
  const dy = booster.y2 - booster.y1;
  const halfLength = Math.hypot(dx, dy) / 2;
  const baseAngle = Math.atan2(dy, dx);
  const clockwiseAngle = baseAngle + elapsedSeconds * 2.4;
  const offsetX = Math.cos(clockwiseAngle) * halfLength;
  const offsetY = Math.sin(clockwiseAngle) * halfLength;

  return {
    x1: cx - offsetX,
    y1: cy - offsetY,
    x2: cx + offsetX,
    y2: cy + offsetY,
  };
}

function generateMap(
  seed: number,
  complexity: number,
  structureChoice: StructureChoice
): MapLayout {
  const rng = createRng(seed);
  const level = clamp(Math.round(complexity), 1, 5);
  const structure = pickStructure(rng, structureChoice);
  const walls: Segment[] = [];
  const pins: CircleObstacle[] = [];
  const bumpers: CircleObstacle[] = [];
  const exploders: CircleObstacle[] = [];
  const boosters: Booster[] = [];
  const obstacleFootprints: ObstacleFootprint[] = [];
  const centerX = BOARD_WIDTH / 2;
  const boardHeight = getGeneratedBoardHeight(level);
  const topY = 72;
  const bottomY = boardHeight - 132;
  const complexityCurve = (level - 1) / 4;
  const pointCount = level * 4 + 8;
  const baseWidth =
    structure === "funnel"
      ? 144
      : structure === "chambers"
        ? 122
        : structure === "split"
          ? 158
          : structure === "cascade"
            ? 132
            : 136;
  const baseBendStrength =
    structure === "zigzag"
      ? 94
      : structure === "chaos"
        ? 106
        : structure === "chambers"
          ? 78
          : 68;
  const bendStrength = baseBendStrength * (0.92 + complexityCurve * 0.42);
  const waveFrequency =
    (structure === "cascade" ? 5.1 : structure === "zigzag" ? 4.2 : 3.5) +
    complexityCurve * (structure === "funnel" ? 1.4 : 2.25);
  const pathHorizontalStep =
    MAX_PATH_HORIZONTAL_STEP +
    (MAX_HIGH_COMPLEXITY_PATH_STEP - MAX_PATH_HORIZONTAL_STEP) *
      complexityCurve;
  const obstacleGap = getObstacleGap(level);
  const previousXWeight = 0.38 - complexityCurve * 0.18;
  const targetXWeight = 1 - previousXWeight;
  const path: PathNode[] = [];

  for (let index = 0; index < pointCount; index += 1) {
    const progress = index / (pointCount - 1);
    const y =
      topY +
      progress * (bottomY - topY) +
      (index === 0 || index === pointCount - 1 ? 0 : randomRange(rng, -22, 28));
    const previousX = path[index - 1]?.x ?? centerX;
    const endEase =
      progress < 0.08
        ? progress / 0.08
        : progress > 0.9
          ? (1 - progress) / 0.1
          : 1;
    const curveEnvelope = clamp(endEase, 0.36, 1);
    const wave =
      Math.sin(progress * Math.PI * waveFrequency + seed * 0.003) *
      bendStrength *
      (0.34 + complexityCurve * 0.16) *
      curveEnvelope;
    const turnWave =
      Math.sin(
        index *
          (structure === "zigzag"
            ? Math.PI
            : Math.PI * (0.72 + complexityCurve * 0.16)) +
          seed * 0.017
      ) *
      bendStrength *
      complexityCurve *
      0.34 *
      curveEnvelope;
    const directed =
      structure === "zigzag"
        ? (index % 2 === 0 ? -1 : 1) * bendStrength
        : structure === "cascade"
          ? (index % 3 === 0 ? -1 : 1) * bendStrength * 0.62 + turnWave * 0.45
          : randomRange(rng, -bendStrength, bendStrength) + turnWave;
    const width =
      structure === "funnel"
        ? clamp(
            baseWidth - progress * 30 + complexityCurve * 10 + randomRange(rng, -8, 14),
            108,
            164
          )
        : structure === "split"
          ? clamp(baseWidth + complexityCurve * 10 + randomRange(rng, -14, 22), 144, 196)
        : clamp(baseWidth + complexityCurve * 8 + randomRange(rng, -18, 20), 112, 176);
    const leftBound = 48 + width / 2;
    const rightBound = BOARD_WIDTH - 48 - width / 2;
    const targetX = clamp(
      previousX * previousXWeight + (centerX + wave + directed) * targetXWeight,
      leftBound,
      rightBound
    );
    const stepLeftBound = Math.max(leftBound, previousX - pathHorizontalStep);
    const stepRightBound = Math.min(rightBound, previousX + pathHorizontalStep);
    const x =
      stepLeftBound <= stepRightBound
        ? clamp(targetX, stepLeftBound, stepRightBound)
        : targetX;

    path.push({ x, y, width });
  }

  path[0] = { ...path[0], x: centerX, y: topY, width: 138 };
  path[path.length - 1] = {
    ...path[path.length - 1],
    x: centerX,
    y: bottomY,
    width: 150,
  };

  for (let index = 0; index < path.length - 1; index += 1) {
    const current = path[index];
    const next = path[index + 1];
    const leftCurrent = current.x - current.width / 2;
    const rightCurrent = current.x + current.width / 2;
    const leftNext = next.x - next.width / 2;
    const rightNext = next.x + next.width / 2;

    addWall(
      walls,
      `path-left-${index}`,
      leftCurrent,
      current.y,
      leftNext,
      next.y,
      0.86
    );
    addWall(
      walls,
      `path-right-${index}`,
      rightCurrent,
      current.y,
      rightNext,
      next.y,
      0.86
    );

  }

  const splitIslandCount =
    level <= 1
      ? 0
      : structure === "split"
        ? Math.max(1, Math.floor(level / 2))
        : level <= 2
          ? 0
          : structure === "chaos"
            ? Math.max(1, Math.floor(level / 2))
            : structure === "chambers"
              ? Math.max(1, Math.floor(level / 3))
              : 0;
  const usedSplitRanges: number[] = [];

  for (let splitIndex = 0; splitIndex < splitIslandCount; splitIndex += 1) {
    for (let attempt = 0; attempt < 18; attempt += 1) {
      const startIndex = 1 + Math.floor(randomRange(rng, 0, path.length - 4));

      if (usedSplitRanges.some((usedIndex) => Math.abs(usedIndex - startIndex) < 3)) {
        continue;
      }

      const footprint = addSplitIsland(
        walls,
        path,
        rng,
        `split-island-${splitIndex}`,
        startIndex
      );

      if (!footprint) {
        continue;
      }

      usedSplitRanges.push(startIndex);
      obstacleFootprints.push(footprint);
      break;
    }
  }

  addFinishGauntlet(
    walls,
    path,
    boardHeight
  );

  if (structure === "zigzag") {
    addZigzagDeflectorPins(
      path,
      walls,
      pins,
      bumpers,
      exploders,
      boosters,
      obstacleFootprints,
      rng,
      level,
      obstacleGap
    );
  } else {
    addRouteDeflectorPins(
      path,
      walls,
      pins,
      bumpers,
      exploders,
      boosters,
      obstacleFootprints,
      rng,
      level,
      obstacleGap,
      structure
    );
  }

  addRequiredBooster(
    path,
    walls,
    pins,
    bumpers,
    exploders,
    boosters,
    obstacleFootprints,
    rng,
    level,
    obstacleGap
  );

  addFinishSideBoosters(
    path,
    walls,
    pins,
    bumpers,
    exploders,
    boosters,
    obstacleFootprints,
    level,
    obstacleGap
  );

  const pinClusterCount = level + (level >= 4 ? 1 : 0);
  for (let cluster = 0; cluster < pinClusterCount; cluster += 1) {
    for (let attempt = 0; attempt < 34; attempt += 1) {
      const point = pickDistributedPathPoint(
        path,
        cluster,
        pinClusterCount,
        attempt,
        2,
        path.length - 4
      );
      const columns = 2 + (level >= 3 && rng() > 0.28 ? 1 : 0);
      const rows = 2;
      const pinSpacing = level >= 4 ? 38 : 36;
      const clusterY = point.y + randomRange(rng, 42, 76);
      const clusterBand = getPathBandAtY(path, clusterY);

      if (clusterBand.width < 132 + level * 2) {
        continue;
      }

      const clusterX = constrainXToPath(
        path,
        clusterY + ((rows - 1) * pinSpacing) / 2,
        point.x + randomRange(rng, -24, 24),
        ((columns - 1) * pinSpacing) / 2 + BALL_RADIUS + 20
      );
      const footprint = {
        x: clusterX,
        y: clusterY + ((rows - 1) * pinSpacing) / 2,
        radius:
          Math.max((columns - 1) * pinSpacing, (rows - 1) * pinSpacing) / 2 +
          28,
      };

      if (!hasObstacleSpace(footprint, obstacleFootprints, obstacleGap)) {
        continue;
      }

      const nextPins = Array.from({ length: rows * columns }, (_, cellIndex) => {
        const row = Math.floor(cellIndex / columns);
        const col = cellIndex % columns;

        return {
          id: `pin-${cluster}-${row}-${col}`,
          x: clamp(
            clusterX +
              (col - (columns - 1) / 2) * pinSpacing +
              randomRange(rng, -3, 3),
            70,
            BOARD_WIDTH - 70
          ),
          y: clusterY + row * pinSpacing,
          radius: 3.8,
          strength: 0,
        };
      });

      if (
        !nextPins.every((pin) =>
          isPointInsidePath(
            path,
            { x: pin.x, y: pin.y },
            pin.radius + BALL_RADIUS + 8
          )
        )
      ) {
        continue;
      }

      if (!nextPins.every((pin) => isCircleClearOfWalls(walls, pin, WALL_TRAP_CLEARANCE))) {
        continue;
      }

      if (!hasOpenRoute(walls, path, [...pins, ...bumpers, ...exploders, ...nextPins], boosters)) {
        continue;
      }

      obstacleFootprints.push(footprint);
      pins.push(...nextPins);

      break;
    }
  }

  const bumperCount = Math.max(1, level - 1);
  for (let i = 0; i < bumperCount; i += 1) {
    for (let attempt = 0; attempt < 34; attempt += 1) {
      const point = pickDistributedPathPoint(
        path,
        i,
        bumperCount,
        attempt,
        2,
        path.length - 4
      );
      const radius = randomRange(rng, 16, 22);
      const y = point.y + randomRange(rng, 30, 88);
      const candidate = {
        id: `bumper-${i}`,
        x: constrainXToPath(
          path,
          y,
          point.x + randomRange(rng, -42, 42),
          radius + ROUTE_CLEARANCE + 8
        ),
        y,
        radius,
        strength: randomRange(rng, 8, 11),
      };
      const footprint = {
        x: candidate.x,
        y: candidate.y,
        radius: candidate.radius + 16,
      };

      if (!hasObstacleSpace(footprint, obstacleFootprints, obstacleGap)) {
        continue;
      }

      if (!isCircleClearOfWalls(walls, candidate, BUMPER_WALL_CLEARANCE)) {
        continue;
      }

      if (!hasBumperLaneSpace(candidate, bumpers)) {
        continue;
      }

      if (!hasOpenRoute(walls, path, [...pins, ...bumpers, ...exploders, candidate], boosters)) {
        continue;
      }

      obstacleFootprints.push(footprint);
      bumpers.push(candidate);
      break;
    }
  }

  const exploderCount = Math.max(1, Math.floor((level + 1) / 2));
  for (let i = 0; i < exploderCount; i += 1) {
    for (let attempt = 0; attempt < 34; attempt += 1) {
      const point = pickDistributedPathPoint(
        path,
        i,
        exploderCount,
        attempt,
        3,
        path.length - 5
      );
      const radius = randomRange(rng, 14, 19);
      const y = point.y + randomRange(rng, 24, 82);
      const candidate = {
        id: `blast-${i}`,
        x: constrainXToPath(
          path,
          y,
          point.x + randomRange(rng, -34, 34),
          radius + ROUTE_CLEARANCE + 8
        ),
        y,
        radius,
        strength: randomRange(rng, 9, 13),
      };
      const footprint = {
        x: candidate.x,
        y: candidate.y,
        radius: candidate.radius + 16,
      };

      if (!hasObstacleSpace(footprint, obstacleFootprints, obstacleGap)) {
        continue;
      }

      if (!isCircleClearOfWalls(walls, candidate, WALL_TRAP_CLEARANCE)) {
        continue;
      }

      if (!hasOpenRoute(walls, path, [...pins, ...bumpers, ...exploders, candidate], boosters)) {
        continue;
      }

      obstacleFootprints.push(footprint);
      exploders.push(candidate);
      break;
    }
  }

  const boosterCount = Math.max(2, level);
  for (let i = 0; i < boosterCount; i += 1) {
    for (let attempt = 0; attempt < 34; attempt += 1) {
      const point = pickDistributedPathPoint(
        path,
        i,
        boosterCount,
        attempt,
        2,
        path.length - 3
      );
      const length = randomRange(rng, 34, 52);
      const centerY = point.y + randomRange(rng, 42, 108);
      const tilt = randomRange(rng, -12, 12);
      const halfLength = length / 2;
      const centerX = constrainXToPath(
        path,
        centerY,
        point.x + randomRange(rng, -34, 34),
        halfLength + 24
      );
      const candidate = {
        id: `boost-${i}`,
        x1: centerX - halfLength,
        y1: centerY + 12,
        x2: centerX + halfLength,
        y2: centerY - 12 + tilt,
        strength: randomRange(rng, 7, 10),
      };
      const footprint = {
        x: (candidate.x1 + candidate.x2) / 2,
        y: (candidate.y1 + candidate.y2) / 2,
        radius: Math.hypot(candidate.x2 - candidate.x1, candidate.y2 - candidate.y1) / 2 + 18,
      };

      if (!isSegmentInsidePath(path, candidate, 16)) {
        continue;
      }

      if (!isBoosterClearOfWalls(walls, candidate)) {
        continue;
      }

      if (!hasObstacleSpace(footprint, obstacleFootprints, obstacleGap)) {
        continue;
      }

      if (!hasOpenRoute(walls, path, [...pins, ...bumpers, ...exploders], [...boosters, candidate])) {
        continue;
      }

      obstacleFootprints.push(footprint);
      boosters.push(candidate);
      break;
    }
  }

  const scatterPinCount = Math.max(0, level * 2 - 2);
  for (let i = 0; i < scatterPinCount; i += 1) {
    for (let attempt = 0; attempt < 28; attempt += 1) {
      const point = pickDistributedPathPoint(
        path,
        i,
        scatterPinCount,
        attempt,
        2,
        path.length - 4
      );
      const y = point.y + randomRange(rng, 26, 92);
      const radius = 3.6;
      const candidate = {
        id: `pin-scatter-${i}`,
        x: constrainXToPath(
          path,
          y,
          point.x + randomRange(rng, -44, 44),
          radius + BALL_RADIUS + 12
        ),
        y,
        radius,
        strength: 0,
      };
      const footprint = {
        x: candidate.x,
        y: candidate.y,
        radius: 14,
      };

      if (!isPointInsidePath(path, candidate, candidate.radius + BALL_RADIUS + 8)) {
        continue;
      }

      if (blocksFinishDropLane(path, candidate, candidate.radius)) {
        continue;
      }

      if (!isCircleClearOfWalls(walls, candidate, WALL_TRAP_CLEARANCE)) {
        continue;
      }

      if (!hasObstacleSpace(footprint, obstacleFootprints, obstacleGap)) {
        continue;
      }

      if (!hasOpenRoute(walls, path, [...pins, ...bumpers, ...exploders, candidate], boosters)) {
        continue;
      }

      obstacleFootprints.push(footprint);
      pins.push(candidate);
      break;
    }
  }

  const safeWalls = unblockMapWalls(walls, path);
  const laneSafePins = pins.filter(
    (pin) => !blocksFinishDropLane(path, pin, pin.radius)
  );
  const laneSafeBumpers = bumpers.filter(
    (bumper) => !blocksFinishDropLane(path, bumper, bumper.radius)
  );
  const laneSafeExploders = exploders.filter(
    (exploder) => !blocksFinishDropLane(path, exploder, exploder.radius)
  );
  const laneSafeBoosters = boosters.filter(
    (booster) => !segmentBlocksFinishDropLane(path, booster, 8)
  );
  const safeObstacles = makeObstaclesRouteSafe(safeWalls, path, {
    pins: laneSafePins,
    bumpers: laneSafeBumpers,
    exploders: laneSafeExploders,
    boosters: laneSafeBoosters,
  });
  const finishBlocksRoute = !hasOpenRoute(
    safeWalls,
    path,
    [...safeObstacles.pins, ...safeObstacles.bumpers, ...safeObstacles.exploders],
    safeObstacles.boosters
  );
  const safePins = finishBlocksRoute
    ? safeObstacles.pins.filter((pin) => !pin.id.startsWith("finish-pin-"))
    : safeObstacles.pins;
  const safeBumpers = finishBlocksRoute
    ? safeObstacles.bumpers.filter(
        (bumper) => !bumper.id.startsWith("finish-bumper-")
      )
    : safeObstacles.bumpers;
  const safeBoosters = finishBlocksRoute
    ? safeObstacles.boosters.filter(
        (booster) => !booster.id.startsWith("finish-kicker-")
      )
    : safeObstacles.boosters;
  const requiredObstacles = ensureRequiredBoosterAfterPrune(safeWalls, path, {
    pins: safePins,
    bumpers: safeBumpers,
    exploders: safeObstacles.exploders,
    boosters: safeBoosters,
  });
  const finalObstacles = ensureFinishSideBoostersAfterPrune(
    safeWalls,
    path,
    requiredObstacles,
    level
  );

  return {
    version: 1,
    seed,
    complexity: level,
    structure,
    height: boardHeight,
    path,
    walls: safeWalls,
    pins: finalObstacles.pins,
    bumpers: finalObstacles.bumpers,
    exploders: finalObstacles.exploders,
    boosters: finalObstacles.boosters,
  };
}

function parsePlayers(input: string): Player[] {
  return input
    .split(",")
    .map((part) => part.trim())
    .filter((name) => name.length > 0)
    .map((name, index) => ({
      id: index,
      name,
      color: BALL_COLORS[index % BALL_COLORS.length],
    }));
}

function createBalls(players: Player[], seed: number): Ball[] {
  const rng = createRng(seed ^ 0x9e3779b9);
  const shuffledPlayers = shuffleWithRng(players, rng);
  const startY = 56;
  const spread = players.length > 1 ? Math.min(100, 18 * (players.length - 1)) : 0;
  const step = players.length > 1 ? spread / (players.length - 1) : 0;
  const startX = BOARD_WIDTH / 2 - spread / 2;

  return shuffledPlayers.map((player, index) => ({
    id: `${player.id}-${seed}-${index}`,
    name: player.name,
    color: player.color,
    x: startX + step * index + randomRange(rng, -3, 3),
    y: startY,
    vx: randomRange(rng, -0.35, 0.35),
    vy: randomRange(rng, -0.1, 0.3),
    radius: BALL_RADIUS,
    finished: false,
    blastCooldown: 0,
    bumperCooldown: 0,
    bumperChain: 0,
    racePhase: randomRange(rng, 0, Math.PI * 2),
    raceSpeedBonus: 0,
    trail: [],
  }));
}

function normalizeLabel(label: string, max = 9) {
  if (label.length <= max) {
    return label;
  }

  return `${label.slice(0, max - 1)}…`;
}

function resolveSegmentCollision(
  ball: Ball,
  segment: Pick<Segment, "x1" | "y1" | "x2" | "y2">,
  bounce: number,
  padding = 4
) {
  const dx = segment.x2 - segment.x1;
  const dy = segment.y2 - segment.y1;
  const lengthSquared = dx * dx + dy * dy;

  if (lengthSquared <= 0.0001) {
    return false;
  }

  const t = clamp(
    ((ball.x - segment.x1) * dx + (ball.y - segment.y1) * dy) / lengthSquared,
    0,
    1
  );
  const px = segment.x1 + dx * t;
  const py = segment.y1 + dy * t;
  let nx = ball.x - px;
  let ny = ball.y - py;
  let distance = Math.hypot(nx, ny);
  const minimum = ball.radius + padding;

  if (distance >= minimum) {
    return false;
  }

  if (distance < 0.001) {
    nx = -dy;
    ny = dx;
    distance = Math.hypot(nx, ny);
  }

  nx /= distance;
  ny /= distance;
  const overlap = minimum - distance;

  ball.x += nx * overlap;
  ball.y += ny * overlap;

  const velocityDot = ball.vx * nx + ball.vy * ny;
  if (velocityDot < 0) {
    ball.vx -= (1 + bounce) * velocityDot * nx;
    ball.vy -= (1 + bounce) * velocityDot * ny;
  }

  ball.vx *= 0.996;
  ball.vy *= 0.996;
  return true;
}

function resolveCircleCollision(
  ball: Ball,
  obstacle: CircleObstacle,
  bounce: number,
  padding = 0
) {
  let nx = ball.x - obstacle.x;
  let ny = ball.y - obstacle.y;
  let distance = Math.hypot(nx, ny);
  const minimum = ball.radius + obstacle.radius + padding;

  if (distance >= minimum) {
    return false;
  }

  if (distance < 0.001) {
    nx = 0;
    ny = -1;
    distance = 1;
  }

  nx /= distance;
  ny /= distance;
  const overlap = minimum - distance;

  ball.x += nx * overlap;
  ball.y += ny * overlap;

  const velocityDot = ball.vx * nx + ball.vy * ny;
  if (velocityDot < 0) {
    ball.vx -= (1 + bounce) * velocityDot * nx;
    ball.vy -= (1 + bounce) * velocityDot * ny;
  }

  return true;
}

function addPulse(
  pulses: Pulse[],
  x: number,
  y: number,
  color: string,
  radius = 18,
  life = 24
) {
  pulses.push({ x, y, color, radius, life, maxLife: life });
}

function finishBall(
  ball: Ball,
  boardHeight: number,
  onFinish: (entry: RankingEntry) => void,
  pulses: Pulse[]
) {
  ball.finished = true;
  ball.y = boardHeight - 34;
  ball.vx = 0;
  ball.vy = 0;
  ball.trail = [];
  addPulse(pulses, ball.x, ball.y - 8, ball.color, 30, 30);
  onFinish({ id: ball.id, name: ball.name, color: ball.color });
}

function confineBallToPath(ball: Ball, path?: PathNode[]) {
  if (!path || path.length < 2 || ball.finished) {
    return;
  }

  const band = getPathBandAtY(path, ball.y);
  const margin = ball.radius + 8;
  const halfWidth = Math.max(12, band.width / 2 - margin);
  const minX = band.x - halfWidth;
  const maxX = band.x + halfWidth;

  if (ball.x < minX) {
    ball.x = minX;
    ball.vx = Math.abs(ball.vx) * 0.45;
  } else if (ball.x > maxX) {
    ball.x = maxX;
    ball.vx = -Math.abs(ball.vx) * 0.45;
  }
}

function applyRacePressure(
  balls: Ball[],
  dt: number,
  elapsedSeconds: number
) {
  for (const ball of balls) {
    ball.raceSpeedBonus = 0;
  }

  const activeBalls = balls
    .filter((ball) => !ball.finished)
    .sort((a, b) => b.y - a.y || a.x - b.x);

  if (activeBalls.length < 2) {
    return;
  }

  for (let rank = 0; rank < activeBalls.length; rank += 1) {
    const ball = activeBalls[rank];
    const gapToLeader = Math.max(0, activeBalls[0].y - ball.y);
    const gapBehind =
      rank < activeBalls.length - 1
        ? Math.max(0, ball.y - activeBalls[rank + 1].y)
        : RACE_LEADER_PRESSURE_GAP;
    const draftBoost =
      rank > 0
        ? clamp(gapToLeader / RACE_DRAFT_GAP, 0, 1) * RACE_DRAFT_ACCEL
        : 0;
    const catchupRatio = clamp(gapToLeader / RACE_DRAFT_GAP, 0, 1);
    const leaderDrag =
      rank === 0 && gapBehind < RACE_LEADER_PRESSURE_GAP
        ? (1 - gapBehind / RACE_LEADER_PRESSURE_GAP) * RACE_LEADER_DRAG
        : rank === 0
          ? clamp(gapBehind / (RACE_DRAFT_GAP * 2.4), 0, 1) *
            RACE_LEADER_BREAKAWAY_DRAG
          : 0;
    const swirl =
      Math.sin(elapsedSeconds * 3.7 + ball.racePhase + ball.y * 0.011) *
      RACE_SWIRL_ACCEL;
    const pulse =
      Math.sin(elapsedSeconds * 5.4 + ball.racePhase) * RACE_PULSE_ACCEL;
    const draftSpeedBonus =
      rank > 0
        ? catchupRatio * RACE_DRAFT_SPEED_BONUS
        : 0;
    const pulseSpeedBonus =
      ((pulse / RACE_PULSE_ACCEL + 1) / 2) * RACE_PULSE_SPEED_BONUS;

    ball.vy = Math.max(-0.2, ball.vy + (draftBoost - leaderDrag + pulse) * dt);
    if (rank > 0) {
      ball.vy = Math.max(
        ball.vy,
        catchupRatio * RACE_TRAILING_PROGRESS_FLOOR
      );
    }
    ball.raceSpeedBonus = draftSpeedBonus + pulseSpeedBonus;
    ball.vx += swirl * dt;
  }
}

function applyPathFlow(ball: Ball, path: PathNode[] | undefined, dt: number) {
  if (!path || path.length < 2 || ball.finished) {
    return;
  }

  const lookAheadY = ball.y + 42;
  const band = getPathBandAtY(path, lookAheadY);
  const offset = band.x - ball.x;

  if (Math.abs(offset) < 6) {
    return;
  }

  ball.vx += clamp(
    offset * PATH_FLOW_ACCEL,
    -PATH_FLOW_MAX_ACCEL,
    PATH_FLOW_MAX_ACCEL
  ) * dt;
}

function stepSimulation(
  balls: Ball[],
  map: MapLayout,
  dt: number,
  elapsedSeconds: number,
  onFinish: (entry: RankingEntry) => void,
  pulses: Pulse[]
) {
  const gravity = 0.18;
  const maxFallSpeed = 5.7;
  const maxRiseSpeed = -11.1;
  const maxSideSpeed = 8.4;
  const boardHeight = getBoardHeight(map);
  const finishLineY = getFinishLineY(boardHeight);

  applyRacePressure(balls, dt, elapsedSeconds);

  for (const ball of balls) {
    if (ball.finished) {
      continue;
    }

    ball.trail.push({ x: ball.x, y: ball.y });
    if (ball.trail.length > 12) {
      ball.trail.shift();
    }

    ball.vy += gravity * dt;
    const fallSpeedLimit = maxFallSpeed + ball.raceSpeedBonus;
    ball.vy = clamp(ball.vy, maxRiseSpeed, fallSpeedLimit);
    ball.vx = clamp(ball.vx, -maxSideSpeed, maxSideSpeed);
    applyPathFlow(ball, map.path, dt);
    ball.vx *= Math.pow(0.996, dt);
    ball.x += ball.vx * dt;
    ball.y += ball.vy * dt;
    confineBallToPath(ball, map.path);

    if (ball.x < 38 + ball.radius) {
      ball.x = 38 + ball.radius;
      ball.vx = Math.abs(ball.vx) * 0.78;
    }

    if (ball.x > BOARD_WIDTH - 38 - ball.radius) {
      ball.x = BOARD_WIDTH - 38 - ball.radius;
      ball.vx = -Math.abs(ball.vx) * 0.78;
    }

    if (ball.y < 22 + ball.radius) {
      ball.y = 22 + ball.radius;
      ball.vy = Math.abs(ball.vy) * 0.5;
    }

    let wallHit = false;
    for (const wall of map.walls) {
      wallHit = resolveSegmentCollision(ball, wall, wall.bounce, 5.5) || wallHit;
    }

    if (wallHit) {
      ball.vx *= 0.92;
      ball.vy = Math.max(ball.vy, 0);
    }

    for (const booster of map.boosters) {
      const rotatingBooster = getRotatingBoosterSegment(
        booster,
        elapsedSeconds
      );

      if (resolveSegmentCollision(ball, rotatingBooster, 1.05, 7)) {
        ball.vy = Math.max(ball.vy, booster.strength * 0.43);
        ball.vx +=
          (ball.x - (rotatingBooster.x1 + rotatingBooster.x2) / 2) * 0.012;
        addPulse(pulses, ball.x, ball.y, "#34f6ff", 20, 18);
      }
    }

    let pinHit = false;
    for (const pin of map.pins) {
      if (resolveCircleCollision(ball, pin, 0.78)) {
        if (isRouteDeflectorPin(pin)) {
          const side =
            Math.abs(ball.x - pin.x) > 0.8
              ? Math.sign(ball.x - pin.x)
              : Math.sign(Math.sin(ball.racePhase)) || 1;

          ball.vx += side * 1.15;
          ball.vy = Math.max(ball.vy, 1.05);
        }

        pinHit = true;
      }
    }

    if (pinHit) {
      ball.vx *= 0.96;
      ball.vy = Math.max(ball.vy, 0.78);
    }

    for (const bumper of map.bumpers) {
      if (resolveCircleCollision(ball, bumper, 1.08, 1.5)) {
        const pulseColor = isFinishBumper(bumper) ? "#f7ff1d" : "#48ff85";
        const nx = (ball.x - bumper.x) / Math.max(1, Math.abs(ball.x - bumper.x));
        const chain = ball.bumperCooldown > 0 ? ball.bumperChain + 1 : 1;
        const sideKick = chain > 1 ? 0.06 : 0.1;

        ball.bumperChain = Math.min(chain, 4);
        ball.bumperCooldown = 72;
        ball.vx += nx * bumper.strength * sideKick;
        ball.vy = Math.max(ball.vy, 2.65);

        addPulse(pulses, bumper.x, bumper.y, pulseColor, bumper.radius + 14, 20);
      }
    }

    for (const exploder of map.exploders) {
      if (ball.blastCooldown <= 0 && resolveCircleCollision(ball, exploder, 0.9, 3)) {
        let nx = ball.x - exploder.x;
        let ny = ball.y - exploder.y;
        const distance = Math.max(1, Math.hypot(nx, ny));
        nx /= distance;
        ny /= distance;

        ball.vx += nx * exploder.strength * 0.86 + (Math.random() - 0.5) * 4;
        ball.vy = Math.max(
          ball.vy + Math.max(0, ny) * exploder.strength * 0.35,
          2.45 + Math.random() * 1.35
        );
        ball.blastCooldown = 36;
        addPulse(pulses, exploder.x, exploder.y, "#ff4f64", exploder.radius + 24, 34);
      }
    }

    ball.blastCooldown = Math.max(0, ball.blastCooldown - dt);
    ball.bumperCooldown = Math.max(0, ball.bumperCooldown - dt);
    if (ball.bumperCooldown <= 0) {
      ball.bumperChain = 0;
    }
    ball.vx = clamp(ball.vx, -maxSideSpeed, maxSideSpeed);
    ball.vy = clamp(ball.vy, maxRiseSpeed, fallSpeedLimit);
    confineBallToPath(ball, map.path);

    if (ball.y > finishLineY) {
      finishBall(ball, boardHeight, onFinish, pulses);
    }

  }

  for (let i = pulses.length - 1; i >= 0; i -= 1) {
    pulses[i].life -= dt;
    if (pulses[i].life <= 0) {
      pulses.splice(i, 1);
    }
  }
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

function drawFinishLine(ctx: CanvasRenderingContext2D, map: MapLayout) {
  const boardHeight = getBoardHeight(map);
  const finishLineY = getFinishLineY(boardHeight);
  const band = map.path?.length ? getPathBandAtY(map.path, finishLineY) : null;
  const lineWidth = band ? Math.max(116, band.width - 10) : 170;
  const startX = (band?.x ?? BOARD_WIDTH / 2) - lineWidth / 2;
  const endX = startX + lineWidth;
  const tileWidth = lineWidth / 10;
  const tileHeight = 10;

  ctx.save();
  ctx.shadowColor = "#fff7a8";
  ctx.shadowBlur = 12;

  for (let index = 0; index < 10; index += 1) {
    ctx.fillStyle = index % 2 === 0 ? "#fff8d7" : "#111315";
    ctx.fillRect(startX + index * tileWidth, finishLineY - tileHeight / 2, tileWidth, tileHeight);
  }

  ctx.strokeStyle = "#ffe147";
  ctx.lineWidth = 2;
  ctx.strokeRect(startX, finishLineY - tileHeight / 2, lineWidth, tileHeight);
  ctx.beginPath();
  ctx.moveTo(startX - 14, finishLineY);
  ctx.lineTo(endX + 14, finishLineY);
  ctx.stroke();

  ctx.fillStyle = "#fff7b0";
  ctx.font = "700 13px Orbitron, Arial, sans-serif";
  ctx.textAlign = "center";
  ctx.fillText("FINISH", BOARD_WIDTH / 2, finishLineY - 14);
  ctx.restore();
}

function drawBoard(
  ctx: CanvasRenderingContext2D,
  map: MapLayout,
  balls: Ball[],
  winner: string | null,
  elapsedSeconds: number,
  pulses: Pulse[]
) {
  const boardHeight = getBoardHeight(map);

  ctx.clearRect(0, 0, BOARD_WIDTH, boardHeight);
  const backdrop = ctx.createLinearGradient(0, 0, 0, boardHeight);
  backdrop.addColorStop(0, "#131726");
  backdrop.addColorStop(0.5, "#0e1220");
  backdrop.addColorStop(1, "#0b0e1a");
  ctx.fillStyle = backdrop;
  ctx.fillRect(0, 0, BOARD_WIDTH, boardHeight);

  ctx.save();
  ctx.globalAlpha = 0.12;
  ctx.strokeStyle = "#4a5a8c";
  ctx.lineWidth = 1;
  for (let x = 80; x < BOARD_WIDTH; x += 80) {
    ctx.beginPath();
    ctx.moveTo(x, 24);
    ctx.lineTo(x, boardHeight - 24);
    ctx.stroke();
  }
  for (let y = 88; y < boardHeight; y += 88) {
    ctx.beginPath();
    ctx.moveTo(34, y);
    ctx.lineTo(BOARD_WIDTH - 34, y);
    ctx.stroke();
  }
  ctx.restore();

  ctx.strokeStyle = "rgba(255, 216, 77, 0.4)";
  ctx.lineWidth = 2;
  ctx.strokeRect(8, 8, BOARD_WIDTH - 16, boardHeight - 16);

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
    const rotatingBooster = getRotatingBoosterSegment(booster, elapsedSeconds);
    const pivotX = (rotatingBooster.x1 + rotatingBooster.x2) / 2;
    const pivotY = (rotatingBooster.y1 + rotatingBooster.y2) / 2;

    drawGlowLine(ctx, rotatingBooster, "#32f7ff", 8);
    ctx.fillStyle = "#031719";
    ctx.beginPath();
    ctx.arc(pivotX, pivotY, 8, 0, Math.PI * 2);
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
    const finishBumper = isFinishBumper(bumper);

    ctx.save();
    ctx.shadowColor = finishBumper ? "#f7ff1d" : "#56ff86";
    ctx.shadowBlur = finishBumper ? 24 : 18;
    ctx.fillStyle = finishBumper ? "rgba(25, 25, 0, 0.36)" : "#13351f";
    ctx.beginPath();
    ctx.arc(bumper.x, bumper.y, bumper.radius, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = finishBumper ? "#f7ff1d" : "#56ff86";
    ctx.lineWidth = finishBumper ? 4 : 3;
    ctx.stroke();

    if (!finishBumper) {
      ctx.fillStyle = "#ddffe4";
      ctx.beginPath();
      ctx.moveTo(bumper.x, bumper.y - 8);
      ctx.lineTo(bumper.x - 8, bumper.y + 6);
      ctx.lineTo(bumper.x + 8, bumper.y + 6);
      ctx.closePath();
      ctx.fill();
    }

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

  for (const pulse of pulses) {
    const progress = pulse.life / pulse.maxLife;
    ctx.save();
    ctx.globalAlpha = clamp(progress, 0, 1);
    ctx.strokeStyle = pulse.color;
    ctx.lineWidth = 3;
    ctx.shadowColor = pulse.color;
    ctx.shadowBlur = 18;
    ctx.beginPath();
    ctx.arc(pulse.x, pulse.y, pulse.radius * (1.1 - progress * 0.35), 0, Math.PI * 2);
    ctx.stroke();
    ctx.restore();
  }

  drawFinishLine(ctx, map);

  for (const ball of balls) {
    if (ball.trail.length > 1) {
      ctx.save();
      for (let i = 0; i < ball.trail.length; i += 1) {
        const point = ball.trail[i];
        ctx.globalAlpha = (i / ball.trail.length) * 0.28;
        ctx.fillStyle = ball.color;
        ctx.beginPath();
        ctx.arc(point.x, point.y, ball.radius * 0.65, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.restore();
    }

    ctx.save();
    ctx.shadowColor = ball.color;
    ctx.shadowBlur = 16;
    ctx.fillStyle = ball.color;
    ctx.beginPath();
    ctx.arc(ball.x, ball.y, ball.radius, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = "rgba(255,255,255,0.62)";
    ctx.beginPath();
    ctx.arc(ball.x - 3, ball.y - 4, ball.radius * 0.32, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();

    ctx.font = "600 12px 'Apple SD Gothic Neo', 'Malgun Gothic', Arial, sans-serif";
    ctx.textAlign = "center";
    ctx.fillStyle = ball.color;
    ctx.fillText(normalizeLabel(ball.name, 8), ball.x, ball.y + ball.radius + 14);
  }

  if (winner) {
    ctx.save();
    ctx.fillStyle = "rgba(7, 10, 18, 0.84)";
    ctx.strokeStyle = "#ffd84d";
    ctx.lineWidth = 1.5;
    ctx.shadowColor = "rgba(255, 216, 77, 0.5)";
    ctx.shadowBlur = 18;
    ctx.beginPath();
    if (typeof ctx.roundRect === "function") {
      ctx.roundRect(BOARD_WIDTH / 2 - 118, 24, 236, 38, 12);
    } else {
      ctx.rect(BOARD_WIDTH / 2 - 118, 24, 236, 38);
    }
    ctx.fill();
    ctx.shadowBlur = 0;
    ctx.stroke();
    ctx.fillStyle = "#ffefad";
    ctx.font = "800 16px 'Apple SD Gothic Neo', 'Malgun Gothic', sans-serif";
    ctx.textAlign = "center";
    ctx.fillText(`우승 ${normalizeLabel(winner, 14)}`, BOARD_WIDTH / 2, 49);
    ctx.restore();
  }
}

function isStructureKind(value: unknown): value is StructureKind {
  return typeof value === "string" && STRUCTURES.includes(value as StructureKind);
}

function isGeneratedStructureKind(value: unknown): value is GeneratedStructureKind {
  return (
    typeof value === "string" &&
    GENERATED_STRUCTURES.includes(value as GeneratedStructureKind)
  );
}

function isMapLayout(value: unknown): value is MapLayout {
  if (!value || typeof value !== "object") {
    return false;
  }

  const map = value as MapLayout;
  return (
    map.version === 1 &&
    Number.isFinite(map.seed) &&
    Number.isFinite(map.complexity) &&
    isStructureKind(map.structure) &&
    (!("height" in map) || Number.isFinite(map.height)) &&
    (!("path" in map) || Array.isArray(map.path)) &&
    Array.isArray(map.walls) &&
    Array.isArray(map.pins) &&
    Array.isArray(map.bumpers) &&
    Array.isArray(map.exploders) &&
    Array.isArray(map.boosters)
  );
}

function sanitizeMapLayout(map: MapLayout): MapLayout {
  if (!map.path || map.path.length < 2) {
    return map;
  }

  const path = map.path;
  const walls = map.walls.filter((wall) => {
    if (wall.id === "finish-left" || wall.id === "finish-right") {
      return false;
    }

    if (wall.id.startsWith("divider-") || wall.id.startsWith("pocket-")) {
      return false;
    }

    if (
      map.structure === "custom" &&
      wall.id.startsWith("wall-") &&
      isSegmentInsidePath(path, wall, 14)
    ) {
      return false;
    }

    return true;
  });
  const pins = map.pins.filter(
    (pin) =>
      !blocksFinishDropLane(path, pin, pin.radius) &&
      isCircleClearOfWalls(walls, pin, WALL_TRAP_CLEARANCE)
  );
  const bumpers = map.bumpers.filter(
    (bumper) =>
      !blocksFinishDropLane(path, bumper, bumper.radius) &&
      isCircleClearOfWalls(walls, bumper, BUMPER_WALL_CLEARANCE)
  );
  const spacedBumpers = bumpers.reduce<CircleObstacle[]>((kept, bumper) => {
    if (!hasBumperLaneSpace(bumper, kept)) {
      return kept;
    }

    return [...kept, bumper];
  }, []);
  const exploders = map.exploders.filter(
    (exploder) =>
      !blocksFinishDropLane(path, exploder, exploder.radius) &&
      isCircleClearOfWalls(walls, exploder, WALL_TRAP_CLEARANCE)
  );
  const boosters = map.boosters.filter(
    (booster) =>
      !segmentBlocksFinishDropLane(path, booster, 8) &&
      isBoosterClearOfWalls(walls, booster)
  );
  const safeObstacles = makeObstaclesRouteSafe(walls, path, {
    pins,
    bumpers: spacedBumpers,
    exploders,
    boosters,
  });
  const changed =
    walls.length !== map.walls.length ||
    safeObstacles.pins.length !== map.pins.length ||
    safeObstacles.bumpers.length !== map.bumpers.length ||
    safeObstacles.exploders.length !== map.exploders.length ||
    safeObstacles.boosters.length !== map.boosters.length;

  return changed
    ? {
        ...map,
        walls,
        pins: safeObstacles.pins,
        bumpers: safeObstacles.bumpers,
        exploders: safeObstacles.exploders,
        boosters: safeObstacles.boosters,
      }
    : map;
}

function readLocalMaps(): SavedMapRecord[] {
  if (typeof window === "undefined") {
    return [];
  }

  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    const parsed = raw ? (JSON.parse(raw) as SavedMapRecord[]) : [];
    return parsed
      .filter((record) => isMapLayout(record.map))
      .map((record) => ({ ...record, map: sanitizeMapLayout(record.map) }));
  } catch {
    return [];
  }
}

function writeLocalMaps(records: SavedMapRecord[]) {
  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(records.slice(0, 24)));
}

function isFeedbackRecord(value: unknown): value is FeedbackRecord {
  if (!value || typeof value !== "object") {
    return false;
  }

  const record = value as FeedbackRecord;
  return (
    typeof record.id === "string" &&
    typeof record.message === "string" &&
    record.message.trim().length > 0 &&
    typeof record.mapName === "string" &&
    typeof record.seed === "number" &&
    typeof record.complexity === "number" &&
    isStructureKind(record.structure) &&
    typeof record.createdAt === "number"
  );
}

function readLocalFeedback(): FeedbackRecord[] {
  if (typeof window === "undefined") {
    return [];
  }

  try {
    const raw = window.localStorage.getItem(FEEDBACK_STORAGE_KEY);
    const parsed = raw ? (JSON.parse(raw) as unknown[]) : [];
    return parsed.filter(isFeedbackRecord);
  } catch {
    return [];
  }
}

function writeLocalFeedback(records: FeedbackRecord[]) {
  window.localStorage.setItem(
    FEEDBACK_STORAGE_KEY,
    JSON.stringify(records.slice(0, 12))
  );
}

function formatSavedTime(timestamp: number) {
  return new Intl.DateTimeFormat("ko-KR", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(timestamp));
}

function savedMapFromApi(value: unknown): SavedMapRecord | null {
  if (!value || typeof value !== "object") {
    return null;
  }

  const record = value as SavedMapRecord;
  if (!isMapLayout(record.map) || !isStructureKind(record.structure)) {
    return null;
  }

  return {
    id: String(record.id),
    name: String(record.name),
    seed: Number(record.seed),
    complexity: Number(record.complexity),
    structure: record.structure,
    map: sanitizeMapLayout(record.map),
    createdAt: Number(record.createdAt),
    storage: record.storage === "local" ? "local" : "d1",
  };
}

export default function PinballRoulette() {
  const initialMap = useMemo(() => generateMap(820246, 3, "random"), []);
  const [playerInput, setPlayerInput] = useState("나, 하나, 둘");
  const [map, setMap] = useState<MapLayout>(initialMap);
  const [complexity, setComplexity] = useState(initialMap.complexity);
  const [structureChoice, setStructureChoice] = useState<StructureChoice>("random");
  const [mapName, setMapName] = useState("네온 핀볼 맵");
  const [running, setRunning] = useState(false);
  const [winnerMode, setWinnerMode] = useState<WinnerMode>("first");
  const [winnerCount, setWinnerCount] = useState(1);
  const [finishOrder, setFinishOrder] = useState<RankingEntry[]>([]);
  const [savedMaps, setSavedMaps] = useState<SavedMapRecord[]>([]);
  const [saveStatus, setSaveStatus] = useState("저장소 대기");
  const [isSaving, setIsSaving] = useState(false);
  const [feedbackInput, setFeedbackInput] = useState("");
  const [feedbackRecords, setFeedbackRecords] = useState<FeedbackRecord[]>([]);
  const [feedbackStatus, setFeedbackStatus] = useState("의견 대기");
  const [telemetry, setTelemetry] = useState<Telemetry>({ falling: 0, finished: 0 });
  const [recordingEnabled, setRecordingEnabled] = useState(false);
  const [isRecording, setIsRecording] = useState(false);
  const [recordingUrl, setRecordingUrl] = useState<string | null>(null);
  const [canRecord, setCanRecord] = useState(false);

  const players = useMemo(() => parsePlayers(playerInput), [playerInput]);
  const boardHeight = getBoardHeight(map);
  const playersKey = players.map((player) => player.name).join("\u001f");
  const winner = useMemo(
    () =>
      computeWinnerLabel(
        finishOrder,
        players.length,
        winnerMode,
        winnerCount
      ),
    [finishOrder, players.length, winnerCount, winnerMode]
  );

  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const stageWrapRef = useRef<HTMLElement | null>(null);
  const ballsRef = useRef<Ball[]>(createBalls(players, map.seed));
  const pulsesRef = useRef<Pulse[]>([]);
  const finishOrderRef = useRef<RankingEntry[]>([]);
  const mapRef = useRef(map);
  const playersRef = useRef(players);
  const runningRef = useRef(running);
  const winnerRef = useRef<string | null>(winner);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const recordedChunksRef = useRef<BlobPart[]>([]);
  const recordingUrlRef = useRef<string | null>(null);

  const stopRecording = useCallback(() => {
    const recorder = mediaRecorderRef.current;

    if (recorder && recorder.state !== "inactive") {
      recorder.stop();
    }
  }, []);

  const startRecording = useCallback(() => {
    const canvas = canvasRef.current;

    if (
      !canvas ||
      typeof MediaRecorder === "undefined" ||
      typeof canvas.captureStream !== "function"
    ) {
      return;
    }

    if (mediaRecorderRef.current?.state === "recording") {
      return;
    }

    if (recordingUrlRef.current) {
      URL.revokeObjectURL(recordingUrlRef.current);
      recordingUrlRef.current = null;
      setRecordingUrl(null);
    }

    const stream = canvas.captureStream(60);
    const mimeType = [
      "video/webm;codecs=vp9",
      "video/webm;codecs=vp8",
      "video/webm",
    ].find((type) => MediaRecorder.isTypeSupported(type));
    const recorder = new MediaRecorder(
      stream,
      mimeType ? { mimeType } : undefined
    );

    recordedChunksRef.current = [];
    recorder.ondataavailable = (event) => {
      if (event.data.size > 0) {
        recordedChunksRef.current.push(event.data);
      }
    };
    recorder.onstop = () => {
      stream.getTracks().forEach((track) => track.stop());
      setIsRecording(false);

      if (recordedChunksRef.current.length === 0) {
        return;
      }

      const blob = new Blob(recordedChunksRef.current, {
        type: mimeType ?? "video/webm",
      });
      const url = URL.createObjectURL(blob);
      recordingUrlRef.current = url;
      setRecordingUrl(url);
    };
    mediaRecorderRef.current = recorder;
    recorder.start(250);
    setIsRecording(true);
  }, []);

  const loadSavedMaps = useCallback(async () => {
    const localMaps = readLocalMaps();

    if (isStaticSpa()) {
      setSavedMaps(localMaps);
      setSaveStatus(localMaps.length > 0 ? "로컬 저장소" : "로컬 저장 대기");
      return;
    }

    try {
      const response = await fetch("/api/maps");
      if (!response.ok) {
        throw new Error("D1 is not ready");
      }

      const data = (await response.json()) as { maps?: unknown[] };
      const remoteMaps = (data.maps ?? [])
        .map(savedMapFromApi)
        .filter((record): record is SavedMapRecord => Boolean(record));

      setSavedMaps([...remoteMaps, ...localMaps]);
      setSaveStatus(remoteMaps.length > 0 ? "D1 연결" : "저장 가능");
    } catch {
      setSavedMaps(localMaps);
      setSaveStatus(localMaps.length > 0 ? "로컬 백업" : "저장소 대기");
    }
  }, []);

  useEffect(() => {
    mapRef.current = map;
    ballsRef.current = createBalls(playersRef.current, map.seed);
    pulsesRef.current = [];
    finishOrderRef.current = [];
    runningRef.current = false;
    stopRecording();

    const frameId = requestAnimationFrame(() => {
      setFinishOrder([]);
      setRunning(false);
      setTelemetry({ falling: playersRef.current.length, finished: 0 });
    });

    return () => cancelAnimationFrame(frameId);
  }, [map, stopRecording]);

  useEffect(() => {
    playersRef.current = players;
    ballsRef.current = createBalls(players, mapRef.current.seed);
    pulsesRef.current = [];
    finishOrderRef.current = [];
    runningRef.current = false;
    stopRecording();

    const frameId = requestAnimationFrame(() => {
      setFinishOrder([]);
      setRunning(false);
      setTelemetry({ falling: players.length, finished: 0 });
    });

    return () => cancelAnimationFrame(frameId);
  }, [playersKey, players, stopRecording]);

  useEffect(() => {
    runningRef.current = running;
  }, [running]);

  useEffect(() => {
    winnerRef.current = winner;
  }, [winner]);

  useEffect(() => {
    const timerId = window.setTimeout(() => {
      void loadSavedMaps();
      const records = readLocalFeedback();
      setFeedbackRecords(records);
      setFeedbackStatus(records.length > 0 ? "로컬 저장됨" : "의견 대기");
    }, 0);

    return () => window.clearTimeout(timerId);
  }, [loadSavedMaps]);

  useEffect(() => {
    const frameId = requestAnimationFrame(() => {
      setCanRecord(
        typeof MediaRecorder !== "undefined" &&
          typeof HTMLCanvasElement !== "undefined" &&
          "captureStream" in HTMLCanvasElement.prototype
      );
    });

    return () => cancelAnimationFrame(frameId);
  }, []);

  useEffect(
    () => () => {
      stopRecording();

      if (recordingUrlRef.current) {
        URL.revokeObjectURL(recordingUrlRef.current);
      }
    },
    [stopRecording]
  );

  useEffect(() => {
    let frameId = 0;
    let last = performance.now();
    let lastTelemetry = 0;

    const animate = (now: number) => {
      const canvas = canvasRef.current;
      const ctx = canvas?.getContext("2d");
      const dt = clamp((now - last) / 16.67, 0.2, 2.1);
      last = now;

      if (runningRef.current) {
        stepSimulation(
          ballsRef.current,
          mapRef.current,
          dt,
          now / 1000,
          (entry) => {
            if (
              !finishOrderRef.current.some(
                (rankedEntry) => rankedEntry.id === entry.id
              )
            ) {
              const nextFinishOrder = [...finishOrderRef.current, entry];
              finishOrderRef.current = nextFinishOrder;
              setFinishOrder(nextFinishOrder);
            }
          },
          pulsesRef.current
        );

        if (
          ballsRef.current.length > 0 &&
          ballsRef.current.every((ball) => ball.finished)
        ) {
          runningRef.current = false;
          setRunning(false);
          stopRecording();
        }
      }

      if (ctx) {
        drawBoard(
          ctx,
          mapRef.current,
          ballsRef.current,
          winnerRef.current,
          now / 1000,
          pulsesRef.current
        );
      }

      if (runningRef.current && stageWrapRef.current) {
        const activeBalls = ballsRef.current.filter((ball) => !ball.finished);
        const boardHeight = getBoardHeight(mapRef.current);
        const averageY =
          activeBalls.length > 0
            ? activeBalls.reduce((sum, ball) => sum + ball.y, 0) / activeBalls.length
            : boardHeight;
        const leadingY =
          activeBalls.length > 0
            ? activeBalls.reduce((maxY, ball) => Math.max(maxY, ball.y), 0)
            : boardHeight;
        const focusY = activeBalls.length > 0
          ? averageY * 0.35 + leadingY * 0.65
          : boardHeight;
        const maxScroll =
          stageWrapRef.current.scrollHeight - stageWrapRef.current.clientHeight;
        const desiredScroll = clamp(
          (focusY / boardHeight) * stageWrapRef.current.scrollHeight -
            stageWrapRef.current.clientHeight * 0.26,
          0,
          Math.max(0, maxScroll)
        );

        stageWrapRef.current.scrollTop +=
          (desiredScroll - stageWrapRef.current.scrollTop) * 0.16;
      }

      if (now - lastTelemetry > 160) {
        lastTelemetry = now;
        const finished = ballsRef.current.filter((ball) => ball.finished).length;
        setTelemetry({
          falling: Math.max(0, ballsRef.current.length - finished),
          finished,
        });
      }

      frameId = requestAnimationFrame(animate);
    };

    frameId = requestAnimationFrame(animate);
    return () => cancelAnimationFrame(frameId);
  }, [stopRecording]);

  const resetBalls = useCallback(() => {
    ballsRef.current = createBalls(playersRef.current, mapRef.current.seed);
    pulsesRef.current = [];
    finishOrderRef.current = [];
    runningRef.current = false;
    stopRecording();
    setFinishOrder([]);
    setRunning(false);
    setTelemetry({ falling: playersRef.current.length, finished: 0 });
    if (stageWrapRef.current) {
      stageWrapRef.current.scrollTop = 0;
    }
  }, [stopRecording]);

  const applySettings = useCallback(() => {
    const seed = randomSeed();
    const nextMap = generateMap(seed, complexity, structureChoice);
    setMap(nextMap);
    setMapName(`${STRUCTURE_LABELS[nextMap.structure]} ${seed % 10000}`);
    resetBalls();
  }, [complexity, resetBalls, structureChoice]);

  const randomizeMap = useCallback(() => {
    const seed = randomSeed();
    const nextMap = generateMap(seed, complexity, "random");
    setStructureChoice("random");
    setMap(nextMap);
    setMapName(`${STRUCTURE_LABELS[nextMap.structure]} ${seed % 10000}`);
    resetBalls();
  }, [complexity, resetBalls]);

  const shuffleBalls = useCallback(() => {
    ballsRef.current = createBalls(playersRef.current, randomSeed());
    pulsesRef.current = [];
    finishOrderRef.current = [];
    runningRef.current = false;
    stopRecording();
    setFinishOrder([]);
    setRunning(false);
    setTelemetry({ falling: playersRef.current.length, finished: 0 });
    if (stageWrapRef.current) {
      stageWrapRef.current.scrollTop = 0;
    }
  }, [stopRecording]);

  const saveCurrentMap = useCallback(async () => {
    const payload = {
      name: mapName.trim() || `${STRUCTURE_LABELS[map.structure]} 맵`,
      seed: map.seed,
      complexity: map.complexity,
      structure: map.structure,
      map,
    };

    setIsSaving(true);

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

      const data = (await response.json()) as { map?: unknown };
      const saved = savedMapFromApi(data.map);

      if (!saved) {
        throw new Error("Saved map payload is invalid");
      }

      setSavedMaps((current) => [saved, ...current.filter((item) => item.id !== saved.id)]);
      setSaveStatus("D1 저장됨");
    } catch {
      const localRecord: SavedMapRecord = {
        id: `local-${crypto.randomUUID()}`,
        name: payload.name,
        seed: payload.seed,
        complexity: payload.complexity,
        structure: payload.structure,
        map,
        createdAt: Date.now(),
        storage: "local",
      };
      const nextLocalMaps = [
        localRecord,
        ...readLocalMaps().filter((item) => item.id !== localRecord.id),
      ];
      writeLocalMaps(nextLocalMaps);
      setSavedMaps((current) => [
        localRecord,
        ...current.filter((item) => item.id !== localRecord.id),
      ]);
      setSaveStatus("로컬 저장됨");
    } finally {
      setIsSaving(false);
    }
  }, [map, mapName]);

  const saveFeedback = useCallback(() => {
    const message = feedbackInput.trim();

    if (!message) {
      setFeedbackStatus("내용 필요");
      return;
    }

    const record: FeedbackRecord = {
      id: `feedback-${crypto.randomUUID()}`,
      message,
      mapName: mapName.trim() || `${STRUCTURE_LABELS[map.structure]} 맵`,
      seed: map.seed,
      complexity: map.complexity,
      structure: map.structure,
      createdAt: Date.now(),
    };
    const nextRecords = [
      record,
      ...feedbackRecords.filter((item) => item.id !== record.id),
    ].slice(0, 12);

    writeLocalFeedback(nextRecords);
    setFeedbackRecords(nextRecords);
    setFeedbackInput("");
    setFeedbackStatus("로컬 저장됨");
  }, [feedbackInput, feedbackRecords, map, mapName]);

  const deleteFeedback = useCallback(
    (recordId: string) => {
      const nextRecords = feedbackRecords.filter((record) => record.id !== recordId);

      writeLocalFeedback(nextRecords);
      setFeedbackRecords(nextRecords);
      setFeedbackStatus(nextRecords.length > 0 ? "로컬 저장됨" : "의견 대기");
    },
    [feedbackRecords]
  );

  const loadMap = useCallback(
    (record: SavedMapRecord) => {
      const nextMap = sanitizeMapLayout(record.map);

      setMap(nextMap);
      setComplexity(nextMap.complexity);
      setStructureChoice(
        isGeneratedStructureKind(nextMap.structure)
          ? nextMap.structure
          : "random"
      );
      setMapName(record.name);
      setSaveStatus("맵 불러옴");
      resetBalls();
    },
    [resetBalls]
  );

  const deleteMap = useCallback(
    async (record: SavedMapRecord) => {
      if (record.storage === "local") {
        const nextLocalMaps = readLocalMaps().filter((item) => item.id !== record.id);
        writeLocalMaps(nextLocalMaps);
        setSavedMaps((current) => current.filter((item) => item.id !== record.id));
        setSaveStatus("로컬 삭제됨");
        return;
      }

      if (isStaticSpa()) {
        setSaveStatus("정적 페이지 로컬 삭제됨");
        return;
      }

      try {
        await fetch(`/api/maps/${record.id}`, { method: "DELETE" });
        setSavedMaps((current) => current.filter((item) => item.id !== record.id));
        setSaveStatus("D1 삭제됨");
      } catch {
        setSaveStatus("삭제 대기");
      }

      await loadSavedMaps();
    },
    [loadSavedMaps]
  );

  const canRun = players.length > 0;
  const winnerInputMax = Math.max(players.length, 1);

  const toggleRunning = useCallback(() => {
    if (!canRun) {
      return;
    }

    if (runningRef.current) {
      runningRef.current = false;
      stopRecording();
      setRunning(false);
      return;
    }

    if (
      ballsRef.current.length === 0 ||
      ballsRef.current.every((ball) => ball.finished)
    ) {
      ballsRef.current = createBalls(playersRef.current, randomSeed());
      pulsesRef.current = [];
      finishOrderRef.current = [];
      setFinishOrder([]);
      setTelemetry({ falling: playersRef.current.length, finished: 0 });

      if (stageWrapRef.current) {
        stageWrapRef.current.scrollTop = 0;
      }
    }

    if (recordingEnabled) {
      startRecording();
    }

    runningRef.current = true;
    setRunning(true);
  }, [canRun, recordingEnabled, startRecording, stopRecording]);

  return (
    <main className="roulette-shell">
      <header className="roulette-topbar">
        <div className="brand-block">
          <p>RANDOM PINBALL ROULETTE</p>
          <h1>핀볼 룰렛</h1>
        </div>
        <div className="topbar-actions">
          <Link className="topbar-link" href="/custom">
            커스텀 맵
          </Link>
          <div className="top-right-stack" aria-live="polite">
            <div className="status-strip">
              <span>우승</span>
              <strong>{winner ?? "대기"}</strong>
            </div>
          </div>
        </div>
      </header>

      <div className="roulette-workspace">
        <section className="control-panel" aria-label="게임 설정">
          <div className="panel-title">
            <h2>플레이어</h2>
            <span>{players.length}명</span>
          </div>
          <textarea
            id="players"
            value={playerInput}
            onChange={(event) => setPlayerInput(event.target.value)}
            placeholder="나, 하나, 둘"
            spellCheck={false}
          />
          <div className="chip-row">
            {players.length === 0 ? (
              <span className="empty-chip">대기</span>
            ) : (
              players.map((player) => (
                <span
                  className="player-chip"
                  key={`${player.id}-${player.name}`}
                  style={{ "--chip-color": player.color } as CSSProperties}
                >
                  {player.name}
                </span>
              ))
            )}
          </div>

          <div className="panel-title">
            <h2>맵</h2>
            <span>
              {STRUCTURE_LABELS[map.structure]} · {boardHeight}px
            </span>
          </div>
          <label className="field-label" htmlFor="complexity">
            복잡도 {complexity}
          </label>
          <input
            id="complexity"
            type="range"
            min="1"
            max="5"
            value={complexity}
            onChange={(event) => setComplexity(Number(event.target.value))}
          />
          <label className="field-label" htmlFor="structure">
            구조
          </label>
          <select
            id="structure"
            value={structureChoice}
            onChange={(event) => setStructureChoice(event.target.value as StructureChoice)}
          >
            <option value="random">랜덤</option>
            {GENERATED_STRUCTURES.map((structure) => (
              <option key={structure} value={structure}>
                {STRUCTURE_LABELS[structure]}
              </option>
            ))}
          </select>

          <div className="button-grid">
            <button type="button" onClick={randomizeMap}>
              랜덤 생성
            </button>
            <button type="button" onClick={applySettings}>
              설정 적용
            </button>
          </div>

          <div className="panel-title">
            <h2>시뮬레이션</h2>
            <span>
              {telemetry.finished}/{players.length}
            </span>
          </div>
          <div className="victory-control">
            <span>The winner is</span>
            <div className="segmented-control" aria-label="승리 조건">
              <button
                type="button"
                aria-pressed={winnerMode === "first"}
                onClick={() => setWinnerMode("first")}
              >
                First
              </button>
              <button
                type="button"
                aria-pressed={winnerMode === "last"}
                onClick={() => setWinnerMode("last")}
              >
                Last
              </button>
            </div>
            <input
              aria-label="승리 인원"
              type="number"
              min="1"
              max={winnerInputMax}
              value={winnerCount}
              onChange={(event) =>
                setWinnerCount(
                  clamp(Number(event.target.value) || 1, 1, winnerInputMax)
                )
              }
            />
          </div>
          <label className="record-toggle">
            <input
              type="checkbox"
              checked={recordingEnabled}
              disabled={!canRecord || running}
              onChange={(event) => setRecordingEnabled(event.target.checked)}
            />
            <span>Recording</span>
            <strong className={isRecording ? "recording-on" : undefined}>
              {isRecording ? "REC" : recordingEnabled ? "ON" : "OFF"}
            </strong>
          </label>
          {recordingUrl ? (
            <a
              className="recording-link"
              href={recordingUrl}
              download="pinball-roulette-recording.webm"
            >
              녹화 저장
            </a>
          ) : null}
          <div className="button-grid">
            <button
              type="button"
              className="primary-button"
              disabled={!canRun}
              onClick={toggleRunning}
            >
              {running ? "정지" : "시작"}
            </button>
            <button type="button" onClick={resetBalls}>
              리셋
            </button>
            <button type="button" disabled={!canRun} onClick={shuffleBalls}>
              출발 셔플
            </button>
          </div>
          <dl className="metric-row">
            <div>
              <dt>낙하</dt>
              <dd>{telemetry.falling}</dd>
            </div>
            <div>
              <dt>도착</dt>
              <dd>{telemetry.finished}</dd>
            </div>
          </dl>
        </section>

        <section
          ref={stageWrapRef}
          className="stage-wrap"
          aria-label="핀볼 룰렛 보드"
        >
          <div className="board-frame">
            <canvas
              ref={canvasRef}
              className="board-canvas"
              width={BOARD_WIDTH}
              height={boardHeight}
            />
          </div>
        </section>

        <aside className="side-panel" aria-label="순위와 맵 저장소">
          <div className="panel-title">
            <h2>순위</h2>
            <span>
              {finishOrder.length}/{players.length}
            </span>
          </div>
          <ol className="side-rank-list" aria-label="도착 순위">
            {players.length === 0 ? (
              <li className="side-rank-item">
                <span>순위</span>
                <strong>대기</strong>
              </li>
            ) : (
              Array.from({ length: players.length }, (_, index) => {
                const entry = finishOrder[index];

                return (
                  <li className="side-rank-item" key={`side-rank-${index}`}>
                    <span>{index + 1}등</span>
                    <strong
                      style={
                        entry
                          ? ({ "--rank-color": entry.color } as CSSProperties)
                          : undefined
                      }
                    >
                      {entry?.name ?? "대기"}
                    </strong>
                  </li>
                );
              })
            )}
          </ol>

          <div className="panel-title">
            <h2>저장</h2>
            <span>{saveStatus}</span>
          </div>
          <input
            className="map-name-input"
            value={mapName}
            onChange={(event) => setMapName(event.target.value)}
            maxLength={80}
          />
          <button
            type="button"
            className="primary-button full-button"
            disabled={isSaving}
            onClick={saveCurrentMap}
          >
            {isSaving ? "저장 중" : "맵 저장"}
          </button>

          <div className="saved-list">
            {savedMaps.length === 0 ? (
              <div className="empty-state">저장된 맵 없음</div>
            ) : (
              savedMaps.map((record) => (
                <article className="saved-map-card" key={record.id}>
                  <button type="button" onClick={() => loadMap(record)}>
                    <strong>{record.name}</strong>
                    <span>
                      {STRUCTURE_LABELS[record.structure]} · {record.complexity} ·{" "}
                      {formatSavedTime(record.createdAt)}
                    </span>
                  </button>
                  <button
                    type="button"
                    className="delete-button"
                    onClick={() => void deleteMap(record)}
                  >
                    삭제
                  </button>
                </article>
              ))
            )}
          </div>

          <div className="panel-title">
            <h2>의견</h2>
            <span>{feedbackStatus}</span>
          </div>
          <textarea
            className="feedback-input"
            value={feedbackInput}
            onChange={(event) => {
              setFeedbackInput(event.target.value);
              if (feedbackStatus === "내용 필요") {
                setFeedbackStatus("작성 중");
              }
            }}
            placeholder="추가하면 좋을 기능이나 맵 아이디어를 적어주세요"
            maxLength={360}
          />
          <button
            type="button"
            className="primary-button full-button"
            disabled={feedbackInput.trim().length === 0}
            onClick={saveFeedback}
          >
            의견 저장
          </button>

          <div className="feedback-list">
            {feedbackRecords.length === 0 ? (
              <div className="empty-state">저장된 의견 없음</div>
            ) : (
              feedbackRecords.map((record) => (
                <article className="feedback-card" key={record.id}>
                  <p>{record.message}</p>
                  <span>
                    {STRUCTURE_LABELS[record.structure]} · {record.complexity} ·{" "}
                    {formatSavedTime(record.createdAt)}
                  </span>
                  <button
                    type="button"
                    className="delete-button"
                    onClick={() => deleteFeedback(record.id)}
                  >
                    삭제
                  </button>
                </article>
              ))
            )}
          </div>
        </aside>
      </div>
    </main>
  );
}

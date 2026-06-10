#!/usr/bin/env node
/* eslint-disable @typescript-eslint/no-require-imports */

const fs = require("fs");
const Module = require("module");
const path = require("path");
const ts = require("typescript");

const ROOT = path.resolve(__dirname, "..");
const SOURCE_FILE = path.join(ROOT, "app", "pinball-roulette.tsx");
const FPS = 60;
const DEFAULT_TRIALS = 1000;
const DEFAULT_PLAYER_COUNTS = [1, 2, 3, 5, 8, 12, 20, 30];
const DEFAULT_COMPLEXITIES = [1, 2, 3, 4, 5];
const DEFAULT_STRUCTURES = [
  "random",
  "zigzag",
  "funnel",
  "chambers",
  "split",
  "cascade",
  "chaos",
];

function parseList(value, fallback, mapValue = (item) => item) {
  if (!value) {
    return fallback;
  }

  const parsed = value
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean)
    .map(mapValue);

  return parsed.length > 0 ? parsed : fallback;
}

function parseArgs(argv) {
  const options = {
    trials: DEFAULT_TRIALS,
    players: DEFAULT_PLAYER_COUNTS,
    complexities: DEFAULT_COMPLEXITIES,
    structures: DEFAULT_STRUCTURES,
    seed: 1,
    lowMaxSeconds: 40,
    maxSeconds: 60,
    progressEvery: 100000,
    failFast: false,
    startIndex: 0,
    targetBalls: 0,
    trace: false,
  };

  for (const arg of argv) {
    const [name, rawValue] = arg.split("=");
    const value = rawValue ?? "";

    switch (name) {
      case "--trials":
        options.trials = Math.max(1, Number.parseInt(value, 10) || options.trials);
        break;
      case "--players":
        options.players = parseList(value, options.players, (item) =>
          Math.max(1, Number.parseInt(item, 10) || 1)
        );
        break;
      case "--complexities":
        options.complexities = parseList(value, options.complexities, (item) =>
          Math.min(5, Math.max(1, Number.parseInt(item, 10) || 1))
        );
        break;
      case "--structures":
        options.structures = parseList(value, options.structures);
        break;
      case "--seed":
        options.seed = Number.parseInt(value, 10) || options.seed;
        break;
      case "--low-max-seconds":
        options.lowMaxSeconds = Math.max(1, Number.parseFloat(value) || options.lowMaxSeconds);
        break;
      case "--max-seconds":
        options.maxSeconds = Math.max(1, Number.parseFloat(value) || options.maxSeconds);
        break;
      case "--progress-every":
        options.progressEvery = Math.max(0, Number.parseInt(value, 10) || 0);
        break;
      case "--fail-fast":
        options.failFast = true;
        break;
      case "--start-index":
        options.startIndex = Math.max(0, Number.parseInt(value, 10) || 0);
        break;
      case "--target-balls":
        options.targetBalls = Math.max(0, Number.parseInt(value, 10) || 0);
        break;
      case "--trace":
        options.trace = true;
        break;
      default:
        throw new Error(`Unknown argument: ${name}`);
    }
  }

  return options;
}

function createRng(seed) {
  let value = seed >>> 0;

  return () => {
    value += 0x6d2b79f5;
    let next = value;
    next = Math.imul(next ^ (next >>> 15), next | 1);
    next ^= next + Math.imul(next ^ (next >>> 7), next | 61);
    return ((next ^ (next >>> 14)) >>> 0) / 4294967296;
  };
}

function hash32(value) {
  let next = value >>> 0;
  next ^= next >>> 16;
  next = Math.imul(next, 0x7feb352d);
  next ^= next >>> 15;
  next = Math.imul(next, 0x846ca68b);
  next ^= next >>> 16;
  return next >>> 0;
}

function loadSimulationApi() {
  const source = `${fs.readFileSync(SOURCE_FILE, "utf8")}

(globalThis).__PINBALL_SIM_EXPORTS__ = {
  GENERATED_STRUCTURES,
  generateMap,
  createBalls,
  stepSimulation,
  parsePlayers,
  getBoardHeight
};
`;
  const output = ts.transpileModule(source, {
    fileName: SOURCE_FILE,
    compilerOptions: {
      esModuleInterop: true,
      jsx: ts.JsxEmit.ReactJSX,
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2020,
    },
  }).outputText;
  const compiledModule = new Module(SOURCE_FILE, module.parent);
  compiledModule.filename = SOURCE_FILE;
  compiledModule.paths = Module._nodeModulePaths(path.dirname(SOURCE_FILE));
  const originalRequire = compiledModule.require.bind(compiledModule);

  compiledModule.require = (id) => {
      if (id === "./app-link") {
        return function LinkStub() {
          return null;
        };
      }

      if (id === "./static-spa") {
        return { isStaticSpa: false };
      }

      if (id === "next/link") {
        return function LinkStub() {
          return null;
        };
      }

      if (id === "react") {
        return {
          useCallback: () => {},
          useEffect: () => {},
          useMemo: () => {},
          useRef: () => {},
          useState: () => {},
        };
      }

      if (id === "react/jsx-runtime") {
        return {
          Fragment: Symbol.for("react.fragment"),
          jsx: () => null,
          jsxs: () => null,
        };
      }

      return originalRequire(id);
  };
  compiledModule._compile(output, SOURCE_FILE);

  return {
    api: globalThis.__PINBALL_SIM_EXPORTS__,
    setRandom: (random) => {
      Math.random = random;
    },
  };
}

function createPlayers(count, sim) {
  return sim.parsePlayers(
    Array.from({ length: count }, (_, index) => `P${index + 1}`).join(",")
  );
}

function summarizeFailure(trial) {
  return [
    `trial=${trial.index}`,
    `seed=${trial.mapSeed}`,
    `ballSeed=${trial.ballSeed}`,
    `complexity=${trial.complexity}`,
    `structure=${trial.structure}`,
    `actualStructure=${trial.actualStructure}`,
    `players=${trial.playerCount}`,
    `finished=${trial.finished}/${trial.playerCount}`,
    `last=${trial.lastSeconds.toFixed(2)}s`,
    `limit=${trial.limitSeconds.toFixed(2)}s`,
    `slowest=${trial.slowestName}`,
    `position=(${trial.slowestX.toFixed(1)},${trial.slowestY.toFixed(1)})`,
  ].join(" ");
}

function distanceToSegment(point, segment) {
  const dx = segment.x2 - segment.x1;
  const dy = segment.y2 - segment.y1;
  const lengthSquared = dx * dx + dy * dy;

  if (lengthSquared <= 0.0001) {
    return Math.hypot(point.x - segment.x1, point.y - segment.y1);
  }

  const t = Math.min(
    1,
    Math.max(
      0,
      ((point.x - segment.x1) * dx + (point.y - segment.y1) * dy) /
        lengthSquared
    )
  );
  const px = segment.x1 + dx * t;
  const py = segment.y1 + dy * t;

  return Math.hypot(point.x - px, point.y - py);
}

function runTrial(sim, setRandom, options, index, aggregates) {
  const complexity = options.complexities[index % options.complexities.length];
  const structure = options.structures[
    Math.floor(index / options.complexities.length) % options.structures.length
  ];
  const playerCount = options.players[
    Math.floor(index / (options.complexities.length * options.structures.length)) %
      options.players.length
  ];
  const mapSeed = hash32(options.seed + index * 2654435761);
  const ballSeed = hash32(mapSeed ^ (playerCount * 2246822519) ^ 0x9e3779b9);
  const randomSeed = hash32(mapSeed ^ ballSeed ^ 0x85ebca6b);
  const random = createRng(randomSeed);
  const map = sim.generateMap(mapSeed, complexity, structure);
  const balls = sim.createBalls(createPlayers(playerCount, sim), ballSeed);
  const pulses = [];
  const finishOrder = [];
  const lowComplexity = complexity <= 2;
  const limitSeconds = lowComplexity ? options.lowMaxSeconds : options.maxSeconds;
  const frameLimit = Math.ceil(limitSeconds * FPS);
  const samples = [];
  let frame = 0;

  setRandom(random);

  for (; frame <= frameLimit; frame += 1) {
    sim.stepSimulation(
      balls,
      map,
      1,
      frame / FPS,
      (entry) => finishOrder.push({ ...entry, frame }),
      pulses
    );

    if (finishOrder.length === balls.length) {
      break;
    }

    if (options.trace && frame % FPS === 0) {
      samples.push(
        balls.map((ball) => ({
          finished: ball.finished,
          name: ball.name,
          vx: Number(ball.vx.toFixed(2)),
          vy: Number(ball.vy.toFixed(2)),
          x: Number(ball.x.toFixed(1)),
          y: Number(ball.y.toFixed(1)),
        }))
      );
    }
  }

  const lastFrame =
    finishOrder.length === balls.length
      ? Math.max(...finishOrder.map((entry) => entry.frame))
      : frameLimit + 1;
  const lastSeconds = lastFrame / FPS;
  const failed = finishOrder.length !== balls.length || lastSeconds > limitSeconds;
  const key = String(complexity);
  const aggregate = aggregates.byComplexity[key] ?? {
    completed: 0,
    failed: 0,
    maxSeconds: 0,
    totalSeconds: 0,
  };

  aggregate.completed += failed ? 0 : 1;
  aggregate.failed += failed ? 1 : 0;
  aggregate.maxSeconds = Math.max(aggregate.maxSeconds, lastSeconds);
  aggregate.totalSeconds += Math.min(lastSeconds, limitSeconds);
  aggregates.byComplexity[key] = aggregate;
  aggregates.totalBalls += balls.length;
  aggregates.totalFrames += Math.min(frame, frameLimit + 1) * balls.length;

  if (!failed) {
    return null;
  }

  let slowest = balls[0];
  for (const ball of balls) {
    if (!ball.finished && slowest.finished) {
      slowest = ball;
    } else if (!ball.finished && ball.y < slowest.y) {
      slowest = ball;
    } else if (ball.finished === slowest.finished && ball.y < slowest.y) {
      slowest = ball;
    }
  }

  const point = { x: slowest?.x ?? 0, y: slowest?.y ?? 0 };
  const nearby = [
    ...map.walls.map((wall) => ({
      distance: distanceToSegment(point, wall),
      id: wall.id,
      type: "wall",
    })),
    ...map.pins.map((pin) => ({
      distance: Math.hypot(point.x - pin.x, point.y - pin.y) - pin.radius,
      id: pin.id,
      type: "pin",
    })),
    ...map.bumpers.map((bumper) => ({
      distance: Math.hypot(point.x - bumper.x, point.y - bumper.y) - bumper.radius,
      id: bumper.id,
      type: "bumper",
    })),
    ...map.exploders.map((exploder) => ({
      distance: Math.hypot(point.x - exploder.x, point.y - exploder.y) - exploder.radius,
      id: exploder.id,
      type: "exploder",
    })),
    ...map.boosters.map((booster) => ({
      distance: distanceToSegment(point, booster),
      id: booster.id,
      type: "booster",
    })),
  ]
    .sort((a, b) => a.distance - b.distance)
    .slice(0, 8)
    .map((item) => ({
      ...item,
      distance: Number(item.distance.toFixed(1)),
    }));

  return {
    actualStructure: map.structure,
    ballSeed,
    complexity,
    finished: finishOrder.length,
    index,
    lastSeconds,
    limitSeconds,
    mapSeed,
    playerCount,
    slowestName: slowest?.name ?? "unknown",
    slowestX: slowest?.x ?? 0,
    slowestY: slowest?.y ?? 0,
    structure,
    nearby,
    samples,
  };
}

function main() {
  const options = parseArgs(process.argv.slice(2));
  const { api: sim, setRandom } = loadSimulationApi();
  const startedAt = Date.now();
  const failures = [];
  const aggregates = {
    byComplexity: {},
    totalBalls: 0,
    totalFrames: 0,
  };
  let completedTrials = 0;

  for (
    let offset = 0;
    options.targetBalls > 0
      ? aggregates.totalBalls < options.targetBalls
      : offset < options.trials;
    offset += 1
  ) {
    const index = options.startIndex + offset;
    const failure = runTrial(sim, setRandom, options, index, aggregates);
    completedTrials = offset + 1;

    if (failure) {
      failures.push(failure);
      if (options.failFast) {
        break;
      }
    }

    if (
      options.progressEvery > 0 &&
      (index + 1) % options.progressEvery === 0
    ) {
      const elapsed = (Date.now() - startedAt) / 1000;
      const targetLabel =
        options.targetBalls > 0
          ? ` targetBalls=${aggregates.totalBalls}/${options.targetBalls}`
          : "";
      console.log(
        `progress trials=${index + 1}/${options.trials}${targetLabel} failures=${failures.length} elapsed=${elapsed.toFixed(1)}s`
      );
    }
  }

  const elapsed = (Date.now() - startedAt) / 1000;
  console.log(
    JSON.stringify(
      {
        aggregates,
        elapsedSeconds: Number(elapsed.toFixed(2)),
        failureCount: failures.length,
        firstFailures: failures.slice(0, 10).map(summarizeFailure),
        options,
      passed: failures.length === 0,
      trialsCompleted: options.failFast && failures.length > 0
          ? failures[failures.length - 1].index - options.startIndex + 1
          : completedTrials,
        tracedFailures: options.trace ? failures.slice(0, 3) : undefined,
      },
      null,
      2
    )
  );

  if (failures.length > 0) {
    process.exitCode = 1;
  }
}

main();

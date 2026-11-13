import {
  GRID_SIZE,
  SENSOR_RADIUS,
  TileType,
  EnemyInfo,
  Tank,
  PortalPair,
} from './types';

/**
 * Converts Oxy game coordinates (x in [0, 30], y in [0, 30], origin (0,0) at bottom-left)
 * to HTML5 Canvas pixel coordinates (origin at top-left of the island viewport).
 */
export function oxyToCanvas(
  x: number,
  y: number,
  islandPxSize: number,
  offsetLeftPx = 0,
  offsetTopPx = 0
): { cx: number; cy: number } {
  const scale = islandPxSize / GRID_SIZE;
  const cx = offsetLeftPx + x * scale;
  const cy = offsetTopPx + (GRID_SIZE - y) * scale;
  return { cx, cy };
}

/**
 * Converts HTML5 Canvas pixel coordinates back to continuous Oxy coordinates (x, y).
 */
export function canvasToOxy(
  cx: number,
  cy: number,
  islandPxSize: number,
  offsetLeftPx = 0,
  offsetTopPx = 0
): { x: number; y: number } {
  const scale = islandPxSize / GRID_SIZE;
  const x = (cx - offsetLeftPx) / scale;
  const y = GRID_SIZE - (cy - offsetTopPx) / scale;
  return { x, y };
}

/**
 * Returns the terrain type at integer grid coordinates (gx, gy).
 * Out of [0, 30) x [0, 30) is Deep Ocean (-1).
 */
export function getGridTypeAt(grid: TileType[][], gx: number, gy: number): TileType {
  const ix = Math.floor(gx);
  const iy = Math.floor(gy);
  if (ix < 0 || ix >= GRID_SIZE || iy < 0 || iy >= GRID_SIZE) {
    return TileType.OCEAN;
  }
  return grid[iy][ix];
}

/**
 * Converts direction string ("E", "NE", "N", "NW", "W", "SW", "S", "SE") or angle to degrees 0..360.
 */
export function parseDirectionDegrees(dir: number | string): number {
  if (typeof dir === 'number') {
    return ((dir % 360) + 360) % 360;
  }
  const normalized = String(dir).trim().toUpperCase();
  const map: Record<string, number> = {
    E: 0,
    NE: 45,
    N: 90,
    NW: 135,
    W: 180,
    SW: 225,
    S: 270,
    SE: 315,
  };
  if (normalized in map) {
    return map[normalized];
  }
  const num = Number(normalized);
  if (!Number.isNaN(num)) {
    return ((num % 360) + 360) % 360;
  }
  return 0;
}

/**
 * Computes integer angle [0..360) from (x1, y1) to (x2, y2) in Oxy where 0 = East (+X), 90 = North (+Y).
 */
export function computeOxyAngle(x1: number, y1: number, x2: number, y2: number): number {
  const dx = x2 - x1;
  const dy = y2 - y1;
  const rad = Math.atan2(dy, dx);
  const deg = Math.round((rad * 180) / Math.PI);
  return ((deg % 360) + 360) % 360;
}

/**
 * Raycasts between (x1, y1) and (x2, y2) across the 30x30 grid.
 * Returns:
 * - 0: Blocked by Brick Wall (1) or out of sensor range (20.0 units)
 * - 1: Clear Line of Sight
 * - 2: Obstructed by Wooden Crate (2) or Rock Boulder (3) (but no Brick Wall)
 */
export function raycastLineOfSight(
  grid: TileType[][],
  x1: number,
  y1: number,
  x2: number,
  y2: number,
  maxRadius = SENSOR_RADIUS
): { status: 0 | 1 | 2; dist: number; angle: number } {
  const dx = x2 - x1;
  const dy = y2 - y1;
  const dist = Math.hypot(dx, dy);
  if (dist > maxRadius) {
    return { status: 0, dist, angle: -1 };
  }

  const angle = computeOxyAngle(x1, y1, x2, y2);
  const samples = Math.max(12, Math.ceil(dist * 10));
  let hasObstacle = false;

  const startCellX = Math.floor(x1);
  const startCellY = Math.floor(y1);
  const endCellX = Math.floor(x2);
  const endCellY = Math.floor(y2);

  for (let i = 1; i < samples; i++) {
    const t = i / samples;
    const sx = x1 + dx * t;
    const sy = y1 + dy * t;
    const gx = Math.floor(sx);
    const gy = Math.floor(sy);

    if ((gx === startCellX && gy === startCellY) || (gx === endCellX && gy === endCellY)) {
      continue;
    }

    const tile = getGridTypeAt(grid, gx, gy);
    if (tile === TileType.BRICK) {
      return { status: 0, dist, angle: -1 };
    }
    if (tile === TileType.CRATE || tile === TileType.BOULDER) {
      hasObstacle = true;
    }
  }

  return {
    status: hasObstacle ? 2 : 1,
    dist: Number(dist.toFixed(2)),
    angle,
  };
}

/**
 * Scans all other living tanks and returns visible enemies (status 1 or 2) sorted by Euclidean distance.
 */
export function scanVisibleEnemies(
  self: Tank,
  allTanks: Tank[],
  grid: TileType[][]
): EnemyInfo[] {
  const results: EnemyInfo[] = [];
  for (const other of allTanks) {
    if (other.id === self.id || !other.alive || other.hp <= 0) continue;
    const los = raycastLineOfSight(grid, self.x, self.y, other.x, other.y, SENSOR_RADIUS);
    if (los.status === 1 || los.status === 2) {
      results.push({
        id: other.id,
        x: Number(other.x.toFixed(2)),
        y: Number(other.y.toFixed(2)),
        hp: other.hp,
        angle: los.angle,
        dist: los.dist,
        status: los.status,
      });
    }
  }
  results.sort((a, b) => a.dist - b.dist);
  return results;
}

/**
 * Finds the nearest walkable tile center (gx + 0.5, gy + 0.5) when Phase Shift ends inside an obstacle.
 */
export function findNearestEmptyTileCenter(
  grid: TileType[][],
  x: number,
  y: number
): { x: number; y: number } {
  const startGx = Math.max(0, Math.min(GRID_SIZE - 1, Math.floor(x)));
  const startGy = Math.max(0, Math.min(GRID_SIZE - 1, Math.floor(y)));

  const isWalkable = (gx: number, gy: number) => {
    const t = getGridTypeAt(grid, gx, gy);
    return t === TileType.EMPTY || t === TileType.PORTAL;
  };

  if (isWalkable(startGx, startGy)) {
    return { x: startGx + 0.5, y: startGy + 0.5 };
  }

  let bestGx = startGx;
  let bestGy = startGy;
  let bestDist = Infinity;

  for (let gy = 0; gy < GRID_SIZE; gy++) {
    for (let gx = 0; gx < GRID_SIZE; gx++) {
      if (isWalkable(gx, gy)) {
        const d = Math.hypot(gx + 0.5 - x, gy + 0.5 - y);
        if (d < bestDist) {
          bestDist = d;
          bestGx = gx;
          bestGy = gy;
        }
      }
    }
  }

  return { x: bestGx + 0.5, y: bestGy + 0.5 };
}

/**
 * 8-Directional A* Pathfinding from tank's current cell to target cell (targetGx, targetGy).
 * - Automatically evaluates Teleporter Pairs (4) as instant shortcuts when active.
 * - Avoids accidentally stepping onto an active portal when walking past it to a nearby tile.
 * - Supports mode: "SHORTEST" or "SAFEST" and avoidEnemy: boolean.
 */
export function findPath8Dir(
  grid: TileType[][],
  allTanks: Tank[],
  self: Tank,
  targetGx: number,
  targetGy: number,
  avoidEnemy = false,
  mode: string = 'SHORTEST',
  portals: PortalPair[] = []
): Array<{ x: number; y: number }> {
  const tx = Math.max(0, Math.min(GRID_SIZE - 1, Math.floor(targetGx)));
  const ty = Math.max(0, Math.min(GRID_SIZE - 1, Math.floor(targetGy)));
  const sx = Math.max(0, Math.min(GRID_SIZE - 1, Math.floor(self.x)));
  const sy = Math.max(0, Math.min(GRID_SIZE - 1, Math.floor(self.y)));

  const startCenter = { x: sx + 0.5, y: sy + 0.5 };
  if (sx === tx && sy === ty) {
    return [startCenter];
  }

  const phaseShift = self.skillId === 1 && self.activeSkillTimer > 0;
  const safestMode = String(mode).toUpperCase() === 'SAFEST';
  const enemies = allTanks.filter((t) => t.id !== self.id && t.alive && t.hp > 0);
  const activePortals = portals.filter((p) => p.cooldown <= 0);

  // Admissible heuristic accounting for active teleporter shortcuts
  const computeHeuristic = (x: number, y: number): number => {
    let best = Math.hypot(tx - x, ty - y);
    for (const p of activePortals) {
      const viaAB = Math.hypot(p.a.gx - x, p.a.gy - y) + Math.hypot(tx - p.b.gx, ty - p.b.gy);
      const viaBA = Math.hypot(p.b.gx - x, p.b.gy - y) + Math.hypot(tx - p.a.gx, ty - p.a.gy);
      if (viaAB < best) best = viaAB;
      if (viaBA < best) best = viaBA;
    }
    return best;
  };

  // Lookup whether (gx, gy) is an active portal entrance
  const getActivePortalTwin = (gx: number, gy: number): { gx: number; gy: number } | null => {
    for (const p of activePortals) {
      if (p.a.gx === gx && p.a.gy === gy) return p.b;
      if (p.b.gx === gx && p.b.gy === gy) return p.a;
    }
    return null;
  };

  const isCellPassable = (gx: number, gy: number) => {
    if (gx < 0 || gx >= GRID_SIZE || gy < 0 || gy >= GRID_SIZE) return false;
    if (phaseShift) return true;
    const tile = grid[gy][gx];
    return tile === TileType.EMPTY || tile === TileType.PORTAL;
  };

  const dirs = [
    { dx: 1, dy: 0, cost: 1.0 },
    { dx: -1, dy: 0, cost: 1.0 },
    { dx: 0, dy: 1, cost: 1.0 },
    { dx: 0, dy: -1, cost: 1.0 },
    { dx: 1, dy: 1, cost: 1.414 },
    { dx: -1, dy: 1, cost: 1.414 },
    { dx: 1, dy: -1, cost: 1.414 },
    { dx: -1, dy: -1, cost: 1.414 },
  ];

  const key = (x: number, y: number) => y * GRID_SIZE + x;
  const gScore = new Float64Array(GRID_SIZE * GRID_SIZE).fill(Infinity);
  const parent = new Int32Array(GRID_SIZE * GRID_SIZE).fill(-1);
  const closed = new Uint8Array(GRID_SIZE * GRID_SIZE);

  const open: Array<{ x: number; y: number; f: number }> = [];
  const startKey = key(sx, sy);
  gScore[startKey] = 0;
  open.push({ x: sx, y: sy, f: computeHeuristic(sx, sy) });

  let bestReachedKey = startKey;
  let bestHeuristic = computeHeuristic(sx, sy);

  while (open.length > 0) {
    open.sort((a, b) => a.f - b.f);
    const current = open.shift()!;
    const cKey = key(current.x, current.y);
    if (closed[cKey]) continue;
    closed[cKey] = 1;

    const hToTarget = computeHeuristic(current.x, current.y);
    if (hToTarget < bestHeuristic) {
      bestHeuristic = hToTarget;
      bestReachedKey = cKey;
    }

    if (current.x === tx && current.y === ty) {
      bestReachedKey = cKey;
      break;
    }

    // Check if current cell is an active portal that teleports the tank upon entry.
    // Note: if current cell is the start cell (sx, sy) OR is the twin portal we JUST teleported into,
    // we expand normal walking neighbors so the tank walks off the portal.
    // Otherwise, stepping onto an active portal immediately teleports to its twin!
    const twin = getActivePortalTwin(current.x, current.y);
    const parentKey = parent[cKey];
    const twinKey = twin ? key(twin.gx, twin.gy) : -1;
    const justTeleportedHere = parentKey !== -1 && parentKey === twinKey;
    const isStartCell = current.x === sx && current.y === sy;

    if (twin && !isStartCell && !justTeleportedHere) {
      // Stepping onto this portal cell teleports directly to `twin`
      if (!closed[twinKey]) {
        const teleportCost = 0.05;
        const tentativeG = gScore[cKey] + teleportCost;
        if (tentativeG < gScore[twinKey]) {
          gScore[twinKey] = tentativeG;
          parent[twinKey] = cKey;
          open.push({
            x: twin.gx,
            y: twin.gy,
            f: tentativeG + computeHeuristic(twin.gx, twin.gy),
          });
        }
      }
      // Do NOT expand normal walking neighbors from an active portal entrance
      // because the tank cannot walk across an active portal without being teleported!
      continue;
    }

    for (const d of dirs) {
      const nx = current.x + d.dx;
      const ny = current.y + d.dy;
      if (!isCellPassable(nx, ny)) continue;

      // Prevent corner clipping on diagonal steps unless phase shift is active
      if (d.dx !== 0 && d.dy !== 0 && !phaseShift) {
        if (!isCellPassable(current.x + d.dx, current.y) || !isCellPassable(current.x, current.y + d.dy)) {
          continue;
        }
        // Also avoid diagonal corner-grazing across an active portal cell
        if (getActivePortalTwin(current.x + d.dx, current.y) || getActivePortalTwin(current.x, current.y + d.dy)) {
          continue;
        }
      }

      const nKey = key(nx, ny);
      if (closed[nKey]) continue;

      let stepCost = d.cost;

      if (avoidEnemy || safestMode) {
        for (const e of enemies) {
          const distToEnemy = Math.hypot(nx + 0.5 - e.x, ny + 0.5 - e.y);
          if (avoidEnemy && distToEnemy < 4.5) {
            stepCost += (5.0 - distToEnemy) * 4.0;
          } else if (safestMode && distToEnemy < 8.0) {
            stepCost += (8.5 - distToEnemy) * 1.8;
          }
        }
      }

      if (safestMode) {
        const edgeDist = Math.min(nx, ny, GRID_SIZE - 1 - nx, GRID_SIZE - 1 - ny);
        if (edgeDist < 2) {
          stepCost += (2 - edgeDist) * 2.5;
        }
      }

      const tentativeG = gScore[cKey] + stepCost;
      if (tentativeG < gScore[nKey]) {
        gScore[nKey] = tentativeG;
        parent[nKey] = cKey;
        const f = tentativeG + computeHeuristic(nx, ny);
        open.push({ x: nx, y: ny, f });
      }
    }
  }

  const waypoints: Array<{ x: number; y: number }> = [];
  let cur = bestReachedKey;
  while (cur !== -1 && cur !== startKey) {
    const cx = cur % GRID_SIZE;
    const cy = Math.floor(cur / GRID_SIZE);
    waypoints.push({ x: cx + 0.5, y: cy + 0.5 });
    cur = parent[cur];
  }
  waypoints.reverse();

  // Always first center on current grid cell if not already very close
  if (Math.hypot(self.x - startCenter.x, self.y - startCenter.y) > 0.08) {
    waypoints.unshift(startCenter);
  }

  return waypoints.length > 0 ? waypoints : [startCenter];
}

/**
 * Simulates a bullet trajectory at `angleDeg` up to 2 bounces on Brick Walls (1)
 * to find an optimal firing angle for `autoFire(count, "RICOCHET")`.
 */
export function findRicochetAngle(
  grid: TileType[][],
  shooterX: number,
  shooterY: number,
  targetX: number,
  targetY: number
): number {
  const directAngle = computeOxyAngle(shooterX, shooterY, targetX, targetY);
  const directLos = raycastLineOfSight(grid, shooterX, shooterY, targetX, targetY, SENSOR_RADIUS);
  if (directLos.status === 1) {
    return directAngle;
  }

  let bestAngle = directAngle;
  let bestMissDist = Infinity;

  // Search candidate angles every 5 degrees for a 1- or 2-bounce brick reflection that reaches target
  for (let deg = 0; deg < 360; deg += 5) {
    const rad = (deg * Math.PI) / 180;
    let bx = shooterX;
    let by = shooterY;
    let vx = Math.cos(rad);
    let vy = Math.sin(rad);
    let bounces = 0;
    const step = 0.2;

    for (let s = 0; s < 110; s++) {
      const nx = bx + vx * step;
      const ny = by + vy * step;
      if (nx < 0 || nx >= GRID_SIZE || ny < 0 || ny >= GRID_SIZE) break;

      const dToTarget = Math.hypot(nx - targetX, ny - targetY);
      if (bounces >= 1 && dToTarget < bestMissDist) {
        bestMissDist = dToTarget;
        bestAngle = deg;
        if (dToTarget < 0.65) {
          return deg;
        }
      }

      const tile = getGridTypeAt(grid, nx, ny);
      if (tile === TileType.CRATE || tile === TileType.BOULDER) {
        break; // Absorbed by destructible obstacle
      }
      if (tile === TileType.BRICK) {
        bounces++;
        if (bounces > 2) break;
        const prevGx = Math.floor(bx);
        const prevGy = Math.floor(by);
        const newGx = Math.floor(nx);
        const newGy = Math.floor(ny);
        if (newGx !== prevGx) vx = -vx;
        if (newGy !== prevGy) vy = -vy;
      } else {
        bx = nx;
        by = ny;
      }
    }
  }

  return bestAngle;
}

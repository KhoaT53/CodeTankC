import {
  GRID_SIZE,
  MAX_HP,
  MAX_AMMO,
  RELOAD_DURATION,
  FIRE_COOLDOWN,
  BASE_MOVE_SPEED,
  BULLET_SPEED,
  DASH_DISTANCE,
  DASH_DURATION,
  DASH_COOLDOWN,
  SKILL_COOLDOWN,
  PORTAL_COOLDOWN,
  COMPILE_COOLDOWN,
  MAX_MAP_ITEMS,
  INSTANT_SHOOT_COOLDOWN,
  TileType,
  SkillId,
  ItemType,
  Tank,
  PortalPair,
  GameWorldState,
  Particle,
  CompetitorConfig,
  MapItem,
} from './types';
import {
  getGridTypeAt,
  parseDirectionDegrees,
  scanVisibleEnemies,
  findNearestEmptyTileCenter,
  findPath8Dir,
  findRicochetAngle,
} from './mathAndPathfinding';
import { compileCppSource, CppRuntime, CppApiBindings } from './cppInterpreter';
import {
  PLAYER_STARTER_CODE,
  BOT_EASY_CODE,
  BOT_MEDIUM_CODE,
  BOT_HARD_CODE,
} from './presets';
import { soundFX } from './audio';

const PARTICLE_POOL_SIZE = 160;

function createParticlePool(): Particle[] {
  const pool: Particle[] = [];
  for (let i = 0; i < PARTICLE_POOL_SIZE; i++) {
    pool.push({
      active: false,
      x: 0,
      y: 0,
      vx: 0,
      vy: 0,
      life: 0,
      maxLife: 1,
      color: '#ffffff',
      size: 3,
    });
  }
  return pool;
}

export function spawnParticles(
  world: GameWorldState,
  x: number,
  y: number,
  color: string,
  count: number,
  speed = 4.0,
  size = 3.5
): void {
  let spawned = 0;
  for (const p of world.particles) {
    if (!p.active) {
      const angle = Math.random() * Math.PI * 2;
      const spd = (0.3 + Math.random() * 0.7) * speed;
      p.active = true;
      p.x = x;
      p.y = y;
      p.vx = Math.cos(angle) * spd;
      p.vy = Math.sin(angle) * spd;
      p.maxLife = 0.25 + Math.random() * 0.25;
      p.life = p.maxLife;
      p.color = color;
      p.size = size;
      spawned++;
      if (spawned >= count) break;
    }
  }
}

export function addFloatingText(
  world: GameWorldState,
  x: number,
  y: number,
  text: string,
  color: string
): void {
  world.floatingTexts.push({
    id: `${Date.now()}-${Math.random()}`,
    x,
    y,
    text,
    color,
    life: 1.1,
    maxLife: 1.1,
  });
  if (world.floatingTexts.length > 24) {
    world.floatingTexts.shift();
  }
}

export function addConsoleLog(
  world: GameWorldState,
  tankName: string,
  type: 'INFO' | 'COMPILE' | 'OVERRIDE' | 'ERROR' | 'COMBAT',
  message: string
): void {
  const mins = Math.floor(world.matchTime / 60);
  const secs = Math.floor(world.matchTime % 60);
  const time = `${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
  world.logs.unshift({
    id: `${Date.now()}-${Math.random()}`,
    time,
    tankName,
    type,
    message,
  });
  if (world.logs.length > 60) {
    world.logs.pop();
  }
}

export function createInitialIslandMap(): {
  grid: TileType[][];
  obstacleHp: number[][];
  bushes: boolean[][];
  portals: PortalPair[];
} {
  const grid: TileType[][] = Array.from({ length: GRID_SIZE }, () =>
    Array.from({ length: GRID_SIZE }, () => TileType.EMPTY)
  );
  const obstacleHp: number[][] = Array.from({ length: GRID_SIZE }, () =>
    Array.from({ length: GRID_SIZE }, () => 0)
  );
  const bushes: boolean[][] = Array.from({ length: GRID_SIZE }, () =>
    Array.from({ length: GRID_SIZE }, () => false)
  );

  // Symmetric tactical Brick Walls (1) for ricochet angles & cover
  const brickCoords: Array<[number, number]> = [
    // Inner tactical L-walls around center (14..15, 14..15)
    [11, 11], [12, 11], [11, 12],
    [18, 11], [17, 11], [18, 12],
    [11, 18], [12, 18], [11, 17],
    [18, 18], [17, 18], [18, 17],
    // Outer quadrant cover walls
    [6, 9], [7, 9], [8, 9],
    [21, 9], [22, 9], [23, 9],
    [6, 20], [7, 20], [8, 20],
    [21, 20], [22, 20], [23, 20],
    [9, 6], [9, 7],
    [20, 6], [20, 7],
    [9, 22], [9, 23],
    [20, 22], [20, 23],
  ];
  for (const [gx, gy] of brickCoords) {
    grid[gy][gx] = TileType.BRICK;
  }

  // Destructible Wooden Crates (2) -> 2 HP
  const crateCoords: Array<[number, number]> = [
    [14, 10], [15, 10],
    [14, 19], [15, 19],
    [10, 14], [10, 15],
    [19, 14], [19, 15],
    [5, 14], [24, 15],
    [14, 5], [15, 24],
    [8, 12], [21, 12],
    [8, 17], [21, 17],
  ];
  for (const [gx, gy] of crateCoords) {
    grid[gy][gx] = TileType.CRATE;
    obstacleHp[gy][gx] = 2;
  }

  // Destructible Rock Boulders (3) -> 4 HP
  const boulderCoords: Array<[number, number]> = [
    [13, 13], [16, 16],
    [13, 16], [16, 13],
    [7, 15], [22, 14],
    [15, 7], [14, 22],
    [5, 5], [24, 5], [5, 24], [24, 24],
  ];
  for (const [gx, gy] of boulderCoords) {
    grid[gy][gx] = TileType.BOULDER;
    obstacleHp[gy][gx] = 4;
  }

  // 2 Teleporter Pairs (4): Blue Pair & Purple Pair
  const portals: PortalPair[] = [
    {
      pairId: 0,
      color: '#38bdf8', // Neon Cyan-Blue
      a: { gx: 4, gy: 14 },
      b: { gx: 25, gy: 15 },
      cooldown: 0,
    },
    {
      pairId: 1,
      color: '#c084fc', // Neon Purple
      a: { gx: 14, gy: 4 },
      b: { gx: 15, gy: 25 },
      cooldown: 0,
    },
  ];
  for (const p of portals) {
    grid[p.a.gy][p.a.gx] = TileType.PORTAL;
    grid[p.b.gy][p.b.gx] = TileType.PORTAL;
  }

  return { grid, obstacleHp, bushes, portals };
}

export const DEFAULT_COMPETITOR_CONFIGS: CompetitorConfig[] = [
  {
    id: 2,
    name: 'BOT ALPHA (DỄ)',
    skillId: SkillId.OVERDRIVE,
    mainCode: BOT_EASY_CODE,
  },
  {
    id: 3,
    name: 'BOT BRAVO (VỪA)',
    skillId: SkillId.INFINITE_AMMO,
    mainCode: BOT_MEDIUM_CODE,
  },
  {
    id: 4,
    name: 'BOT OMEGA (KHÓ)',
    skillId: SkillId.KNOCKBACK_AMMO,
    mainCode: BOT_HARD_CODE,
  },
];

export function createInitialWorldState(
  playerSkillId: SkillId = SkillId.BLINK,
  playerMainCode: string = PLAYER_STARTER_CODE,
  mode: 'OFFLINE' | 'ONLINE' = 'OFFLINE',
  roomCode = 'OXY-3030',
  competitorConfigs: CompetitorConfig[] = DEFAULT_COMPETITOR_CONFIGS
): GameWorldState {
  const { grid, obstacleHp, bushes, portals } = createInitialIslandMap();

  const bot2 = competitorConfigs.find((c) => c.id === 2) ?? DEFAULT_COMPETITOR_CONFIGS[0];
  const bot3 = competitorConfigs.find((c) => c.id === 3) ?? DEFAULT_COMPETITOR_CONFIGS[1];
  const bot4 = competitorConfigs.find((c) => c.id === 4) ?? DEFAULT_COMPETITOR_CONFIGS[2];

  const tanks: Tank[] = [
    {
      id: 1,
      name: 'YOU (TANK #1)',
      isPlayer: true,
      color: '#10b981', // Emerald Military Green
      turretColor: '#a7f3d0',
      x: 3.5,
      y: 3.5, // Bottom-left Oxy spawn
      hullAngle: 45,
      turretAngle: 45,
      hp: MAX_HP,
      maxHp: MAX_HP,
      ammo: MAX_AMMO,
      maxAmmo: MAX_AMMO,
      alive: true,
      deathAnimTimer: 0,
      hitFlashTimer: 0,
      reloadTimer: 0,
      fireCooldown: 0,
      dashCooldown: 0,
      dashTimer: 0,
      dashDirDeg: 0,
      skillId: playerSkillId,
      skillCooldown: 0,
      activeSkillTimer: 0,
      knockbackBulletsBuff: 0,
      mainCode: playerMainCode,
      overrideCode: '',
      compileTimer: 0,
      pendingOverrideCode: null,
      executingOverride: false,
      actionQueue: [],
      overrideQueue: [],
      globals: {},
      setupDone: false,
      lastError: null,
      kills: 0,
      damageDealt: 0,
      shotsFired: 0,
    },
    {
      id: 2,
      name: bot2.name,
      isPlayer: false,
      difficulty: 'EASY',
      color: '#3b82f6', // Tactical Blue
      turretColor: '#bfdbfe',
      x: 3.5,
      y: 26.5, // Top-left Oxy spawn
      hullAngle: 315,
      turretAngle: 315,
      hp: MAX_HP,
      maxHp: MAX_HP,
      ammo: MAX_AMMO,
      maxAmmo: MAX_AMMO,
      alive: true,
      deathAnimTimer: 0,
      hitFlashTimer: 0,
      reloadTimer: 0,
      fireCooldown: 0,
      dashCooldown: 0,
      dashTimer: 0,
      dashDirDeg: 0,
      skillId: bot2.skillId,
      skillCooldown: 0,
      activeSkillTimer: 0,
      knockbackBulletsBuff: 0,
      mainCode: bot2.mainCode,
      overrideCode: '',
      compileTimer: 0,
      pendingOverrideCode: null,
      executingOverride: false,
      actionQueue: [],
      overrideQueue: [],
      globals: {},
      setupDone: false,
      lastError: null,
      kills: 0,
      damageDealt: 0,
      shotsFired: 0,
    },
    {
      id: 3,
      name: bot3.name,
      isPlayer: false,
      difficulty: 'MEDIUM',
      color: '#f59e0b', // Desert Amber
      turretColor: '#fde68a',
      x: 26.5,
      y: 26.5, // Top-right Oxy spawn
      hullAngle: 225,
      turretAngle: 225,
      hp: MAX_HP,
      maxHp: MAX_HP,
      ammo: MAX_AMMO,
      maxAmmo: MAX_AMMO,
      alive: true,
      deathAnimTimer: 0,
      hitFlashTimer: 0,
      reloadTimer: 0,
      fireCooldown: 0,
      dashCooldown: 0,
      dashTimer: 0,
      dashDirDeg: 0,
      skillId: bot3.skillId,
      skillCooldown: 0,
      activeSkillTimer: 0,
      knockbackBulletsBuff: 0,
      mainCode: bot3.mainCode,
      overrideCode: '',
      compileTimer: 0,
      pendingOverrideCode: null,
      executingOverride: false,
      actionQueue: [],
      overrideQueue: [],
      globals: {},
      setupDone: false,
      lastError: null,
      kills: 0,
      damageDealt: 0,
      shotsFired: 0,
    },
    {
      id: 4,
      name: bot4.name,
      isPlayer: false,
      difficulty: 'HARD',
      color: '#ef4444', // Crimson Elite
      turretColor: '#fecaca',
      x: 26.5,
      y: 3.5, // Bottom-right Oxy spawn
      hullAngle: 135,
      turretAngle: 135,
      hp: MAX_HP,
      maxHp: MAX_HP,
      ammo: MAX_AMMO,
      maxAmmo: MAX_AMMO,
      alive: true,
      deathAnimTimer: 0,
      hitFlashTimer: 0,
      reloadTimer: 0,
      fireCooldown: 0,
      dashCooldown: 0,
      dashTimer: 0,
      dashDirDeg: 0,
      skillId: bot4.skillId,
      skillCooldown: 0,
      activeSkillTimer: 0,
      knockbackBulletsBuff: 0,
      mainCode: bot4.mainCode,
      overrideCode: '',
      compileTimer: 0,
      pendingOverrideCode: null,
      executingOverride: false,
      actionQueue: [],
      overrideQueue: [],
      globals: {},
      setupDone: false,
      lastError: null,
      kills: 0,
      damageDealt: 0,
      shotsFired: 0,
    },
  ];

  // Items do NOT spawn fixed at start; they spawn randomly over time (max 3 concurrent items)
  const items: MapItem[] = [];

  const world: GameWorldState = {
    shellState: 'title',
    mode,
    roomCode,
    matchTime: 0,
    itemSpawnTimer: 3.5,
    hitstopTimer: 0,
    screenShake: 0,
    grid,
    obstacleHp,
    bushes,
    portals,
    items,
    tanks,
    bullets: [],
    particles: createParticlePool(),
    floatingTexts: [],
    logs: [],
    winnerId: null,
  };

  addConsoleLog(
    world,
    'HỆ THỐNG',
    'INFO',
    'Khởi tạo bản đồ Đảo Oxy 30x30 hoàn tất. Gốc tọa độ (0,0) ở Góc Dưới-Trái.'
  );

  return world;
}

/**
 * Triggers a 2.5s Compile Cooldown for Live Override on a tank.
 */
export function triggerLiveOverride(
  world: GameWorldState,
  tankId: number,
  snippetCode: string
): { ok: boolean; error?: string } {
  const tank = world.tanks.find((t) => t.id === tankId);
  if (!tank || !tank.alive) {
    return { ok: false, error: 'Xe tăng không còn hoạt động.' };
  }

  // Validate syntax immediately before starting the 2.5s compile timer
  try {
    compileCppSource(snippetCode);
  } catch (err: any) {
    const msg = err?.message || 'Lỗi cú pháp C++';
    tank.lastError = msg;
    addConsoleLog(world, tank.name, 'ERROR', `Lỗi biên dịch Ghi Đè: ${msg}`);
    return { ok: false, error: msg };
  }

  tank.lastError = null;
  tank.pendingOverrideCode = snippetCode;
  tank.compileTimer = COMPILE_COOLDOWN;
  addConsoleLog(
    world,
    tank.name,
    'COMPILE',
    `Đang biên dịch lệnh Ghi Đè Trực Tiếp (Chờ ${COMPILE_COOLDOWN.toFixed(1)}s)...`
  );
  addFloatingText(world, tank.x, tank.y + 0.8, 'Compiling 1.0s...', '#38bdf8');
  return { ok: true };
}

/**
 * Fires a single bullet from `tank` at `angleDeg` if allowed by ammo and 0.5s fire rate.
 */
function fireTankBullet(world: GameWorldState, tank: Tank, angleDeg: number): boolean {
  if (!tank.alive || tank.fireCooldown > 0) return false;
  const infiniteAmmo = tank.skillId === SkillId.INFINITE_AMMO && tank.activeSkillTimer > 0;
  if (!infiniteAmmo && tank.reloadTimer > 0) return false;
  if (!infiniteAmmo && tank.ammo <= 0) return false;

  const normAngle = ((Math.round(angleDeg) % 360) + 360) % 360;
  tank.turretAngle = normAngle;
  tank.fireCooldown = FIRE_COOLDOWN;
  if (!infiniteAmmo) {
    tank.ammo = Math.max(0, tank.ammo - 1);
  }

  const hasKnockback =
    (tank.skillId === SkillId.KNOCKBACK_AMMO && tank.activeSkillTimer > 0) ||
    tank.knockbackBulletsBuff > 0;
  if (tank.knockbackBulletsBuff > 0 && !(tank.skillId === SkillId.KNOCKBACK_AMMO && tank.activeSkillTimer > 0)) {
    tank.knockbackBulletsBuff--;
  }

  const rad = (normAngle * Math.PI) / 180;
  const muzzleOffset = 0.48;
  const bx = tank.x + Math.cos(rad) * muzzleOffset;
  const by = tank.y + Math.sin(rad) * muzzleOffset;

  world.bullets.push({
    id: `b-${Date.now()}-${Math.random()}`,
    ownerId: tank.id,
    x: bx,
    y: by,
    vx: Math.cos(rad) * BULLET_SPEED,
    vy: Math.sin(rad) * BULLET_SPEED,
    angleDeg: normAngle,
    bounces: 0,
    hasKnockback,
    color: hasKnockback ? '#f43f5e' : tank.color,
    trail: [{ x: bx, y: by }],
  });

  tank.shotsFired++;
  soundFX.playShoot();
  spawnParticles(world, bx, by, hasKnockback ? '#f43f5e' : '#fbbf24', 5, 3.0, 2.5);
  return true;
}

/**
 * Executes an immediate `moveTo(gx, gy, false, "SHORTEST")` on `tankId` with ZERO compile delay
 * (triggered by double-clicking a cell on the 30x30 island map).
 */
export function executeInstantMoveTo(
  world: GameWorldState,
  tankId: number,
  rawGx: number,
  rawGy: number
): boolean {
  const tank = world.tanks.find((t) => t.id === tankId);
  if (!tank || !tank.alive) return false;

  const gx = Math.max(0, Math.min(GRID_SIZE - 1, Math.floor(rawGx)));
  const gy = Math.max(0, Math.min(GRID_SIZE - 1, Math.floor(rawGy)));

  const waypoints = findPath8Dir(
    world.grid,
    world.tanks,
    tank,
    gx,
    gy,
    false,
    'SHORTEST',
    world.portals
  );
  if (waypoints.length === 0) return false;

  tank.overrideQueue = [
    {
      type: 'MOVE_TO_PATH',
      targetGx: gx,
      targetGy: gy,
      avoidEnemy: false,
      mode: 'SHORTEST',
      waypoints,
      currentIdx: 0,
    },
  ];
  tank.executingOverride = true;

  spawnParticles(world, gx + 0.5, gy + 0.5, '#38bdf8', 8, 2.8, 2.2);
  addFloatingText(world, gx + 0.5, gy + 0.5, `⚡ ĐẾN (${gx},${gy})`, '#38bdf8');
  addConsoleLog(
    world,
    tank.name,
    'OVERRIDE',
    `Điều khiển chuột tức thời: moveTo(${gx}, ${gy}, false, "SHORTEST")`
  );
  return true;
}

/**
 * Fires a single bullet (`shoot(angle)`) from `tankId` aimed directly toward `(targetX, targetY)`
 * in Oxy coordinates with ZERO compile delay (triggered by holding Ctrl + Click on the map).
 */
export function executeInstantShoot(
  world: GameWorldState,
  tankId: number,
  targetX: number,
  targetY: number
): boolean {
  const tank = world.tanks.find((t) => t.id === tankId);
  if (!tank || !tank.alive) return false;

  const dx = targetX - tank.x;
  const dy = targetY - tank.y;
  const angleDeg = ((Math.round((Math.atan2(dy, dx) * 180) / Math.PI) % 360) + 360) % 360;
  tank.turretAngle = angleDeg;

  // Enforce a minimum delay (>= 0.25s) between two consecutive Ctrl + Click shots
  if ((tank.instantShootCooldown ?? 0) > 0) {
    return false;
  }

  const infiniteAmmo = tank.skillId === SkillId.INFINITE_AMMO && tank.activeSkillTimer > 0;
  if (!infiniteAmmo && tank.reloadTimer > 0) {
    addFloatingText(world, tank.x, tank.y + 0.75, 'ĐANG NẠP ĐẠN!', '#f59e0b');
    return false;
  }
  if (!infiniteAmmo && tank.ammo <= 0) {
    tank.reloadTimer = RELOAD_DURATION;
    addFloatingText(world, tank.x, tank.y + 0.75, 'HẾT ĐẠN -> NẠP (2.5s)!', '#fbbf24');
    return false;
  }

  tank.fireCooldown = 0;
  const fired = fireTankBullet(world, tank, angleDeg);
  if (fired) {
    tank.instantShootCooldown = INSTANT_SHOOT_COOLDOWN;
    addFloatingText(world, tank.x, tank.y + 0.75, `🎯 BẮN ${angleDeg}°!`, '#fbbf24');
    addConsoleLog(
      world,
      tank.name,
      'COMBAT',
      `Bắn tức thời hướng chuột (${targetX.toFixed(1)}, ${targetY.toFixed(1)}): shoot(${angleDeg})`
    );
  }
  return fired;
}

/**
 * Builds the C++ API bindings for `tank`, pushing kinetic tasks into `targetQueue`.
 */
function buildTankApiBindings(
  world: GameWorldState,
  tank: Tank,
  targetQueue: Tank['actionQueue']
): CppApiBindings {
  return {
    moveDir: (dir, steps) => {
      const deg = parseDirectionDegrees(dir);
      const dist = Math.max(1, Math.min(30, steps));
      targetQueue.push({ type: 'MOVE_DIR', dirDeg: deg, remainingDist: dist });
    },
    moveTo: (x, y, avoidEnemy = false, mode = 'SHORTEST') => {
      const waypoints = findPath8Dir(
        world.grid,
        world.tanks,
        tank,
        x,
        y,
        avoidEnemy,
        mode,
        world.portals
      );
      if (waypoints.length > 0) {
        targetQueue.push({
          type: 'MOVE_TO_PATH',
          targetGx: x,
          targetGy: y,
          avoidEnemy,
          mode,
          waypoints,
          currentIdx: 0,
        });
      }
    },
    dash: (dir) => {
      if (tank.dashCooldown <= 0 && tank.dashTimer <= 0) {
        tank.dashDirDeg = parseDirectionDegrees(dir);
        tank.hullAngle = tank.dashDirDeg;
        tank.dashTimer = DASH_DURATION;
        tank.dashCooldown = DASH_COOLDOWN;
        spawnParticles(world, tank.x, tank.y, '#38bdf8', 10, 5.0, 3.0);
        addFloatingText(world, tank.x, tank.y + 0.6, 'DASH!', '#38bdf8');
      }
    },
    shoot: (angle) => {
      const normAngle = ((Math.round(angle) % 360) + 360) % 360;
      const infiniteAmmo = tank.skillId === SkillId.INFINITE_AMMO && tank.activeSkillTimer > 0;
      const canFireImmediately =
        targetQueue.length === 0 &&
        tank.fireCooldown <= 0 &&
        (infiniteAmmo || (tank.reloadTimer <= 0 && tank.ammo > 0));

      if (canFireImmediately) {
        fireTankBullet(world, tank, normAngle);
      } else {
        targetQueue.push({
          type: 'SHOOT_AT_ANGLE',
          angleDeg: normAngle,
        });
      }
    },
    autoFire: (bulletCount, strategy = 'DIRECT') => {
      const visible = scanVisibleEnemies(tank, world.tanks, world.grid);
      if (visible.length === 0) return; // Không bắn nếu không có địch trong tầm nhìn
      const count = Math.max(1, Math.min(8, bulletCount));
      const strat = String(strategy).toUpperCase() === 'RICOCHET' ? 'RICOCHET' : 'DIRECT';
      targetQueue.push({
        type: 'AUTO_FIRE',
        remainingShots: count,
        strategy: strat,
        waitTimer: 0,
      });
    },
    reload: () => {
      if (targetQueue.length > 0) {
        targetQueue.push({ type: 'RELOAD_AMMO' });
        return;
      }
      if (tank.reloadTimer <= 0 && tank.ammo < tank.maxAmmo) {
        tank.reloadTimer = RELOAD_DURATION;
        addFloatingText(world, tank.x, tank.y + 0.6, 'Nạp đạn (2.5s)...', '#fbbf24');
      }
    },
    useSkill: (targetX?: number, targetY?: number) => {
      if (tank.skillCooldown > 0) return;
      tank.skillCooldown = SKILL_COOLDOWN;
      soundFX.playSkill();

      switch (tank.skillId) {
        case SkillId.PHASE_SHIFT:
          tank.activeSkillTimer = 5.0;
          addFloatingText(world, tank.x, tank.y + 0.8, 'XUYÊN THẤU (5s)!', '#38bdf8');
          addConsoleLog(world, tank.name, 'COMBAT', 'Kích hoạt kỹ năng Xuyên Thấu (5s)!');
          break;
        case SkillId.SHRINK:
          tank.activeSkillTimer = 10.0;
          addFloatingText(world, tank.x, tank.y + 0.8, 'THU NHỎ (10s)!', '#a855f7');
          addConsoleLog(world, tank.name, 'COMBAT', 'Kích hoạt kỹ năng Thu Nhỏ (10s)!');
          break;
        case SkillId.INFINITE_AMMO:
          tank.activeSkillTimer = 7.0;
          tank.reloadTimer = 0;
          addFloatingText(world, tank.x, tank.y + 0.8, 'ĐẠN VÔ HẠN (7s)!', '#f59e0b');
          addConsoleLog(world, tank.name, 'COMBAT', 'Kích hoạt kỹ năng Đạn Vô Hạn (7s)!');
          break;
        case SkillId.BLINK: {
          const gx = Math.max(0, Math.min(GRID_SIZE - 1, Math.floor(targetX ?? 15)));
          const gy = Math.max(0, Math.min(GRID_SIZE - 1, Math.floor(targetY ?? 15)));
          spawnParticles(world, tank.x, tank.y, '#22d3ee', 14, 5.0, 3.5);
          // Ensure destination is walkable or nearest empty tile
          const dest = findNearestEmptyTileCenter(world.grid, gx + 0.5, gy + 0.5);
          tank.x = dest.x;
          tank.y = dest.y;
          spawnParticles(world, tank.x, tank.y, '#22d3ee', 14, 5.0, 3.5);
          addFloatingText(world, tank.x, tank.y + 0.8, `BLINK (${ Math.floor(dest.x)},${Math.floor(dest.y)})!`, '#22d3ee');
          addConsoleLog(
            world,
            tank.name,
            'COMBAT',
            `Dịch chuyển tức thời tới ô (${Math.floor(dest.x)}, ${Math.floor(dest.y)})!`
          );
          break;
        }
        case SkillId.OVERDRIVE:
          tank.activeSkillTimer = 7.0;
          addFloatingText(world, tank.x, tank.y + 0.8, 'TĂNG TỐC +50% (7s)!', '#10b981');
          addConsoleLog(world, tank.name, 'COMBAT', 'Kích hoạt kỹ năng Tăng Tốc (7s)!');
          break;
        case SkillId.KNOCKBACK_AMMO:
          tank.activeSkillTimer = 17.0;
          addFloatingText(world, tank.x, tank.y + 0.8, 'ĐẠN ĐẨY LÙI (17s)!', '#f43f5e');
          addConsoleLog(world, tank.name, 'COMBAT', 'Kích hoạt kỹ năng Đạn Đẩy Lùi (17s)!');
          break;
      }
    },
    getNearestEnemyAngleStatus: () => {
      const visible = scanVisibleEnemies(tank, world.tanks, world.grid);
      if (visible.length === 0) {
        return { first: -1, second: 0 };
      }
      return { first: visible[0].angle, second: visible[0].status };
    },
    getNearestEnemyInfo: () => {
      const visible = scanVisibleEnemies(tank, world.tanks, world.grid);
      if (visible.length === 0) {
        return { id: -1, x: -1, y: -1, hp: 0, angle: -1, dist: 999, status: 0 };
      }
      return visible[0];
    },
    getAllVisibleEnemies: () => {
      return scanVisibleEnemies(tank, world.tanks, world.grid);
    },
    getNearestItemPos: (itemType = 'ANY') => {
      const filter = String(itemType).toUpperCase();
      let best: { first: number; second: number } = { first: -1, second: -1 };
      let bestDist = Infinity;
      for (const item of world.items) {
        if (filter !== 'ANY' && item.type !== filter) continue;
        const d = Math.hypot(item.gx + 0.5 - tank.x, item.gy + 0.5 - tank.y);
        if (d < bestDist) {
          bestDist = d;
          best = { first: item.gx, second: item.gy };
        }
      }
      return best;
    },
    getX: () => Number(tank.x.toFixed(2)),
    getY: () => Number(tank.y.toFixed(2)),
    getHP: () => tank.hp,
    getAmmo: () => tank.ammo,
    isSkillReady: () => tank.skillCooldown <= 0,
    isDashReady: () => tank.dashCooldown <= 0,
    getGridType: (x, y) => getGridTypeAt(world.grid, x, y),
    log: (msg) => {
      addConsoleLog(world, tank.name, 'INFO', msg);
    },
  };
}

/**
 * Checks whether a tank center `(nx, ny)` collides with a solid obstacle on the island.
 * Notice: Deep Ocean (`< 0` or `>= 30`) does NOT block movement—it triggers instant Ring-Out death!
 */
function isTankBlockedByObstacle(
  world: GameWorldState,
  tank: Tank,
  nx: number,
  ny: number
): boolean {
  const phaseShift = tank.skillId === SkillId.PHASE_SHIFT && tank.activeSkillTimer > 0;
  if (phaseShift) return false;

  const isShrunk = tank.skillId === SkillId.SHRINK && tank.activeSkillTimer > 0;
  const radius = isShrunk ? 0.18 : 0.34;

  const checkPoints = [
    { x: nx - radius, y: ny - radius },
    { x: nx + radius, y: ny - radius },
    { x: nx - radius, y: ny + radius },
    { x: nx + radius, y: ny + radius },
  ];

  for (const pt of checkPoints) {
    const gx = Math.floor(pt.x);
    const gy = Math.floor(pt.y);
    if (gx < 0 || gx >= GRID_SIZE || gy < 0 || gy >= GRID_SIZE) {
      continue; // Water allows falling in
    }
    const tile = world.grid[gy][gx];
    if (tile === TileType.BRICK || tile === TileType.CRATE || tile === TileType.BOULDER) {
      return true;
    }
  }
  return false;
}

function checkRingOutWaterDeath(world: GameWorldState, tank: Tank): boolean {
  if (!tank.alive) return true;
  if (tank.x < 0 || tank.x >= GRID_SIZE || tank.y < 0 || tank.y >= GRID_SIZE) {
    tank.hp = 0;
    tank.alive = false;
    tank.deathReason = 'OCEAN';
    tank.deathAnimTimer = 0.6;
    soundFX.playSplash();
    spawnParticles(world, Math.max(0.2, Math.min(29.8, tank.x)), Math.max(0.2, Math.min(29.8, tank.y)), '#38bdf8', 22, 5.5, 4.0);
    addFloatingText(world, Math.max(1, Math.min(29, tank.x)), Math.max(1, Math.min(29, tank.y)), 'RƠI XUỐNG BIỂN (-1)!', '#38bdf8');
    addConsoleLog(world, tank.name, 'COMBAT', 'Rơi ra ngoài biên đảo (0..30) xuống vùng nước sâu và bị loại!');
    return true;
  }
  return false;
}

function moveTankWithSlide(
  world: GameWorldState,
  tank: Tank,
  dx: number,
  dy: number
): boolean {
  const nx = tank.x + dx;
  const ny = tank.y + dy;
  if (!isTankBlockedByObstacle(world, tank, nx, ny)) {
    tank.x = nx;
    tank.y = ny;
    checkRingOutWaterDeath(world, tank);
    return true;
  }
  // Try X slide
  if (Math.abs(dx) > 1e-4 && !isTankBlockedByObstacle(world, tank, tank.x + dx, tank.y)) {
    tank.x += dx;
    checkRingOutWaterDeath(world, tank);
    return true;
  }
  // Try Y slide
  if (Math.abs(dy) > 1e-4 && !isTankBlockedByObstacle(world, tank, tank.x, tank.y + dy)) {
    tank.y += dy;
    checkRingOutWaterDeath(world, tank);
    return true;
  }
  return false;
}

function refreshTankPathAfterTeleport(world: GameWorldState, tank: Tank): void {
  const queues = [tank.actionQueue, tank.overrideQueue];
  for (const q of queues) {
    if (q.length > 0 && q[0].type === 'MOVE_TO_PATH') {
      const task = q[0];
      const destGx = Math.floor(tank.x);
      const destGy = Math.floor(tank.y);
      if (destGx === Math.floor(task.targetGx) && destGy === Math.floor(task.targetGy)) {
        q.shift();
      } else {
        task.waypoints = findPath8Dir(
          world.grid,
          world.tanks,
          tank,
          task.targetGx,
          task.targetGy,
          task.avoidEnemy,
          task.mode,
          world.portals
        );
        task.currentIdx = 0;
      }
    }
  }
}

function handlePortalAndItemPickups(world: GameWorldState, tank: Tank): void {
  if (!tank.alive) return;
  const gx = Math.floor(tank.x);
  const gy = Math.floor(tank.y);
  const cellKey = `${gx},${gy}`;

  if (tank.lastPortalCell && tank.lastPortalCell !== cellKey) {
    tank.lastPortalCell = undefined;
  }

  // Teleporter Pairs check
  for (const portal of world.portals) {
    if (portal.cooldown > 0) continue;
    const distA = Math.hypot(tank.x - (portal.a.gx + 0.5), tank.y - (portal.a.gy + 0.5));
    const distB = Math.hypot(tank.x - (portal.b.gx + 0.5), tank.y - (portal.b.gy + 0.5));

    if (distA < 0.42 && tank.lastPortalCell !== `${portal.a.gx},${portal.a.gy}`) {
      tank.x = portal.b.gx + 0.5;
      tank.y = portal.b.gy + 0.5;
      tank.lastPortalCell = `${portal.b.gx},${portal.b.gy}`;
      portal.cooldown = PORTAL_COOLDOWN;
      refreshTankPathAfterTeleport(world, tank);
      soundFX.playSkill();
      spawnParticles(world, tank.x, tank.y, portal.color, 16, 4.5, 3.5);
      addFloatingText(world, tank.x, tank.y + 0.7, 'PORTAL TELEPORT!', portal.color);
      break;
    } else if (distB < 0.42 && tank.lastPortalCell !== `${portal.b.gx},${portal.b.gy}`) {
      tank.x = portal.a.gx + 0.5;
      tank.y = portal.a.gy + 0.5;
      tank.lastPortalCell = `${portal.a.gx},${portal.a.gy}`;
      portal.cooldown = PORTAL_COOLDOWN;
      refreshTankPathAfterTeleport(world, tank);
      soundFX.playSkill();
      spawnParticles(world, tank.x, tank.y, portal.color, 16, 4.5, 3.5);
      addFloatingText(world, tank.x, tank.y + 0.7, 'PORTAL TELEPORT!', portal.color);
      break;
    }
  }

  // Power-up Item Pickups
  for (let i = world.items.length - 1; i >= 0; i--) {
    const it = world.items[i];
    const dist = Math.hypot(tank.x - (it.gx + 0.5), tank.y - (it.gy + 0.5));
    if (dist < 0.62) {
      world.items.splice(i, 1);
      soundFX.playPickup();
      spawnParticles(world, it.gx + 0.5, it.gy + 0.5, '#fbbf24', 12, 4.0, 3.0);

      switch (it.type) {
        case 'CLOCK':
          tank.skillCooldown = tank.skillCooldown < 5.0 ? 0 : tank.skillCooldown * 0.5;
          tank.dashCooldown = tank.dashCooldown < 5.0 ? 0 : tank.dashCooldown * 0.5;
          addFloatingText(world, tank.x, tank.y + 0.7, 'ĐỒNG HỒ (-50% CD)!', '#38bdf8');
          break;
        case 'HEART_1':
          tank.hp = Math.min(MAX_HP, tank.hp + 1);
          addFloatingText(world, tank.x, tank.y + 0.7, '+1 HP!', '#4ade80');
          break;
        case 'HEART_2':
          tank.hp = Math.min(MAX_HP, tank.hp + 2);
          addFloatingText(world, tank.x, tank.y + 0.7, '+2 HP!', '#22c55e');
          break;
        case 'AMMO':
          tank.ammo = MAX_AMMO;
          tank.reloadTimer = 0;
          addFloatingText(world, tank.x, tank.y + 0.7, 'ĐẦY ĐẠN (5/5)!', '#fbbf24');
          break;
        case 'KNOCKBACK':
          tank.knockbackBulletsBuff += 2;
          addFloatingText(world, tank.x, tank.y + 0.7, '+2 ĐẠN ĐẨY LÙI!', '#f43f5e');
          break;
      }
    }
  }
}

function getTankMoveSpeed(tank: Tank): number {
  let speed = BASE_MOVE_SPEED;
  if (tank.skillId === SkillId.SHRINK && tank.activeSkillTimer > 0) {
    speed *= 1.15;
  }
  if (tank.skillId === SkillId.OVERDRIVE && tank.activeSkillTimer > 0) {
    speed *= 1.5;
  }
  return speed;
}

/**
 * Steps a single tank's timers, C++ AI script, Override queue, and kinetic movement.
 */
function updateTank(world: GameWorldState, tank: Tank, dt: number): void {
  if (!tank.alive) {
    if (tank.deathAnimTimer > 0) {
      tank.deathAnimTimer = Math.max(0, tank.deathAnimTimer - dt);
    }
    return;
  }

  if (tank.hitFlashTimer > 0) tank.hitFlashTimer = Math.max(0, tank.hitFlashTimer - dt);
  if (tank.fireCooldown > 0) {
    tank.fireCooldown = tank.fireCooldown - dt < 1e-6 ? 0 : tank.fireCooldown - dt;
  }
  if (tank.instantShootCooldown && tank.instantShootCooldown > 0) {
    tank.instantShootCooldown =
      tank.instantShootCooldown - dt < 1e-6 ? 0 : tank.instantShootCooldown - dt;
  }
  if (tank.dashCooldown > 0) tank.dashCooldown = Math.max(0, tank.dashCooldown - dt);
  if (tank.skillCooldown > 0) tank.skillCooldown = Math.max(0, tank.skillCooldown - dt);

  // Reload timer completion
  if (tank.reloadTimer > 0) {
    tank.reloadTimer = Math.max(0, tank.reloadTimer - dt);
    if (tank.reloadTimer === 0) {
      tank.ammo = tank.maxAmmo;
      addFloatingText(world, tank.x, tank.y + 0.6, '5/5 ĐẠN!', '#fbbf24');
    }
  }

  // Active Skill duration expiration
  if (tank.activeSkillTimer > 0) {
    const wasPhaseShift = tank.skillId === SkillId.PHASE_SHIFT;
    tank.activeSkillTimer = Math.max(0, tank.activeSkillTimer - dt);
    if (tank.activeSkillTimer === 0 && wasPhaseShift) {
      // Push tank to nearest empty tile (0) if still inside wall/obstacle
      const tile = getGridTypeAt(world.grid, tank.x, tank.y);
      if (tile === TileType.BRICK || tile === TileType.CRATE || tile === TileType.BOULDER) {
        const safePos = findNearestEmptyTileCenter(world.grid, tank.x, tank.y);
        tank.x = safePos.x;
        tank.y = safePos.y;
        addFloatingText(world, tank.x, tank.y + 0.6, 'Đẩy ra ô trống!', '#38bdf8');
      }
    }
  }

  // Live Override 2.5s Compile Cooldown countdown
  if (tank.compileTimer > 0) {
    tank.compileTimer = Math.max(0, tank.compileTimer - dt);
    if (tank.compileTimer === 0 && tank.pendingOverrideCode) {
      const code = tank.pendingOverrideCode;
      tank.pendingOverrideCode = null;
      tank.overrideQueue = [];
      try {
        const parsed = compileCppSource(code);
        const api = buildTankApiBindings(world, tank, tank.overrideQueue);
        const runtime = new CppRuntime(parsed, tank.globals, api);
        runtime.executeTopLevel();
        tank.executingOverride = tank.overrideQueue.length > 0;
        soundFX.playCompileReady();
        addFloatingText(world, tank.x, tank.y + 0.85, 'GHI ĐÈ THỰC THI!', '#10b981');
        addConsoleLog(world, tank.name, 'OVERRIDE', 'Biên dịch hoàn tất! Đang thực thi hàng đợi lệnh Ghi Đè.');
      } catch (err: any) {
        tank.lastError = err?.message || 'Lỗi runtime Ghi Đè';
        addConsoleLog(world, tank.name, 'ERROR', tank.lastError!);
      }
    }
  }

  // Active Dash movement (3.0 grid units in 0.2s = 15.0 u/s)
  if (tank.dashTimer > 0) {
    const stepDt = Math.min(dt, tank.dashTimer);
    tank.dashTimer = Math.max(0, tank.dashTimer - dt);
    const dashSpeed = DASH_DISTANCE / DASH_DURATION;
    const rad = (tank.dashDirDeg * Math.PI) / 180;
    moveTankWithSlide(world, tank, Math.cos(rad) * dashSpeed * stepDt, Math.sin(rad) * dashSpeed * stepDt);
    handlePortalAndItemPickups(world, tank);
    return;
  }

  // Determine which queue is active: Override Queue pauses Main loop() until finished
  const activeQueue = tank.executingOverride ? tank.overrideQueue : tank.actionQueue;

  if (tank.executingOverride && tank.overrideQueue.length === 0) {
    tank.executingOverride = false;
    addConsoleLog(world, tank.name, 'INFO', 'Hoàn tất lệnh Ghi Đè. Tiếp tục vòng lặp loop() chính.');
  }

  // If no kinetic task in queue (and not executing override), run C++ setup() or loop()
  if (!tank.executingOverride && tank.actionQueue.length === 0) {
    try {
      const parsed = compileCppSource(tank.mainCode);
      const api = buildTankApiBindings(world, tank, tank.actionQueue);
      const runtime = new CppRuntime(parsed, tank.globals, api);
      if (!tank.setupDone) {
        runtime.initGlobals();
        runtime.callFunction('setup');
        tank.setupDone = true;
      } else {
        runtime.callFunction('loop');
      }
      tank.lastError = null;
    } catch (err: any) {
      const msg = err?.message || 'Lỗi C++ Runtime';
      if (tank.lastError !== msg) {
        tank.lastError = msg;
        addConsoleLog(world, tank.name, 'ERROR', msg);
      }
    }
  }

  // Process current kinetic task in activeQueue
  const currentQueue = tank.executingOverride ? tank.overrideQueue : tank.actionQueue;
  if (currentQueue.length > 0) {
    const task = currentQueue[0];
    const moveSpeed = getTankMoveSpeed(tank);

    switch (task.type) {
      case 'WAIT': {
        task.remainingTime -= dt;
        if (task.remainingTime <= 0) currentQueue.shift();
        break;
      }

      case 'MOVE_DIR': {
        const stepDist = Math.min(task.remainingDist, moveSpeed * dt);
        const rad = (task.dirDeg * Math.PI) / 180;
        tank.hullAngle = task.dirDeg;
        const moved = moveTankWithSlide(
          world,
          tank,
          Math.cos(rad) * stepDist,
          Math.sin(rad) * stepDist
        );
        task.remainingDist -= stepDist;
        if (!moved || task.remainingDist <= 0.01) {
          currentQueue.shift();
        }
        break;
      }

      case 'MOVE_TO_PATH': {
        if (task.currentIdx >= task.waypoints.length) {
          currentQueue.shift();
          break;
        }
        let wp = task.waypoints[task.currentIdx];
        let dx = wp.x - tank.x;
        let dy = wp.y - tank.y;
        let dist = Math.hypot(dx, dy);

        // If the waypoint is > 2.0 units away (e.g. after knockback or portal hop), recompute path from current position
        if (dist > 2.0) {
          task.waypoints = findPath8Dir(
            world.grid,
            world.tanks,
            tank,
            task.targetGx,
            task.targetGy,
            task.avoidEnemy,
            task.mode,
            world.portals
          );
          task.currentIdx = 0;
          wp = task.waypoints[0];
          if (!wp) {
            currentQueue.shift();
            break;
          }
          dx = wp.x - tank.x;
          dy = wp.y - tank.y;
          dist = Math.hypot(dx, dy);
        }

        const maxStep = moveSpeed * dt;
        if (dist <= maxStep + 0.02) {
          moveTankWithSlide(world, tank, dx, dy);
          task.currentIdx++;
          if (task.currentIdx >= task.waypoints.length) {
            currentQueue.shift();
          }
        } else {
          const deg = ((Math.round((Math.atan2(dy, dx) * 180) / Math.PI) % 360) + 360) % 360;
          tank.hullAngle = deg;
          const moved = moveTankWithSlide(world, tank, (dx / dist) * maxStep, (dy / dist) * maxStep);
          if (!moved) {
            currentQueue.shift();
          }
        }
        break;
      }

      case 'RELOAD_AMMO': {
        if (tank.reloadTimer <= 0 && tank.ammo < tank.maxAmmo) {
          tank.reloadTimer = RELOAD_DURATION;
          addFloatingText(world, tank.x, tank.y + 0.6, 'Nạp đạn (2.5s)...', '#fbbf24');
        }
        currentQueue.shift();
        break;
      }

      case 'SHOOT_AT_ANGLE': {
        const infiniteAmmo = tank.skillId === SkillId.INFINITE_AMMO && tank.activeSkillTimer > 0;
        if (!infiniteAmmo && tank.reloadTimer > 0) {
          // Wait until ongoing reload finishes before firing this queued shot
          break;
        }
        if (!infiniteAmmo && tank.ammo <= 0) {
          // Automatically reload so the remaining queued shoot() calls can still execute
          tank.reloadTimer = RELOAD_DURATION;
          addFloatingText(world, tank.x, tank.y + 0.6, 'Nạp đạn (2.5s)...', '#fbbf24');
          break;
        }
        if (tank.fireCooldown <= 1e-6) {
          fireTankBullet(world, tank, task.angleDeg);
          currentQueue.shift();
          if (currentQueue.length > 0 && currentQueue[0].type === 'RELOAD_AMMO') {
            currentQueue.shift();
            if (tank.reloadTimer <= 0 && tank.ammo < tank.maxAmmo) {
              tank.reloadTimer = RELOAD_DURATION;
              addFloatingText(world, tank.x, tank.y + 0.6, 'Nạp đạn (2.5s)...', '#fbbf24');
            }
          }
        }
        break;
      }

      case 'AUTO_FIRE': {
        if (task.waitTimer > 0) {
          task.waitTimer -= dt;
          break;
        }
        const visible = scanVisibleEnemies(tank, world.tanks, world.grid);
        if (visible.length === 0 || task.remainingShots <= 0) {
          currentQueue.shift();
          break;
        }
        const target = visible[0];
        let fireAngle = target.angle;
        if (task.strategy === 'RICOCHET') {
          fireAngle = findRicochetAngle(world.grid, tank.x, tank.y, target.x, target.y);
        }
        if (tank.fireCooldown <= 0) {
          const fired = fireTankBullet(world, tank, fireAngle);
          if (fired) {
            task.remainingShots--;
            if (task.remainingShots <= 0) {
              currentQueue.shift();
            } else {
              task.waitTimer = FIRE_COOLDOWN;
            }
          } else {
            currentQueue.shift();
          }
        }
        break;
      }
    }
  }

  handlePortalAndItemPickups(world, tank);
}

/**
 * Updates all bullets: flight, Brick Wall ricochets (up to 2 times), Crate/Boulder destruction,
 * Bullet-vs-Bullet mid-air collision explosions, and Tank hits + 2.0-unit Knockback.
 */
function updateBullets(world: GameWorldState, dt: number): void {
  if (world.bullets.length === 0) return;

  const subSteps = 3;
  const subDt = dt / subSteps;
  const bulletCollisionRadius = 0.38;
  const destroyedIds = new Set<string>();

  const checkPairwiseBulletCollisions = () => {
    const count = world.bullets.length;
    for (let i = 0; i < count; i++) {
      const b1 = world.bullets[i];
      if (destroyedIds.has(b1.id)) continue;
      for (let j = i + 1; j < count; j++) {
        const b2 = world.bullets[j];
        if (destroyedIds.has(b2.id)) continue;
        // Two unbounced bullets from the same tank never self-collide at the barrel
        if (b1.ownerId === b2.ownerId && b1.bounces === 0 && b2.bounces === 0) continue;

        const dist = Math.hypot(b1.x - b2.x, b1.y - b2.y);
        if (dist <= bulletCollisionRadius) {
          destroyedIds.add(b1.id);
          destroyedIds.add(b2.id);

          const mx = (b1.x + b2.x) * 0.5;
          const my = (b1.y + b2.y) * 0.5;
          world.screenShake = Math.max(world.screenShake, 0.16);
          soundFX.playHit();
          spawnParticles(world, mx, my, '#f97316', 18, 5.5, 4.0);
          spawnParticles(world, mx, my, '#fef08a', 10, 3.5, 2.8);
          addFloatingText(world, mx, my + 0.35, '💥 ĐẠN NỔ!', '#fb923c');
          break;
        }
      }
    }
  };

  // Check if any bullets are already overlapping at the start of the frame
  checkPairwiseBulletCollisions();

  for (let s = 0; s < subSteps; s++) {
    for (let i = 0; i < world.bullets.length; i++) {
      const b = world.bullets[i];
      if (destroyedIds.has(b.id)) continue;

      const nx = b.x + b.vx * subDt;
      const ny = b.y + b.vy * subDt;

      // Out of island bounds -> bullet disappears over deep ocean
      if (nx < 0 || nx >= GRID_SIZE || ny < 0 || ny >= GRID_SIZE) {
        destroyedIds.add(b.id);
        continue;
      }

      const prevGx = Math.floor(b.x);
      const prevGy = Math.floor(b.y);
      const newGx = Math.floor(nx);
      const newGy = Math.floor(ny);
      const tile = world.grid[newGy][newGx];

      // 1. Brick Wall (1): Bounces up to 2 times, disappears on 3rd impact
      if (tile === TileType.BRICK) {
        b.bounces++;
        if (b.bounces > 2) {
          spawnParticles(world, nx, ny, '#cbd5e1', 6, 3.0, 2.5);
          destroyedIds.add(b.id);
          continue;
        }
        soundFX.playRicochet();
        spawnParticles(world, nx, ny, '#fbbf24', 5, 3.5, 2.5);
        if (newGx !== prevGx) b.vx = -b.vx;
        if (newGy !== prevGy) b.vy = -b.vy;
        if (newGx === prevGx && newGy === prevGy) {
          b.vx = -b.vx;
          b.vy = -b.vy;
        }
        b.angleDeg = ((Math.round((Math.atan2(b.vy, b.vx) * 180) / Math.PI) % 360) + 360) % 360;
        continue;
      }

      // 2. Wooden Crate (2) or Rock Boulder (3): Deals 1 damage, destroyed immediately (NO bounce)
      if (tile === TileType.CRATE || tile === TileType.BOULDER) {
        world.obstacleHp[newGy][newGx] = Math.max(0, world.obstacleHp[newGy][newGx] - 1);
        const isCrate = tile === TileType.CRATE;
        spawnParticles(world, nx, ny, isCrate ? '#d97706' : '#94a3b8', 10, 4.0, 3.0);
        soundFX.playHit();
        if (world.obstacleHp[newGy][newGx] <= 0) {
          world.grid[newGy][newGx] = TileType.EMPTY;
          spawnParticles(world, newGx + 0.5, newGy + 0.5, isCrate ? '#f59e0b' : '#cbd5e1', 16, 5.0, 3.5);
        }
        destroyedIds.add(b.id);
        continue;
      }

      b.x = nx;
      b.y = ny;
    }

    // 3. Bullet-vs-Bullet Mid-Air Collision Check after all bullets step this substep
    checkPairwiseBulletCollisions();

    // 4. Tank Collision Check for surviving bullets
    for (let i = 0; i < world.bullets.length; i++) {
      const b = world.bullets[i];
      if (destroyedIds.has(b.id)) continue;

      for (const tank of world.tanks) {
        if (!tank.alive || tank.id === b.ownerId) continue;
        const isShrunk = tank.skillId === SkillId.SHRINK && tank.activeSkillTimer > 0;
        const hitRadius = isShrunk ? 0.24 : 0.42;
        if (Math.hypot(b.x - tank.x, b.y - tank.y) <= hitRadius) {
          tank.hp = Math.max(0, tank.hp - 1);
          tank.hitFlashTimer = 0.12;
          world.hitstopTimer = 0.04;
          world.screenShake = 0.25;
          soundFX.playHit();
          spawnParticles(world, b.x, b.y, '#ef4444', 16, 5.5, 3.5);
          addFloatingText(world, tank.x, tank.y + 0.65, '-1 HP', '#ef4444');

          const shooter = world.tanks.find((t) => t.id === b.ownerId);
          if (shooter) {
            shooter.damageDealt += 1;
          }

          // Apply 2.0 grid unit Knockback if bullet has knockback buff
          if (b.hasKnockback && tank.hp > 0) {
            const spd = Math.hypot(b.vx, b.vy) || 1;
            const dirX = b.vx / spd;
            const dirY = b.vy / spd;
            const kbSteps = 10;
            const stepLen = 2.0 / kbSteps;
            for (let k = 0; k < kbSteps; k++) {
              const testX = tank.x + dirX * stepLen;
              const testY = tank.y + dirY * stepLen;
              if (!isTankBlockedByObstacle(world, tank, testX, testY)) {
                tank.x = testX;
                tank.y = testY;
                if (checkRingOutWaterDeath(world, tank)) {
                  if (shooter) shooter.kills += 1;
                  break;
                }
              } else {
                break;
              }
            }
            if (tank.alive) {
              addFloatingText(world, tank.x, tank.y + 0.9, 'ĐẨY LÙI 2 Ô!', '#f43f5e');
            }
          }

          if (tank.hp <= 0 && tank.alive) {
            tank.alive = false;
            tank.deathReason = 'BULLET';
            tank.deathAnimTimer = 0.6;
            if (shooter) shooter.kills += 1;
            spawnParticles(world, tank.x, tank.y, tank.color, 26, 6.5, 4.5);
            addConsoleLog(
              world,
              tank.name,
              'COMBAT',
              `Bị hạ gục bởi ${shooter ? shooter.name : 'đạn pháo'}!`
            );
          }

          destroyedIds.add(b.id);
          break;
        }
      }
    }
  }

  for (let i = world.bullets.length - 1; i >= 0; i--) {
    const b = world.bullets[i];
    if (destroyedIds.has(b.id)) {
      world.bullets.splice(i, 1);
    } else {
      b.trail.push({ x: b.x, y: b.y });
      if (b.trail.length > 8) b.trail.shift();
    }
  }
}

export function spawnPeriodicMapItem(world: GameWorldState): void {
  if (world.items.length >= MAX_MAP_ITEMS) return;
  const types: ItemType[] = ['CLOCK', 'HEART_1', 'HEART_2', 'AMMO', 'KNOCKBACK'];
  const chosenType = types[Math.floor(Math.random() * types.length)];

  for (let attempt = 0; attempt < 60; attempt++) {
    const gx = 1 + Math.floor(Math.random() * (GRID_SIZE - 2));
    const gy = 1 + Math.floor(Math.random() * (GRID_SIZE - 2));
    if (world.grid[gy][gx] !== TileType.EMPTY) continue;
    if (world.items.some((it) => it.gx === gx && it.gy === gy)) continue;
    if (world.tanks.some((t) => t.alive && Math.hypot(t.x - (gx + 0.5), t.y - (gy + 0.5)) < 2.2)) continue;

    world.items.push({
      id: `item-${Date.now()}-${Math.random()}`,
      type: chosenType,
      gx,
      gy,
      spawnTime: world.matchTime,
    });
    spawnParticles(world, gx + 0.5, gy + 0.5, '#fbbf24', 8, 3.0, 2.5);
    break;
  }
}

/**
 * Advances the entire game world simulation by `rawDt` seconds.
 */
export function stepWorldSimulation(world: GameWorldState, rawDt: number): void {
  if (world.shellState !== 'playing') return;

  const dt = Math.min(rawDt, 0.05);

  // Update visual particles & floating texts even during hitstop
  for (const p of world.particles) {
    if (!p.active) continue;
    p.x += p.vx * dt;
    p.y += p.vy * dt;
    p.life -= dt;
    if (p.life <= 0) p.active = false;
  }

  for (let i = world.floatingTexts.length - 1; i >= 0; i--) {
    const ft = world.floatingTexts[i];
    ft.y += 0.65 * dt;
    ft.life -= dt;
    if (ft.life <= 0) world.floatingTexts.splice(i, 1);
  }

  if (world.screenShake > 0) {
    world.screenShake = Math.max(0, world.screenShake - dt * 1.8);
  }

  if (world.hitstopTimer > 0) {
    world.hitstopTimer = Math.max(0, world.hitstopTimer - dt);
    return;
  }

  world.matchTime += dt;

  // Portal pair global cooldowns
  for (const portal of world.portals) {
    if (portal.cooldown > 0) {
      portal.cooldown = Math.max(0, portal.cooldown - dt);
    }
  }

  // Periodic random power-up spawning along timeline (max 3 concurrent items on island)
  world.itemSpawnTimer -= dt;
  if (world.itemSpawnTimer <= 0) {
    world.itemSpawnTimer = 4.5 + Math.random() * 2.5;
    spawnPeriodicMapItem(world);
  }

  // Step all 4 tanks
  for (const tank of world.tanks) {
    updateTank(world, tank, dt);
  }

  // Step bullets
  updateBullets(world, dt);

  // Check Battle Royale Win / Game Over condition
  const aliveTanks = world.tanks.filter((t) => t.alive && t.hp > 0);
  const playerTank = world.tanks.find((t) => t.isPlayer);

  if (aliveTanks.length <= 1 || (playerTank && !playerTank.alive && world.matchTime > 2.0)) {
    if (aliveTanks.length === 1) {
      world.winnerId = aliveTanks[0].id;
      world.shellState = 'gameover';
      addConsoleLog(world, aliveTanks[0].name, 'COMBAT', 'Chiến thắng trận đấu Island Battle Royale!');
    } else if (aliveTanks.length === 0) {
      world.winnerId = null;
      world.shellState = 'gameover';
    }
  }
}

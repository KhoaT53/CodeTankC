import test from 'node:test';
import assert from 'node:assert/strict';
import {
  oxyToCanvas,
  canvasToOxy,
  getGridTypeAt,
  raycastLineOfSight,
  findPath8Dir,
  computeOxyAngle,
} from './mathAndPathfinding';
import {
  TileType,
  SkillId,
  BASE_MOVE_SPEED,
  BULLET_SPEED,
  MAX_MAP_ITEMS,
  CompetitorConfig,
} from './types';
import { compileCppSource, CppRuntime, CppApiBindings } from './cppInterpreter';
import {
  createInitialWorldState,
  stepWorldSimulation,
  triggerLiveOverride,
} from './engine';

test('Physics speeds are 2.0 grid units/sec for tanks and 4.0 grid units/sec for bullets', () => {
  assert.equal(BASE_MOVE_SPEED, 2.0);
  assert.equal(BULLET_SPEED, 4.0);
  assert.equal(MAX_MAP_ITEMS, 3);
});

test('Oxy coordinate transformation places (0,0) at bottom-left and (29,29) at top-right', () => {
  const islandPx = 600;
  const origin = oxyToCanvas(0, 0, islandPx, 0, 0);
  assert.equal(origin.cx, 0);
  assert.equal(origin.cy, 600);

  const topRight = oxyToCanvas(30, 30, islandPx, 0, 0);
  assert.equal(topRight.cx, 600);
  assert.equal(topRight.cy, 0);

  const back = canvasToOxy(300, 300, islandPx, 0, 0);
  assert.equal(back.x, 15);
  assert.equal(back.y, 15);

  // Angle check: East = 0, North = 90, West = 180, South = 270
  assert.equal(computeOxyAngle(5, 5, 10, 5), 0);
  assert.equal(computeOxyAngle(5, 5, 5, 10), 90);
  assert.equal(computeOxyAngle(5, 5, 0, 5), 180);
  assert.equal(computeOxyAngle(5, 5, 5, 0), 270);
});

test('360-degree Raycast sensor distinguishes Clear (1), Crate/Boulder Obstructed (2), and Brick Blocked (0)', () => {
  const world = createInitialWorldState();
  // Clear a test corridor along y = 2
  for (let x = 0; x < 30; x++) {
    world.grid[2][x] = TileType.EMPTY;
  }

  // 1. Clear Line of Sight
  const clearLos = raycastLineOfSight(world.grid, 2.5, 2.5, 10.5, 2.5);
  assert.equal(clearLos.status, 1);
  assert.equal(clearLos.angle, 0);

  // 2. Wooden Crate (2) between tanks -> status 2 (Obstructed)
  world.grid[2][6] = TileType.CRATE;
  const crateLos = raycastLineOfSight(world.grid, 2.5, 2.5, 10.5, 2.5);
  assert.equal(crateLos.status, 2);

  // 3. Brick Wall (1) between tanks -> status 0 (Hidden)
  world.grid[2][6] = TileType.BRICK;
  const brickLos = raycastLineOfSight(world.grid, 2.5, 2.5, 10.5, 2.5);
  assert.equal(brickLos.status, 0);
  assert.equal(brickLos.angle, -1);

  // 4. Out of island bounds returns OCEAN (-1)
  assert.equal(getGridTypeAt(world.grid, -1, 5), TileType.OCEAN);
  assert.equal(getGridTypeAt(world.grid, 30, 15), TileType.OCEAN);
});

test('8-directional A* pathfinding routes through Teleporter Pairs when faster and avoids accidental portal hops', () => {
  const world = createInitialWorldState();
  const player = world.tanks[0];

  // 1. Standard path without needing portal
  player.x = 3.2;
  player.y = 3.8;
  const path = findPath8Dir(world.grid, world.tanks, player, 8, 8, false, 'SHORTEST', world.portals);
  assert.ok(path.length >= 2);
  assert.equal(path[0].x, 3.5);
  assert.equal(path[0].y, 3.5);
  const last = path[path.length - 1];
  assert.equal(last.x, 8.5);
  assert.equal(last.y, 8.5);

  // 2. Path across the island from (3.5, 14.5) to (27, 15) MUST use Blue Portal (4,14) -> (25,15)
  player.x = 3.5;
  player.y = 14.5;
  const portalPath = findPath8Dir(
    world.grid,
    world.tanks,
    player,
    27,
    15,
    false,
    'SHORTEST',
    world.portals
  );
  // Waypoints should include portal entrance (4.5, 14.5), portal exit (25.5, 15.5), and destination (27.5, 15.5)
  assert.ok(portalPath.some((wp) => wp.x === 4.5 && wp.y === 14.5));
  assert.ok(portalPath.some((wp) => wp.x === 25.5 && wp.y === 15.5));
  assert.ok(portalPath.length <= 6);

  // 3. Walking past portal (4, 14) from (4.5, 13.5) to (4, 15) MUST avoid stepping onto (4.5, 14.5)
  player.x = 4.5;
  player.y = 13.5;
  const bypassPath = findPath8Dir(
    world.grid,
    world.tanks,
    player,
    4,
    15,
    false,
    'SHORTEST',
    world.portals
  );
  assert.equal(bypassPath.some((wp) => wp.x === 4.5 && wp.y === 14.5), false);
  assert.equal(bypassPath[bypassPath.length - 1].x, 4.5);
  assert.equal(bypassPath[bypassPath.length - 1].y, 15.5);
});

test('Tank executing moveTo() through a Teleporter Pair teleports and reaches target cell without getting lost', () => {
  const world = createInitialWorldState();
  world.shellState = 'playing';
  // Freeze bots so we test player movement deterministically
  for (const b of world.tanks.slice(1)) {
    b.alive = false;
    b.hp = 0;
  }
  // Keep one dummy bot far away so match doesn't end
  world.tanks[1].alive = true;
  world.tanks[1].hp = 5;
  world.tanks[1].x = 3.5;
  world.tanks[1].y = 26.5;
  world.tanks[1].mainCode = 'void setup() {} void loop() {}';

  const player = world.tanks[0];
  player.x = 3.5;
  player.y = 14.5;
  player.mainCode = 'void setup() { moveTo(27, 15, false, "SHORTEST"); } void loop() {}';
  player.setupDone = false;
  player.actionQueue = [];

  // Simulate 3.5 seconds (at 2.0 u/s, 3 steps via portal takes ~1.6 seconds)
  for (let i = 0; i < 70; i++) {
    stepWorldSimulation(world, 0.05);
  }

  assert.ok(Math.hypot(player.x - 27.5, player.y - 15.5) < 0.25);
});

test('Custom Bot C++ configurations persist when creating a new match world state and items spawn randomly up to 3 max', () => {
  const customBots: CompetitorConfig[] = [
    {
      id: 2,
      name: 'CUSTOM BOT #2',
      skillId: SkillId.OVERDRIVE,
      mainCode: 'void setup() { shoot(90); } void loop() {}',
    },
    {
      id: 3,
      name: 'CUSTOM BOT #3',
      skillId: SkillId.BLINK,
      mainCode: 'void setup() { shoot(180); } void loop() {}',
    },
    {
      id: 4,
      name: 'CUSTOM BOT #4',
      skillId: SkillId.PHASE_SHIFT,
      mainCode: 'void setup() { shoot(270); } void loop() {}',
    },
  ];

  const world = createInitialWorldState(
    SkillId.BLINK,
    'void setup() {} void loop() {}',
    'OFFLINE',
    'OXY-3030',
    customBots
  );

  // Verify zero bushes across the entire 30x30 grid and zero initial map items at t=0
  assert.equal(world.bushes.every((row) => row.every((b) => b === false)), true);
  assert.equal(world.items.length, 0);

  // Verify custom bot code and skills persisted into world.tanks
  assert.equal(world.tanks[1].name, 'CUSTOM BOT #2');
  assert.equal(world.tanks[1].skillId, SkillId.OVERDRIVE);
  assert.equal(world.tanks[1].mainCode, 'void setup() { shoot(90); } void loop() {}');
  assert.equal(world.tanks[2].name, 'CUSTOM BOT #3');
  assert.equal(world.tanks[3].name, 'CUSTOM BOT #4');

  // Freeze all tanks so they don't pick up items while testing dynamic spawning
  for (const t of world.tanks) {
    t.mainCode = 'void setup() {} void loop() {}';
  }
  world.shellState = 'playing';

  // Advance simulation by 30 seconds (600 steps of 0.05s)
  for (let i = 0; i < 600; i++) {
    stepWorldSimulation(world, 0.05);
    assert.ok(world.items.length <= MAX_MAP_ITEMS);
  }
  assert.equal(world.items.length, MAX_MAP_ITEMS);
});

test('C++ parser and interpreter execute globals, nested for loops, structs, and API bindings', () => {
  const shotAngles: number[] = [];
  const movedTargets: Array<[number, number]> = [];

  const mockApi: CppApiBindings = {
    moveDir: () => {},
    moveTo: (x, y) => movedTargets.push([x, y]),
    dash: () => {},
    shoot: (a) => shotAngles.push(a),
    autoFire: () => {},
    reload: () => {},
    useSkill: () => {},
    getNearestEnemyAngleStatus: () => ({ first: 45, second: 1 }),
    getNearestEnemyInfo: () => ({
      id: 2,
      x: 12.5,
      y: 14.5,
      hp: 4,
      angle: 45,
      dist: 6.5,
      status: 1,
    }),
    getAllVisibleEnemies: () => [
      { id: 2, x: 12.5, y: 14.5, hp: 4, angle: 45, dist: 6.5, status: 1 },
    ],
    getNearestItemPos: () => ({ first: 14, second: 14 }),
    getX: () => 5.5,
    getY: () => 5.5,
    getHP: () => 5,
    getAmmo: () => 5,
    isSkillReady: () => true,
    isDashReady: () => true,
    getGridType: () => 0,
  };

  const cppCode = `
    int counter = 0;
    int sumGrid(int n) {
        int total = 0;
        for (int i = 0; i < n; i++) {
            for (int j = 0; j < 2; j++) {
                total += 15;
            }
        }
        return total;
    }
    void setup() {
        counter = 10;
    }
    void loop() {
        counter++;
        EnemyInfo e = getNearestEnemyInfo();
        if (e.id != -1 && e.status == 1) {
            int bonus = sumGrid(3);
            shoot(e.angle + bonus);
        }
        pair<int, int> it = getNearestItemPos("ANY");
        if (it.first != -1) {
            moveTo(it.first, it.second, true, "SAFEST");
        }
    }
  `;

  const parsed = compileCppSource(cppCode);
  const globals: Record<string, any> = {};
  const runtime = new CppRuntime(parsed, globals, mockApi);

  runtime.initGlobals();
  runtime.callFunction('setup');
  assert.equal(globals.counter, 10);

  runtime.callFunction('loop');
  assert.equal(globals.counter, 11);
  assert.deepEqual(shotAngles, [45 + 90]);
  assert.deepEqual(movedTargets, [[14, 14]]);
});

test('Live Override 1.0s Compile Cooldown and Ring-Out Ocean Death operate accurately', () => {
  const world = createInitialWorldState(SkillId.PHASE_SHIFT);
  world.shellState = 'playing';
  const player = world.tanks[0];

  // Trigger Live Override (1.0s compile cooldown)
  const res = triggerLiveOverride(world, player.id, 'useSkill(); dash("N");');
  assert.equal(res.ok, true);
  assert.equal(player.compileTimer, 1.0);

  // Advance 1.15 seconds (in 0.05s steps) so compileTimer finishes and override executes
  for (let i = 0; i < 23; i++) {
    stepWorldSimulation(world, 0.05);
  }
  assert.equal(player.compileTimer, 0);
  // Phase Shift (5s) was activated by override!
  assert.ok(player.activeSkillTimer > 0);

  // Ring-out test: move tank #2 out into Deep Ocean (-0.2, 10)
  const bot = world.tanks[1];
  bot.x = -0.2;
  bot.y = 10.0;
  bot.actionQueue = [{ type: 'MOVE_DIR', dirDeg: 180, remainingDist: 1 }];
  stepWorldSimulation(world, 0.05);
  assert.equal(bot.alive, false);
  assert.equal(bot.hp, 0);
  assert.equal(bot.deathReason, 'OCEAN');
});

test('PeerJS room code generation and authoritative world state synchronization work accurately', async () => {
  const {
    generateShortRoomCode,
    cleanRoomCode,
    serializeWorldForSync,
    applySyncedWorldToClient,
  } = await import('./peerNetwork');

  const code = generateShortRoomCode();
  assert.equal(code.length, 6);
  assert.equal(cleanRoomCode(' oxy-99a! '), 'OXY99A');

  const hostWorld = createInitialWorldState(SkillId.BLINK);
  hostWorld.shellState = 'playing';
  hostWorld.matchTime = 14.5;
  hostWorld.tanks[1].x = 12.25;
  hostWorld.tanks[1].y = 18.75;
  hostWorld.tanks[1].hp = 3;
  hostWorld.grid[5][5] = TileType.EMPTY;

  const payload = serializeWorldForSync(hostWorld);
  const clientWorld = createInitialWorldState(SkillId.SHRINK);
  applySyncedWorldToClient(clientWorld, payload, 2);

  assert.equal(clientWorld.shellState, 'playing');
  assert.equal(clientWorld.matchTime, 14.5);
  assert.equal(clientWorld.tanks[1].x, 12.25);
  assert.equal(clientWorld.tanks[1].y, 18.75);
  assert.equal(clientWorld.tanks[1].hp, 3);
  // Client assigned to slot #2 should have tank #2 marked as isPlayer
  assert.equal(clientWorld.tanks[1].isPlayer, true);
  assert.equal(clientWorld.tanks[0].isPlayer, false);
  assert.equal(clientWorld.grid[5][5], TileType.EMPTY);
});


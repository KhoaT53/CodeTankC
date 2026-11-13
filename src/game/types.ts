export const GRID_SIZE = 30;
export const MAX_HP = 5;
export const MAX_AMMO = 5;
export const RELOAD_DURATION = 2.5;
export const FIRE_COOLDOWN = 0.5;
export const BASE_MOVE_SPEED = 2.0;
export const BULLET_SPEED = 4.0;
export const DASH_DISTANCE = 3.0;
export const DASH_DURATION = 0.3;
export const DASH_COOLDOWN = 8.0;
export const SKILL_COOLDOWN = 28.0;
export const PORTAL_COOLDOWN = 2.5;
export const COMPILE_COOLDOWN = 1.0;
export const SENSOR_RADIUS = 20.0;
export const MAX_MAP_ITEMS = 3;

export enum TileType {
  OCEAN = -1,
  EMPTY = 0,
  BRICK = 1,
  CRATE = 2,
  BOULDER = 3,
  PORTAL = 4,
}

export enum SkillId {
  PHASE_SHIFT = 1,   // Xuyên Thấu (5s)
  SHRINK = 2,        // Thu Nhỏ (10s)
  INFINITE_AMMO = 3, // Đạn Vô Hạn (7s)
  BLINK = 4,         // Dịch Chuyển (Instant)
  OVERDRIVE = 5,     // Tăng Tốc (7s)
  KNOCKBACK_AMMO = 6 // Đạn Đẩy Lùi (17s)
}

export interface SkillDefinition {
  id: SkillId;
  nameVi: string;
  codeName: string;
  duration: number;
  cooldown: number;
  syntax: string;
  descriptionVi: string;
  accentColor: string;
}

export const SKILLS: SkillDefinition[] = [
  {
    id: SkillId.PHASE_SHIFT,
    nameVi: 'Xuyên Thấu',
    codeName: 'Phase Shift',
    duration: 5.0,
    cooldown: SKILL_COOLDOWN,
    syntax: 'useSkill()',
    descriptionVi: 'Đi xuyên tường gạch, thùng gỗ và tảng đá trong 5s. Tự đẩy ra ô trống gần nhất khi hết giờ.',
    accentColor: '#38bdf8',
  },
  {
    id: SkillId.SHRINK,
    nameVi: 'Thu Nhỏ',
    codeName: 'Shrink',
    duration: 10.0,
    cooldown: SKILL_COOLDOWN,
    syntax: 'useSkill()',
    descriptionVi: 'Thu nhỏ kích thước và hitbox xuống 50%, tăng tốc độ di chuyển thêm +15% trong 10s.',
    accentColor: '#a855f7',
  },
  {
    id: SkillId.INFINITE_AMMO,
    nameVi: 'Đạn Vô Hạn',
    codeName: 'Infinite Ammo',
    duration: 7.0,
    cooldown: SKILL_COOLDOWN,
    syntax: 'useSkill()',
    descriptionVi: 'Bắn không tốn đạn và không cần nạp đạn trong 7s (vẫn tuân thủ nhịp bắn 0.5s/viên).',
    accentColor: '#f59e0b',
  },
  {
    id: SkillId.BLINK,
    nameVi: 'Dịch Chuyển',
    codeName: 'Blink',
    duration: 0,
    cooldown: SKILL_COOLDOWN,
    syntax: 'useSkill(int x, int y)',
    descriptionVi: 'Dịch chuyển tức thời tới tâm ô (x + 0.5, y + 0.5) bất kỳ trên đảo 30x30.',
    accentColor: '#22d3ee',
  },
  {
    id: SkillId.OVERDRIVE,
    nameVi: 'Tăng Tốc',
    codeName: 'Overdrive',
    duration: 7.0,
    cooldown: SKILL_COOLDOWN,
    syntax: 'useSkill()',
    descriptionVi: 'Tăng +50% tốc độ di chuyển (lên 3.0 ô/giây) trong 7s để truy đuổi hoặc rút lui.',
    accentColor: '#10b981',
  },
  {
    id: SkillId.KNOCKBACK_AMMO,
    nameVi: 'Đạn Đẩy Lùi',
    codeName: 'Knockback Ammo',
    duration: 17.0,
    cooldown: SKILL_COOLDOWN,
    syntax: 'useSkill()',
    descriptionVi: 'Trong 17s, mọi viên đạn trúng địch sẽ đẩy lùi mục tiêu 2.0 ô (có thể đẩy xuống biển diệt gọn).',
    accentColor: '#f43f5e',
  },
];

export type ItemType = 'CLOCK' | 'HEART_1' | 'HEART_2' | 'AMMO' | 'KNOCKBACK';

export interface MapItem {
  id: string;
  type: ItemType;
  gx: number;
  gy: number;
  spawnTime: number;
}

export interface PortalPair {
  pairId: number; // 0 = Blue, 1 = Purple
  color: string;
  a: { gx: number; gy: number };
  b: { gx: number; gy: number };
  cooldown: number; // 2.5s global cooldown
}

export interface EnemyInfo {
  id: number;
  x: number;
  y: number;
  hp: number;
  angle: number;
  dist: number;
  status: number; // 0: Không thấy, 1: Thấy rõ, 2: Bị chắn bởi Vật cản (Gỗ/Đá)
}

export type KineticTask =
  | {
      type: 'MOVE_DIR';
      dirDeg: number;
      remainingDist: number;
    }
  | {
      type: 'MOVE_TO_PATH';
      targetGx: number;
      targetGy: number;
      avoidEnemy: boolean;
      mode: string;
      waypoints: Array<{ x: number; y: number }>;
      currentIdx: number;
    }
  | {
      type: 'AUTO_FIRE';
      remainingShots: number;
      strategy: 'DIRECT' | 'RICOCHET';
      waitTimer: number;
    }
  | {
      type: 'WAIT';
      remainingTime: number;
    };

export interface Tank {
  id: number;
  name: string;
  isPlayer: boolean;
  difficulty?: 'EASY' | 'MEDIUM' | 'HARD' | 'ONLINE';
  color: string;
  turretColor: string;
  x: number; // Continuous float [0..30)
  y: number; // Continuous float [0..30)
  hullAngle: number; // degrees 0..360 (0=E, 90=N)
  turretAngle: number; // degrees 0..360
  hp: number;
  maxHp: number;
  ammo: number;
  maxAmmo: number;
  alive: boolean;
  deathReason?: 'BULLET' | 'OCEAN';
  deathAnimTimer: number;
  hitFlashTimer: number;

  // Timers & Cooldowns
  reloadTimer: number; // > 0 means currently reloading (2.5s)
  fireCooldown: number; // > 0 means waiting 0.5s between shots
  dashCooldown: number; // 8.0s
  dashTimer: number; // 0.2s active dash
  dashDirDeg: number;

  // Special Skill
  skillId: SkillId;
  skillCooldown: number; // 28.0s
  activeSkillTimer: number; // > 0 when skill duration active
  knockbackBulletsBuff: number; // From KNOCKBACK item (next 2 bullets)

  // Portal teleport lock so tank doesn't re-trigger immediately while standing on destination
  lastPortalCell?: string;

  // Code Execution & Override
  mainCode: string;
  overrideCode: string;
  compileTimer: number; // 2.5s compile cooldown when overriding
  pendingOverrideCode: string | null;
  executingOverride: boolean;
  actionQueue: KineticTask[];
  overrideQueue: KineticTask[];
  globals: Record<string, any>;
  setupDone: boolean;
  lastError: string | null;

  // Stats
  kills: number;
  damageDealt: number;
  shotsFired: number;
}

export interface Bullet {
  id: string;
  ownerId: number;
  x: number;
  y: number;
  vx: number;
  vy: number;
  angleDeg: number;
  bounces: number; // Max 2 bounces on Brick (1), disappears on 3rd
  hasKnockback: boolean;
  color: string;
  trail: Array<{ x: number; y: number }>;
}

export interface Particle {
  active: boolean;
  x: number;
  y: number;
  vx: number;
  vy: number;
  life: number;
  maxLife: number;
  color: string;
  size: number;
}

export interface FloatingText {
  id: string;
  x: number;
  y: number;
  text: string;
  color: string;
  life: number;
  maxLife: number;
}

export interface ConsoleLogEntry {
  id: string;
  time: string;
  tankName: string;
  type: 'INFO' | 'COMPILE' | 'OVERRIDE' | 'ERROR' | 'COMBAT';
  message: string;
}

export type GameShellState = 'title' | 'playing' | 'paused' | 'gameover';

export interface GameWorldState {
  shellState: GameShellState;
  mode: 'OFFLINE' | 'ONLINE';
  roomCode: string;
  matchTime: number;
  itemSpawnTimer: number;
  hitstopTimer: number;
  screenShake: number;
  grid: TileType[][]; // [gy][gx] where gy=0..29 (bottom to top), gx=0..29 (left to right)
  obstacleHp: number[][]; // [gy][gx] HP for CRATE (2) and BOULDER (4)
  bushes: boolean[][]; // [gy][gx] decorative green bushes on EMPTY (0) tiles
  portals: PortalPair[];
  items: MapItem[];
  tanks: Tank[];
  bullets: Bullet[];
  particles: Particle[];
  floatingTexts: FloatingText[];
  logs: ConsoleLogEntry[];
  winnerId: number | null;
}

export interface CompetitorConfig {
  id: number;
  name: string;
  skillId: SkillId;
  mainCode: string;
}

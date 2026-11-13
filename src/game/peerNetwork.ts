import Peer, { DataConnection } from 'peerjs';
import {
  SkillId,
  GameWorldState,
  GameShellState,
  Bullet,
  MapItem,
  PortalPair,
  FloatingText,
  Particle,
  ConsoleLogEntry,
} from './types';

export type NetworkRole = 'OFFLINE' | 'HOST' | 'CLIENT';

export interface RoomPlayerInfo {
  peerId: string;
  slotId: number; // 1 = Host, 2..4 = Clients
  name: string;
  skillId: SkillId;
  Ready: boolean;
}

export interface SerializedTankSnapshot {
  id: number;
  name: string;
  color: string;
  turretColor: string;
  x: number;
  y: number;
  hullAngle: number;
  turretAngle: number;
  hp: number;
  maxHp: number;
  ammo: number;
  maxAmmo: number;
  alive: boolean;
  deathReason?: 'BULLET' | 'OCEAN';
  reloadTimer: number;
  fireCooldown: number;
  dashCooldown: number;
  skillId: SkillId;
  skillCooldown: number;
  activeSkillTimer: number;
  knockbackBulletsBuff: number;
  compileTimer: number;
  executingOverride: boolean;
  lastError: string | null;
  kills: number;
  damageDealt: number;
  hitFlashTimer: number;
  deathAnimTimer: number;
}

export interface WorldSyncPayload {
  shellState: GameShellState;
  matchTime: number;
  winnerId: number | null;
  screenShake: number;
  tanks: SerializedTankSnapshot[];
  bullets: Bullet[];
  items: MapItem[];
  portals: PortalPair[];
  damagedObstacles: Array<{ gx: number; gy: number; tile: number; hp: number }>;
  floatingTexts: FloatingText[];
  particles: Particle[];
  logs: ConsoleLogEntry[];
}

export type PeerMessage =
  | {
      type: 'CLIENT_JOIN_HELLO';
      name: string;
      skillId: SkillId;
      mainCode: string;
    }
  | {
      type: 'HOST_WELCOME';
      assignedSlotId: number;
      roomCode: string;
      players: RoomPlayerInfo[];
      world: WorldSyncPayload;
    }
  | {
      type: 'HOST_ROOM_ROSTER';
      players: RoomPlayerInfo[];
    }
  | {
      type: 'HOST_WORLD_STATE';
      world: WorldSyncPayload;
    }
  | {
      type: 'CLIENT_UPDATE_LOADOUT';
      slotId: number;
      name: string;
      skillId: SkillId;
      mainCode: string;
    }
  | {
      type: 'CLIENT_APPLY_MAIN_CODE';
      slotId: number;
      code: string;
    }
  | {
      type: 'CLIENT_TRIGGER_OVERRIDE';
      slotId: number;
      code: string;
    };

const PEER_ID_PREFIX = 'codetank-oxy-v2-';

export function generateShortRoomCode(): string {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let out = '';
  for (let i = 0; i < 6; i++) {
    out += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return out;
}

export function cleanRoomCode(raw: string): string {
  return raw
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, '')
    .slice(0, 8);
}

export function serializeWorldForSync(w: GameWorldState): WorldSyncPayload {
  const damagedObstacles: Array<{ gx: number; gy: number; tile: number; hp: number }> = [];
  for (let gy = 0; gy < w.grid.length; gy++) {
    for (let gx = 0; gx < w.grid[gy].length; gx++) {
      const tile = w.grid[gy][gx];
      const hp = w.obstacleHp[gy][gx];
      // Track any non-brick cell that could be a crate/boulder or destroyed crate/boulder
      damagedObstacles.push({ gx, gy, tile, hp });
    }
  }

  return {
    shellState: w.shellState,
    matchTime: Number(w.matchTime.toFixed(2)),
    winnerId: w.winnerId,
    screenShake: Number(w.screenShake.toFixed(2)),
    tanks: w.tanks.map((t) => ({
      id: t.id,
      name: t.name,
      color: t.color,
      turretColor: t.turretColor,
      x: Number(t.x.toFixed(3)),
      y: Number(t.y.toFixed(3)),
      hullAngle: Number(t.hullAngle.toFixed(1)),
      turretAngle: Number(t.turretAngle.toFixed(1)),
      hp: t.hp,
      maxHp: t.maxHp,
      ammo: t.ammo,
      maxAmmo: t.maxAmmo,
      alive: t.alive,
      deathReason: t.deathReason,
      reloadTimer: Number(t.reloadTimer.toFixed(2)),
      fireCooldown: Number(t.fireCooldown.toFixed(2)),
      dashCooldown: Number(t.dashCooldown.toFixed(2)),
      skillId: t.skillId,
      skillCooldown: Number(t.skillCooldown.toFixed(2)),
      activeSkillTimer: Number(t.activeSkillTimer.toFixed(2)),
      knockbackBulletsBuff: Number(t.knockbackBulletsBuff.toFixed(2)),
      compileTimer: Number(t.compileTimer.toFixed(2)),
      executingOverride: t.executingOverride,
      lastError: t.lastError,
      kills: t.kills,
      damageDealt: t.damageDealt,
      hitFlashTimer: Number(t.hitFlashTimer.toFixed(2)),
      deathAnimTimer: Number(t.deathAnimTimer.toFixed(2)),
    })),
    bullets: w.bullets.map((b) => ({
      ...b,
      x: Number(b.x.toFixed(2)),
      y: Number(b.y.toFixed(2)),
      trail: b.trail.slice(-4),
    })),
    items: w.items,
    portals: w.portals,
    damagedObstacles,
    floatingTexts: w.floatingTexts.slice(-12),
    particles: w.particles.filter((p) => p.active).slice(-24),
    logs: w.logs.slice(0, 25),
  };
}

export function applySyncedWorldToClient(
  target: GameWorldState,
  payload: WorldSyncPayload,
  mySlotId: number
): void {
  target.shellState = payload.shellState;
  target.matchTime = payload.matchTime;
  target.winnerId = payload.winnerId;
  target.screenShake = payload.screenShake;

  // Apply grid & obstacle HP updates
  for (const cell of payload.damagedObstacles) {
    if (
      cell.gy >= 0 &&
      cell.gy < target.grid.length &&
      cell.gx >= 0 &&
      cell.gx < target.grid[0].length
    ) {
      target.grid[cell.gy][cell.gx] = cell.tile;
      target.obstacleHp[cell.gy][cell.gx] = cell.hp;
    }
  }

  // Apply tank states & mark mySlotId as isPlayer so sensor/HUD highlight the client's tank
  for (const snap of payload.tanks) {
    const tk = target.tanks.find((t) => t.id === snap.id);
    if (tk) {
      tk.name = snap.name;
      tk.color = snap.color;
      tk.turretColor = snap.turretColor;
      tk.isPlayer = snap.id === mySlotId;
      tk.x = snap.x;
      tk.y = snap.y;
      tk.hullAngle = snap.hullAngle;
      tk.turretAngle = snap.turretAngle;
      tk.hp = snap.hp;
      tk.maxHp = snap.maxHp;
      tk.ammo = snap.ammo;
      tk.maxAmmo = snap.maxAmmo;
      tk.alive = snap.alive;
      tk.deathReason = snap.deathReason;
      tk.reloadTimer = snap.reloadTimer;
      tk.fireCooldown = snap.fireCooldown;
      tk.dashCooldown = snap.dashCooldown;
      tk.skillId = snap.skillId;
      tk.skillCooldown = snap.skillCooldown;
      tk.activeSkillTimer = snap.activeSkillTimer;
      tk.knockbackBulletsBuff = snap.knockbackBulletsBuff;
      tk.compileTimer = snap.compileTimer;
      tk.executingOverride = snap.executingOverride;
      tk.lastError = snap.lastError;
      tk.kills = snap.kills;
      tk.damageDealt = snap.damageDealt;
      tk.hitFlashTimer = snap.hitFlashTimer;
      tk.deathAnimTimer = snap.deathAnimTimer;
    }
  }

  target.bullets = payload.bullets;
  target.items = payload.items;
  target.portals = payload.portals;
  target.floatingTexts = payload.floatingTexts;
  target.particles = payload.particles;
  target.logs = payload.logs;
}

export interface PeerRoomCallbacks {
  onStatusChange: (status: string, error: string | null) => void;
  onRoleChange: (role: NetworkRole, mySlotId: number, roomCode: string) => void;
  onRosterChange: (players: RoomPlayerInfo[]) => void;
  onClientLoadoutReceived: (
    slotId: number,
    name: string,
    skillId: SkillId,
    mainCode: string
  ) => void;
  onClientApplyMainCode: (slotId: number, code: string) => void;
  onClientTriggerOverride: (slotId: number, code: string) => void;
  onWorldSyncReceived: (payload: WorldSyncPayload, mySlotId: number) => void;
  getWorldState: () => GameWorldState;
  getHostInfo: () => { name: string; skillId: SkillId };
}

export class PeerRoomManager {
  private peer: Peer | null = null;
  private role: NetworkRole = 'OFFLINE';
  private roomCode: string = '';
  private mySlotId: number = 1;
  private hostConn: DataConnection | null = null;
  private clientConns: Map<number, DataConnection> = new Map();
  private players: RoomPlayerInfo[] = [];
  private callbacks: PeerRoomCallbacks;

  constructor(callbacks: PeerRoomCallbacks) {
    this.callbacks = callbacks;
  }

  public getRole(): NetworkRole {
    return this.role;
  }

  public getMySlotId(): number {
    return this.mySlotId;
  }

  public getPlayers(): RoomPlayerInfo[] {
    return this.players;
  }

  public disconnect(): void {
    for (const conn of this.clientConns.values()) {
      try {
        conn.close();
      } catch {
        // Ignore close error
      }
    }
    this.clientConns.clear();

    if (this.hostConn) {
      try {
        this.hostConn.close();
      } catch {
        // Ignore close error
      }
      this.hostConn = null;
    }

    if (this.peer) {
      try {
        this.peer.destroy();
      } catch {
        // Ignore destroy error
      }
      this.peer = null;
    }

    this.role = 'OFFLINE';
    this.mySlotId = 1;
    this.players = [];
    this.callbacks.onRoleChange('OFFLINE', 1, this.roomCode);
    this.callbacks.onRosterChange([]);
    this.callbacks.onStatusChange('Chế độ Offline (Đấu với 3 AI Bot)', null);
  }

  public createHostRoom(requestedCode?: string): void {
    this.disconnect();
    const code = cleanRoomCode(requestedCode || '') || generateShortRoomCode();
    this.roomCode = code;
    const fullPeerId = `${PEER_ID_PREFIX}${code}`;

    this.callbacks.onStatusChange(`Đang khởi tạo phòng ${code} trên máy chủ PeerJS...`, null);

    const peer = new Peer(fullPeerId, {
      debug: 0,
    });
    this.peer = peer;

    peer.on('open', () => {
      this.role = 'HOST';
      this.mySlotId = 1;
      const hostInfo = this.callbacks.getHostInfo();
      this.players = [
        {
          peerId: fullPeerId,
          slotId: 1,
          name: hostInfo.name || 'CHỦ PHÒNG (#1)',
          skillId: hostInfo.skillId,
          Ready: true,
        },
      ];
      this.callbacks.onRoleChange('HOST', 1, code);
      this.callbacks.onRosterChange([...this.players]);
      this.callbacks.onStatusChange(
        `Đã tạo phòng thành công! Mã phòng: ${code} (Đang chờ người chơi khác kết nối...)`,
        null
      );
    });

    peer.on('connection', (conn) => {
      this.handleIncomingClientConnection(conn);
    });

    peer.on('error', (err: any) => {
      if (err?.type === 'unavailable-id') {
        const retryCode = generateShortRoomCode();
        this.callbacks.onStatusChange(
          `Mã phòng ${code} đã tồn tại, đang tự động đổi sang ${retryCode}...`,
          null
        );
        this.createHostRoom(retryCode);
        return;
      }
      this.callbacks.onStatusChange(
        'Lỗi kết nối PeerJS',
        err?.message || 'Không thể kết nối máy chủ PeerJS'
      );
    });
  }

  private handleIncomingClientConnection(conn: DataConnection): void {
    // Assign lowest free slot in [2, 3, 4]
    let assignedSlot = -1;
    for (const s of [2, 3, 4]) {
      if (!this.clientConns.has(s)) {
        assignedSlot = s;
        break;
      }
    }

    if (assignedSlot === -1) {
      conn.on('open', () => {
        conn.close();
      });
      return;
    }

    this.clientConns.set(assignedSlot, conn);

    conn.on('data', (raw) => {
      const msg = raw as PeerMessage;
      if (!msg || typeof msg !== 'object') return;

      if (msg.type === 'CLIENT_JOIN_HELLO') {
        const playerName = msg.name || `PLAYER #${assignedSlot}`;
        const existingIdx = this.players.findIndex((p) => p.slotId === assignedSlot);
        const entry: RoomPlayerInfo = {
          peerId: conn.peer,
          slotId: assignedSlot,
          name: playerName,
          skillId: msg.skillId,
          Ready: true,
        };
        if (existingIdx >= 0) {
          this.players[existingIdx] = entry;
        } else {
          this.players.push(entry);
        }

        // Apply client's code and skill to their tank slot on Host
        this.callbacks.onClientLoadoutReceived(
          assignedSlot,
          playerName,
          msg.skillId,
          msg.mainCode
        );

        // Send welcome packet with assigned slot + current world snapshot
        const welcome: PeerMessage = {
          type: 'HOST_WELCOME',
          assignedSlotId: assignedSlot,
          roomCode: this.roomCode,
          players: this.players,
          world: serializeWorldForSync(this.callbacks.getWorldState()),
        };
        conn.send(welcome);

        this.broadcastRoster();
        this.callbacks.onRosterChange([...this.players]);
        this.callbacks.onStatusChange(
          `${playerName} đã tham gia phòng ở vị trí Chiến Xa #${assignedSlot}!`,
          null
        );
      } else if (msg.type === 'CLIENT_UPDATE_LOADOUT') {
        const p = this.players.find((pl) => pl.slotId === assignedSlot);
        if (p) {
          p.name = msg.name;
          p.skillId = msg.skillId;
        }
        this.callbacks.onClientLoadoutReceived(
          assignedSlot,
          msg.name,
          msg.skillId,
          msg.mainCode
        );
        this.broadcastRoster();
        this.callbacks.onRosterChange([...this.players]);
      } else if (msg.type === 'CLIENT_APPLY_MAIN_CODE') {
        this.callbacks.onClientApplyMainCode(assignedSlot, msg.code);
      } else if (msg.type === 'CLIENT_TRIGGER_OVERRIDE') {
        this.callbacks.onClientTriggerOverride(assignedSlot, msg.code);
      }
    });

    const handleDisconnect = () => {
      if (this.clientConns.get(assignedSlot) === conn) {
        this.clientConns.delete(assignedSlot);
        this.players = this.players.filter((p) => p.slotId !== assignedSlot);
        this.broadcastRoster();
        this.callbacks.onRosterChange([...this.players]);
        this.callbacks.onStatusChange(
          `Người chơi ở vị trí Chiến Xa #${assignedSlot} đã ngắt kết nối.`,
          null
        );
      }
    };

    conn.on('close', handleDisconnect);
    conn.on('error', handleDisconnect);
  }

  public joinRoom(
    targetCode: string,
    myName: string,
    mySkillId: SkillId,
    myMainCode: string
  ): void {
    const code = cleanRoomCode(targetCode);
    if (!code) {
      this.callbacks.onStatusChange(
        'Chưa nhập mã phòng',
        'Vui lòng nhập mã phòng gồm 4-8 ký tự từ Chủ Phòng.'
      );
      return;
    }

    this.disconnect();
    this.roomCode = code;
    const targetPeerId = `${PEER_ID_PREFIX}${code}`;

    this.callbacks.onStatusChange(`Đang kết nối tới phòng ${code}...`, null);

    const peer = new Peer({ debug: 0 });
    this.peer = peer;

    peer.on('open', () => {
      const conn = peer.connect(targetPeerId, { reliable: true });
      this.hostConn = conn;

      conn.on('open', () => {
        const hello: PeerMessage = {
          type: 'CLIENT_JOIN_HELLO',
          name: myName,
          skillId: mySkillId,
          mainCode: myMainCode,
        };
        conn.send(hello);
      });

      conn.on('data', (raw) => {
        const msg = raw as PeerMessage;
        if (!msg || typeof msg !== 'object') return;

        if (msg.type === 'HOST_WELCOME') {
          this.role = 'CLIENT';
          this.mySlotId = msg.assignedSlotId;
          this.players = msg.players;
          this.callbacks.onRoleChange('CLIENT', msg.assignedSlotId, msg.roomCode);
          this.callbacks.onRosterChange([...this.players]);
          this.callbacks.onWorldSyncReceived(msg.world, msg.assignedSlotId);
          this.callbacks.onStatusChange(
            `Đã kết nối vào phòng ${msg.roomCode}! Bạn điều khiển Chiến Xa #${msg.assignedSlotId}.`,
            null
          );
        } else if (msg.type === 'HOST_ROOM_ROSTER') {
          this.players = msg.players;
          this.callbacks.onRosterChange([...this.players]);
        } else if (msg.type === 'HOST_WORLD_STATE') {
          this.callbacks.onWorldSyncReceived(msg.world, this.mySlotId);
        }
      });

      conn.on('close', () => {
        this.callbacks.onStatusChange(
          'Chủ phòng đã đóng phòng hoặc mất kết nối.',
          'Kết nối phòng đã đóng.'
        );
        this.disconnect();
      });

      conn.on('error', (err: any) => {
        this.callbacks.onStatusChange(
          'Lỗi đường truyền tới Chủ Phòng',
          err?.message || 'Mất kết nối WebRTC'
        );
      });
    });

    peer.on('error', (err: any) => {
      let friendly = err?.message || 'Không thể kết nối tới mã phòng này.';
      if (err?.type === 'peer-unavailable') {
        friendly = `Không tìm thấy phòng mang mã "${code}". Hãy kiểm tra lại mã từ Chủ Phòng!`;
      }
      this.callbacks.onStatusChange('Kết nối thất bại', friendly);
    });
  }

  public broadcastRoster(): void {
    if (this.role !== 'HOST') return;
    const msg: PeerMessage = {
      type: 'HOST_ROOM_ROSTER',
      players: this.players,
    };
    for (const conn of this.clientConns.values()) {
      if (conn.open) {
        conn.send(msg);
      }
    }
  }

  public broadcastWorldState(world: GameWorldState): void {
    if (this.role !== 'HOST' || this.clientConns.size === 0) return;
    const msg: PeerMessage = {
      type: 'HOST_WORLD_STATE',
      world: serializeWorldForSync(world),
    };
    for (const conn of this.clientConns.values()) {
      if (conn.open) {
        conn.send(msg);
      }
    }
  }

  public sendClientLoadoutUpdate(name: string, skillId: SkillId, mainCode: string): void {
    if (this.role === 'HOST') {
      const hostEntry = this.players.find((p) => p.slotId === 1);
      if (hostEntry) {
        hostEntry.name = name;
        hostEntry.skillId = skillId;
        this.broadcastRoster();
        this.callbacks.onRosterChange([...this.players]);
      }
      return;
    }
    if (this.role === 'CLIENT' && this.hostConn?.open) {
      const msg: PeerMessage = {
        type: 'CLIENT_UPDATE_LOADOUT',
        slotId: this.mySlotId,
        name,
        skillId,
        mainCode,
      };
      this.hostConn.send(msg);
    }
  }

  public sendClientApplyMainCode(code: string): void {
    if (this.role === 'CLIENT' && this.hostConn?.open) {
      const msg: PeerMessage = {
        type: 'CLIENT_APPLY_MAIN_CODE',
        slotId: this.mySlotId,
        code,
      };
      this.hostConn.send(msg);
    }
  }

  public sendClientTriggerOverride(code: string): void {
    if (this.role === 'CLIENT' && this.hostConn?.open) {
      const msg: PeerMessage = {
        type: 'CLIENT_TRIGGER_OVERRIDE',
        slotId: this.mySlotId,
        code,
      };
      this.hostConn.send(msg);
    }
  }
}

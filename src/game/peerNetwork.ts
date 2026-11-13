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
  TileType,
} from './types';
import { createInitialIslandMap } from './engine';

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
  // Compact tuple [gx, gy, tile, hp] ONLY for cells that changed from initial map
  damagedObstacles: Array<{ gx: number; gy: number; tile: number; hp: number }>;
  floatingTexts: FloatingText[];
  particles: Particle[];
  logs: ConsoleLogEntry[];
}

export type PeerMessage =
  | {
      type: 'HOST_READY_FOR_HELLO';
      assignedSlotId: number;
      roomCode: string;
    }
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
    }
  | {
      type: 'CLIENT_INSTANT_MOVE_TO';
      slotId: number;
      gx: number;
      gy: number;
    }
  | {
      type: 'CLIENT_INSTANT_SHOOT';
      slotId: number;
      targetX: number;
      targetY: number;
    }
  | {
      type: 'PEER_LEAVE_NOTIFY';
    };

const PEER_ID_PREFIX = 'codetank-oxy-v2-';

// Baseline map reference so we only transmit delta obstacle changes (< 28 cells instead of 900 cells!)
const BASELINE_MAP = createInitialIslandMap();

// WebRTC ICE configuration with Google + Cloudflare STUN servers
const PEER_ICE_CONFIG: RTCConfiguration = {
  iceServers: [
    { urls: 'stun:stun.l.google.com:19302' },
    { urls: 'stun:stun1.l.google.com:19302' },
    { urls: 'stun:stun.cloudflare.com:3478' },
  ],
};

export function generateShortRoomCode(): string {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let out = '';
  for (let i = 0; i < 6; i++) {
    out += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return out;
}

export function cleanRoomCode(raw: unknown): string {
  if (typeof raw !== 'string') return '';
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
      const baseTile = BASELINE_MAP.grid[gy][gx];
      const baseHp = BASELINE_MAP.obstacleHp[gy][gx];
      if (tile !== baseTile || hp !== baseHp) {
        damagedObstacles.push({ gx, gy, tile, hp });
      }
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
      trail: b.trail.slice(-3),
    })),
    items: w.items,
    portals: w.portals,
    damagedObstacles,
    floatingTexts: w.floatingTexts.slice(-8),
    particles: w.particles.filter((p) => p.active).slice(-14),
    logs: w.logs.slice(0, 15),
  };
}

export function applySyncedWorldToClient(
  target: GameWorldState,
  payload: WorldSyncPayload,
  mySlotId: number
): void {
  const isFreshReset = payload.matchTime < 0.25 && target.matchTime > 0.5;
  if (isFreshReset) {
    // Restore baseline crates & boulders when match resets
    for (let gy = 0; gy < target.grid.length; gy++) {
      for (let gx = 0; gx < target.grid[gy].length; gx++) {
        target.grid[gy][gx] = BASELINE_MAP.grid[gy][gx] as TileType;
        target.obstacleHp[gy][gx] = BASELINE_MAP.obstacleHp[gy][gx];
      }
    }
  }

  target.shellState = payload.shellState;
  target.matchTime = payload.matchTime;
  target.winnerId = payload.winnerId;
  target.screenShake = payload.screenShake;

  // Apply delta grid & obstacle HP updates
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
  onClientInstantMoveTo?: (slotId: number, gx: number, gy: number) => void;
  onClientInstantShoot?: (slotId: number, targetX: number, targetY: number) => void;
  onWorldSyncReceived: (payload: WorldSyncPayload, mySlotId: number) => void;
  getWorldState: () => GameWorldState;
  getHostInfo: () => { name: string; skillId: SkillId };
}

export class PeerRoomManager {
  private peer: Peer | null = null;
  private role: NetworkRole = 'OFFLINE';
  private roomCode: string = '';
  private mySlotId: number = 1;
  private hostPeerId: string = '';
  private hostConn: DataConnection | null = null;
  private clientConns: Map<number, DataConnection> = new Map();
  private clientPeerIds: Map<number, string> = new Map();
  private welcomedSlots: Set<number> = new Set();
  private players: RoomPlayerInfo[] = [];
  private callbacks: PeerRoomCallbacks;
  private joinRetryTimer: number | null = null;
  private joinTimeoutTimer: number | null = null;
  private lastRelayWorldSyncAt: number = 0;

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

  private clearJoinTimers(): void {
    if (this.joinRetryTimer !== null) {
      window.clearInterval(this.joinRetryTimer);
      this.joinRetryTimer = null;
    }
    if (this.joinTimeoutTimer !== null) {
      window.clearTimeout(this.joinTimeoutTimer);
      this.joinTimeoutTimer = null;
    }
  }

  /**
   * Sends a PeerMessage directly through the PeerServer WebSocket (wss://0.peerjs.com)
   * using a compliant OFFER metadata envelope so packets arrive in <50ms even when UDP/NAT blocks WebRTC.
   */
  private sendViaSignalingRelay(dstPeerId: string, packet: PeerMessage): boolean {
    const sock = (this.peer as any)?.socket;
    if (!sock || typeof sock.send !== 'function' || !dstPeerId) return false;
    try {
      const cid = 'dc_' + Math.random().toString(36).slice(2, 10);
      sock.send({
        type: 'OFFER',
        dst: dstPeerId,
        payload: {
          sdp: {
            type: 'offer',
            sdp: 'v=0\r\no=- 0 0 IN IP4 127.0.0.1\r\ns=-\r\nt=0 0\r\n',
          },
          type: 'data',
          connectionId: cid,
          label: cid,
          reliable: true,
          serialization: 'json',
          metadata: {
            __codetankRelay: true,
            packet,
          },
        },
      });
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Hooks the Peer instance's internal server message handler to receive
   * relayed packets (`metadata.__codetankRelay`) and peer LEAVE notifications.
   */
  private attachSignalingRelayHook(
    peer: Peer,
    onPacket: (srcPeerId: string, packet: PeerMessage) => void,
    onPeerLeave?: (srcPeerId: string) => void
  ): void {
    const anyPeer = peer as any;
    if (typeof anyPeer._handleMessage !== 'function') return;
    const origHandleMessage = anyPeer._handleMessage.bind(anyPeer);
    anyPeer._handleMessage = (message: any) => {
      if (message?.payload?.metadata?.__codetankRelay && message.src) {
        onPacket(message.src, message.payload.metadata.packet as PeerMessage);
        return;
      }
      if (message?.type === 'LEAVE' && message.src && onPeerLeave) {
        onPeerLeave(message.src);
      }
      origHandleMessage(message);
    };
  }

  private sendToClient(slotId: number, msg: PeerMessage, preferWebRtcOnly = false): void {
    const conn = this.clientConns.get(slotId);
    if (conn && conn.open) {
      try {
        conn.send(msg);
        return;
      } catch {
        // Fall through to signaling relay
      }
    }
    if (!preferWebRtcOnly) {
      const peerId = this.clientPeerIds.get(slotId);
      if (peerId) {
        this.sendViaSignalingRelay(peerId, msg);
      }
    }
  }

  private sendToHost(msg: PeerMessage): void {
    if (this.hostConn && this.hostConn.open) {
      try {
        this.hostConn.send(msg);
        return;
      } catch {
        // Fall through to signaling relay
      }
    }
    if (this.hostPeerId) {
      this.sendViaSignalingRelay(this.hostPeerId, msg);
    }
  }

  public disconnect(): void {
    this.clearJoinTimers();

    if (this.role === 'CLIENT' && this.hostPeerId) {
      this.sendToHost({ type: 'PEER_LEAVE_NOTIFY' });
    } else if (this.role === 'HOST') {
      for (const slotId of this.clientPeerIds.keys()) {
        this.sendToClient(slotId, { type: 'PEER_LEAVE_NOTIFY' });
      }
    }

    for (const conn of this.clientConns.values()) {
      try {
        conn.close();
      } catch {
        // Ignore close error
      }
    }
    this.clientConns.clear();
    this.clientPeerIds.clear();
    this.welcomedSlots.clear();

    if (this.hostConn) {
      try {
        this.hostConn.close();
      } catch {
        // Ignore close error
      }
      this.hostConn = null;
    }
    this.hostPeerId = '';

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

  private findOrAssignSlotForPeer(remotePeerId: string): number {
    for (const [slot, existingPeerId] of this.clientPeerIds.entries()) {
      if (existingPeerId === remotePeerId) {
        return slot;
      }
    }
    for (const s of [2, 3, 4]) {
      if (!this.clientPeerIds.has(s)) {
        this.clientPeerIds.set(s, remotePeerId);
        return s;
      }
    }
    return -1;
  }

  private removeClientByPeerId(remotePeerId: string): void {
    for (const [slot, existingPeerId] of this.clientPeerIds.entries()) {
      if (existingPeerId === remotePeerId) {
        this.clientPeerIds.delete(slot);
        this.clientConns.delete(slot);
        this.welcomedSlots.delete(slot);
        this.players = this.players.filter((p) => p.slotId !== slot);
        this.broadcastRoster();
        this.callbacks.onRosterChange([...this.players]);
        this.callbacks.onStatusChange(
          `Người chơi ở vị trí Chiến Xa #${slot} đã ngắt kết nối.`,
          null
        );
        break;
      }
    }
  }

  private handleHostReceivedMessage(remotePeerId: string, msg: PeerMessage): void {
    if (!msg || typeof msg !== 'object') return;

    if (msg.type === 'PEER_LEAVE_NOTIFY') {
      this.removeClientByPeerId(remotePeerId);
      return;
    }

    const assignedSlot = this.findOrAssignSlotForPeer(remotePeerId);
    if (assignedSlot === -1) return;

    if (msg.type === 'CLIENT_JOIN_HELLO') {
      const playerName = msg.name || `PLAYER #${assignedSlot}`;
      const existingIdx = this.players.findIndex((p) => p.slotId === assignedSlot);
      const entry: RoomPlayerInfo = {
        peerId: remotePeerId,
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

      if (!this.welcomedSlots.has(assignedSlot)) {
        this.welcomedSlots.add(assignedSlot);
        this.callbacks.onClientLoadoutReceived(
          assignedSlot,
          playerName,
          msg.skillId,
          msg.mainCode
        );
        this.callbacks.onStatusChange(
          `${playerName} đã tham gia phòng ${this.roomCode} ở vị trí Chiến Xa #${assignedSlot}!`,
          null
        );
      }

      const welcome: PeerMessage = {
        type: 'HOST_WELCOME',
        assignedSlotId: assignedSlot,
        roomCode: this.roomCode,
        players: this.players,
        world: serializeWorldForSync(this.callbacks.getWorldState()),
      };
      this.sendToClient(assignedSlot, welcome);

      this.broadcastRoster();
      this.callbacks.onRosterChange([...this.players]);
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
    } else if (msg.type === 'CLIENT_INSTANT_MOVE_TO') {
      this.callbacks.onClientInstantMoveTo?.(assignedSlot, msg.gx, msg.gy);
    } else if (msg.type === 'CLIENT_INSTANT_SHOOT') {
      this.callbacks.onClientInstantShoot?.(assignedSlot, msg.targetX, msg.targetY);
    }
  }

  public createHostRoom(requestedCode?: string): void {
    this.disconnect();
    const code = cleanRoomCode(requestedCode || '') || generateShortRoomCode();
    this.roomCode = code;
    const fullPeerId = `${PEER_ID_PREFIX}${code}`;

    this.callbacks.onStatusChange(`Đang khởi tạo phòng ${code} trên máy chủ PeerJS...`, null);

    const peer = new Peer(fullPeerId, {
      debug: 1,
      config: PEER_ICE_CONFIG,
    });
    this.peer = peer;

    this.attachSignalingRelayHook(
      peer,
      (srcPeerId, packet) => {
        this.handleHostReceivedMessage(srcPeerId, packet);
      },
      (srcPeerId) => {
        this.removeClientByPeerId(srcPeerId);
      }
    );

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
        `Đã tạo phòng ${code} (Đang chờ người chơi khác kết nối...)`,
        null
      );
    });

    peer.on('connection', (conn) => {
      this.handleIncomingClientConnection(conn);
    });

    peer.on('disconnected', () => {
      if (this.peer && !this.peer.destroyed) {
        this.peer.reconnect();
      }
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
    const assignedSlot = this.findOrAssignSlotForPeer(conn.peer);
    if (assignedSlot === -1) {
      conn.on('open', () => {
        conn.close();
      });
      return;
    }

    this.clientConns.set(assignedSlot, conn);
    let webRtcOpened = false;

    conn.on('open', () => {
      webRtcOpened = true;
      const readyMsg: PeerMessage = {
        type: 'HOST_READY_FOR_HELLO',
        assignedSlotId: assignedSlot,
        roomCode: this.roomCode,
      };
      try {
        conn.send(readyMsg);
      } catch {
        // Ignore transient send error
      }
    });

    conn.on('data', (raw) => {
      const msg =
        typeof raw === 'string'
          ? (JSON.parse(raw) as PeerMessage)
          : (raw as PeerMessage);
      this.handleHostReceivedMessage(conn.peer, msg);
    });

    conn.on('close', () => {
      if (webRtcOpened) {
        this.removeClientByPeerId(conn.peer);
      }
    });
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
    this.hostPeerId = targetPeerId;

    this.callbacks.onStatusChange(
      `Đang kết nối vào phòng ${code}...`,
      null
    );

    const peer = new Peer({
      debug: 1,
      config: PEER_ICE_CONFIG,
    });
    this.peer = peer;

    const sendHelloPacket = () => {
      if (this.role === 'CLIENT') return;
      const hello: PeerMessage = {
        type: 'CLIENT_JOIN_HELLO',
        name: myName,
        skillId: mySkillId,
        mainCode: myMainCode,
      };
      this.sendToHost(hello);
    };

    const handleClientReceivedMessage = (msg: PeerMessage) => {
      if (!msg || typeof msg !== 'object') return;

      if (msg.type === 'PEER_LEAVE_NOTIFY') {
        this.clearJoinTimers();
        this.callbacks.onStatusChange(
          'Chủ phòng đã đóng phòng hoặc mất kết nối.',
          'Kết nối phòng đã đóng.'
        );
        this.disconnect();
        return;
      }

      if (msg.type === 'HOST_READY_FOR_HELLO') {
        sendHelloPacket();
      } else if (msg.type === 'HOST_WELCOME') {
        this.clearJoinTimers();
        this.role = 'CLIENT';
        this.mySlotId = msg.assignedSlotId;
        this.players = msg.players;
        this.callbacks.onRoleChange('CLIENT', msg.assignedSlotId, msg.roomCode);
        this.callbacks.onRosterChange([...this.players]);
        this.callbacks.onWorldSyncReceived(msg.world, msg.assignedSlotId);
        this.callbacks.onStatusChange(
          `Đã kết nối thành công vào phòng ${msg.roomCode}! Bạn điều khiển Chiến Xa #${msg.assignedSlotId}.`,
          null
        );
      } else if (msg.type === 'HOST_ROOM_ROSTER') {
        this.players = msg.players;
        this.callbacks.onRosterChange([...this.players]);
      } else if (msg.type === 'HOST_WORLD_STATE') {
        this.callbacks.onWorldSyncReceived(msg.world, this.mySlotId);
      }
    };

    this.attachSignalingRelayHook(
      peer,
      (_srcPeerId, packet) => {
        handleClientReceivedMessage(packet);
      },
      (srcPeerId) => {
        if (srcPeerId === targetPeerId) {
          this.clearJoinTimers();
          this.callbacks.onStatusChange(
            'Chủ phòng đã đóng phòng hoặc mất kết nối.',
            'Kết nối phòng đã đóng.'
          );
          this.disconnect();
        }
      }
    );

    this.joinTimeoutTimer = window.setTimeout(() => {
      if (this.role !== 'CLIENT') {
        this.clearJoinTimers();
        this.callbacks.onStatusChange(
          `Không thể kết nối vào phòng ${code}.`,
          'Quá thời gian chờ (12s). Hãy kiểm tra lại mã phòng từ Chủ Phòng!'
        );
      }
    }, 12000);

    peer.on('open', () => {
      const conn = peer.connect(targetPeerId, {
        reliable: true,
        serialization: 'json',
      });
      this.hostConn = conn;
      let webRtcOpened = false;

      // Immediately send CLIENT_JOIN_HELLO over the PeerJS WebSocket relay so connection
      // completes in <150ms without blocking on symmetric NAT / UDP hole-punching
      sendHelloPacket();
      this.clearJoinTimers();
      this.joinRetryTimer = window.setInterval(() => {
        if (this.role === 'CLIENT') {
          this.clearJoinTimers();
          return;
        }
        sendHelloPacket();
      }, 500);

      conn.on('open', () => {
        webRtcOpened = true;
        sendHelloPacket();
      });

      conn.on('data', (raw) => {
        const msg =
          typeof raw === 'string'
            ? (JSON.parse(raw) as PeerMessage)
            : (raw as PeerMessage);
        handleClientReceivedMessage(msg);
      });

      conn.on('close', () => {
        if (webRtcOpened) {
          this.clearJoinTimers();
          this.callbacks.onStatusChange(
            'Chủ phòng đã đóng phòng hoặc mất kết nối.',
            'Kết nối phòng đã đóng.'
          );
          this.disconnect();
        }
      });
    });

    peer.on('disconnected', () => {
      if (this.peer && !this.peer.destroyed) {
        this.peer.reconnect();
      }
    });

    peer.on('error', (err: any) => {
      this.clearJoinTimers();
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
    for (const slotId of this.clientPeerIds.keys()) {
      this.sendToClient(slotId, msg);
    }
  }

  public broadcastWorldState(world: GameWorldState): void {
    if (this.role !== 'HOST' || this.clientPeerIds.size === 0) return;
    const now = performance.now();
    const allowRelay = now - this.lastRelayWorldSyncAt >= 100;
    if (allowRelay) {
      this.lastRelayWorldSyncAt = now;
    }

    const msg: PeerMessage = {
      type: 'HOST_WORLD_STATE',
      world: serializeWorldForSync(world),
    };
    for (const slotId of this.clientPeerIds.keys()) {
      this.sendToClient(slotId, msg, !allowRelay);
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
    if (this.role === 'CLIENT') {
      const msg: PeerMessage = {
        type: 'CLIENT_UPDATE_LOADOUT',
        slotId: this.mySlotId,
        name,
        skillId,
        mainCode,
      };
      this.sendToHost(msg);
    }
  }

  public sendClientApplyMainCode(code: string): void {
    if (this.role === 'CLIENT') {
      const msg: PeerMessage = {
        type: 'CLIENT_APPLY_MAIN_CODE',
        slotId: this.mySlotId,
        code,
      };
      this.sendToHost(msg);
    }
  }

  public sendClientTriggerOverride(code: string): void {
    if (this.role === 'CLIENT') {
      const msg: PeerMessage = {
        type: 'CLIENT_TRIGGER_OVERRIDE',
        slotId: this.mySlotId,
        code,
      };
      this.sendToHost(msg);
    }
  }

  public sendClientInstantMoveTo(gx: number, gy: number): void {
    if (this.role === 'CLIENT') {
      const msg: PeerMessage = {
        type: 'CLIENT_INSTANT_MOVE_TO',
        slotId: this.mySlotId,
        gx,
        gy,
      };
      this.sendToHost(msg);
    }
  }

  public sendClientInstantShoot(targetX: number, targetY: number): void {
    if (this.role === 'CLIENT') {
      const msg: PeerMessage = {
        type: 'CLIENT_INSTANT_SHOOT',
        slotId: this.mySlotId,
        targetX,
        targetY,
      };
      this.sendToHost(msg);
    }
  }
}

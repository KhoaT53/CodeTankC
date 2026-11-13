import React, { useEffect, useRef, useState } from 'react';
import {
  Play,
  Users,
  Code2,
  Radar,
  Shield,
  Zap,
  Crosshair,
  Volume2,
  VolumeX,
  CheckCircle2,
  Sparkles,
  GripVertical,
  Columns3,
  Radio,
  LogIn,
  Copy,
  Check,
  LogOut,
} from 'lucide-react';
import {
  GRID_SIZE,
  SkillId,
  SKILLS,
  TileType,
  GameWorldState,
  BASE_MOVE_SPEED,
  BULLET_SPEED,
  COMPILE_COOLDOWN,
  CompetitorConfig,
} from '../game/types';
import { PLAYER_CODE_PRESETS } from '../game/presets';
import { NetworkRole, RoomPlayerInfo } from '../game/peerNetwork';

interface TitleLobbyScreenProps {
  worldRef: React.MutableRefObject<GameWorldState>;
  selectedSkill: SkillId;
  onSelectSkill: (skill: SkillId) => void;
  mainCode: string;
  onChangeMainCode: (code: string) => void;
  competitorConfigs: CompetitorConfig[];
  roomCode: string;
  networkRole: NetworkRole;
  mySlotId: number;
  roomPlayers: RoomPlayerInfo[];
  peerStatus: string;
  peerError: string | null;
  onCreatePeerRoom: () => void;
  onJoinPeerRoom: (code: string) => void;
  onLeavePeerRoom: () => void;
  muted: boolean;
  onToggleMute: () => void;
  onOpenMultiplayerModal: () => void;
  onStartMatch: () => void;
}

export const TitleLobbyScreen: React.FC<TitleLobbyScreenProps> = ({
  worldRef,
  selectedSkill,
  onSelectSkill,
  mainCode,
  onChangeMainCode,
  competitorConfigs,
  roomCode,
  networkRole,
  mySlotId,
  roomPlayers,
  peerStatus,
  peerError,
  onCreatePeerRoom,
  onJoinPeerRoom,
  onLeavePeerRoom,
  muted,
  onToggleMute,
  onOpenMultiplayerModal,
  onStartMatch,
}) => {
  const tankPreviewCanvasRef = useRef<HTMLCanvasElement>(null);
  const mapWrapperRef = useRef<HTMLDivElement>(null);
  const mapPreviewCanvasRef = useRef<HTMLCanvasElement>(null);
  const deckContainerRef = useRef<HTMLDivElement>(null);

  const [mapAvailSize, setMapAvailSize] = useState<number>(220);
  const [selectedPresetId, setSelectedPresetId] = useState<string>('balanced');
  const [rightTab, setRightTab] = useState<'MAP' | 'CODE'>('MAP');
  const [quickJoinCode, setQuickJoinCode] = useState<string>('');
  const [copiedCode, setCopiedCode] = useState<boolean>(false);

  // Resizable 3-column layout percentages for Lobby
  const [col1Pct, setCol1Pct] = useState<number>(32);
  const [col2Pct, setCol2Pct] = useState<number>(34);
  const [draggingDivider, setDraggingDivider] = useState<'DIV1' | 'DIV2' | null>(null);

  const activeSkillDef = SKILLS.find((s) => s.id === selectedSkill) ?? SKILLS[0];

  const handleResetLobbyColumns = () => {
    setCol1Pct(32);
    setCol2Pct(34);
  };

  const handleCopyShortCode = () => {
    if (!roomCode) return;
    navigator.clipboard?.writeText(roomCode).catch(() => {});
    setCopiedCode(true);
    setTimeout(() => setCopiedCode(false), 1800);
  };

  const colsRef = useRef({ col1Pct, col2Pct });
  colsRef.current = { col1Pct, col2Pct };

  const startLobbyDrag = (which: 'DIV1' | 'DIV2', e: React.MouseEvent) => {
    e.preventDefault();
    setDraggingDivider(which);

    const prevCursor = document.body.style.cursor;
    const prevSelect = document.body.style.userSelect;
    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';

    const onMouseMove = (ev: MouseEvent) => {
      const deck = deckContainerRef.current;
      if (!deck) return;
      const rect = deck.getBoundingClientRect();
      if (rect.width <= 300) return;

      const relX = ev.clientX - rect.left;
      const pct = (relX / rect.width) * 100;
      const c1 = colsRef.current.col1Pct;
      const c2 = colsRef.current.col2Pct;

      if (which === 'DIV1') {
        const totalFirstTwo = c1 + c2;
        const nextCol1 = Math.max(22, Math.min(totalFirstTwo - 22, pct));
        const nextCol2 = Math.max(22, totalFirstTwo - nextCol1);
        setCol1Pct(Number(nextCol1.toFixed(1)));
        setCol2Pct(Number(nextCol2.toFixed(1)));
      } else {
        const clampedSplit = Math.max(c1 + 22, Math.min(78, pct));
        const nextCol2 = clampedSplit - c1;
        setCol2Pct(Number(nextCol2.toFixed(1)));
      }
    };

    const onMouseUp = () => {
      setDraggingDivider(null);
      document.body.style.cursor = prevCursor;
      document.body.style.userSelect = prevSelect;
      window.removeEventListener('mousemove', onMouseMove);
      window.removeEventListener('mouseup', onMouseUp);
    };

    window.addEventListener('mousemove', onMouseMove);
    window.addEventListener('mouseup', onMouseUp);
  };

  // Observe available space for the 30x30 Island Minimap Preview so it fits every screen without tile overflow
  useEffect(() => {
    const wrapper = mapWrapperRef.current;
    if (!wrapper || rightTab !== 'MAP') return;

    const updateSize = () => {
      const rect = wrapper.getBoundingClientRect();
      const shortest = Math.floor(Math.min(rect.width, rect.height));
      if (shortest > 80) {
        setMapAvailSize(shortest);
      }
    };

    updateSize();
    const ro = new ResizeObserver(updateSize);
    ro.observe(wrapper);
    window.addEventListener('resize', updateSize);
    return () => {
      ro.disconnect();
      window.removeEventListener('resize', updateSize);
    };
  }, [rightTab, col1Pct, col2Pct]);

  // Animated 2D Tank Turntable & Skill Preview Canvas
  useEffect(() => {
    const canvas = tankPreviewCanvasRef.current;
    if (!canvas) return;
    let timerId = 0;
    let disposed = false;

    const renderTankShowcase = () => {
      if (disposed) return;
      const ctx = canvas.getContext('2d');
      if (!ctx) return;

      const t = performance.now() * 0.001;
      const W = canvas.width;
      const H = canvas.height;

      ctx.clearRect(0, 0, W, H);

      // Tactical Grid Backdrop
      ctx.fillStyle = '#071422';
      ctx.fillRect(0, 0, W, H);

      ctx.strokeStyle = 'rgba(16, 185, 129, 0.12)';
      ctx.lineWidth = 1;
      for (let x = 0; x < W; x += 24) {
        ctx.beginPath();
        ctx.moveTo(x, 0);
        ctx.lineTo(x, H);
        ctx.stroke();
      }
      for (let y = 0; y < H; y += 24) {
        ctx.beginPath();
        ctx.moveTo(0, y);
        ctx.lineTo(W, y);
        ctx.stroke();
      }

      const cx = W * 0.36;
      const cy = H * 0.52;

      // Rotating radar sweep
      ctx.save();
      ctx.translate(cx, cy);
      ctx.strokeStyle = 'rgba(56, 189, 248, 0.25)';
      ctx.lineWidth = 1.2;
      ctx.setLineDash([4, 4]);
      ctx.beginPath();
      ctx.arc(0, 0, 46, 0, Math.PI * 2);
      ctx.stroke();
      ctx.setLineDash([]);

      // Skill-specific aura preview
      ctx.strokeStyle = activeSkillDef.accentColor;
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(0, 0, 30 + Math.sin(t * 4) * 3, 0, Math.PI * 2);
      ctx.stroke();

      const scale = selectedSkill === SkillId.SHRINK ? 0.65 : 1.0;
      ctx.scale(scale, scale);
      if (selectedSkill === SkillId.PHASE_SHIFT) {
        ctx.globalAlpha = 0.62;
      }

      // Hull
      const hullAngle = Math.sin(t * 0.8) * 0.25;
      ctx.save();
      ctx.rotate(hullAngle);
      ctx.fillStyle = '#0f172a';
      ctx.fillRect(-20, -18, 40, 6);
      ctx.fillRect(-20, 12, 40, 6);

      ctx.fillStyle = '#10b981';
      ctx.strokeStyle = '#022c22';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.roundRect(-17, -13, 34, 26, 4);
      ctx.fill();
      ctx.stroke();
      ctx.restore();

      // Turret aiming right and firing preview shell
      const turretAngle = Math.sin(t * 1.6) * 0.35;
      ctx.save();
      ctx.rotate(turretAngle);
      ctx.fillStyle = '#1e293b';
      ctx.fillRect(0, -3.5, 25, 7);
      ctx.fillStyle = '#a7f3d0';
      ctx.beginPath();
      ctx.arc(0, 0, 9, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = '#0f172a';
      ctx.lineWidth = 1.5;
      ctx.stroke();

      // Simulated outgoing shell along turret vector
      const shellDist = 30 + ((t * 65) % 115);
      const isKb = selectedSkill === SkillId.KNOCKBACK_AMMO;
      ctx.fillStyle = isKb ? '#f43f5e' : '#fef08a';
      ctx.beginPath();
      ctx.arc(shellDist, 0, isKb ? 4.8 : 3.5, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();

      ctx.restore();

      // Oxy Coordinate & Speed Readout on Canvas
      ctx.fillStyle = '#94a3b8';
      ctx.font = '600 10px "JetBrains Mono", monospace';
      ctx.fillText(`CHIẾN XA #${mySlotId}`, 12, 16);
      ctx.fillStyle = activeSkillDef.accentColor;
      ctx.fillText(`KỸ NĂNG: ${activeSkillDef.nameVi.toUpperCase()}`, 12, H - 8);

      timerId = window.setTimeout(renderTankShowcase, 40);
    };

    renderTankShowcase();
    return () => {
      disposed = true;
      window.clearTimeout(timerId);
    };
  }, [selectedSkill, activeSkillDef, mySlotId]);

  // 30x30 Oxy Tactical Island Minimap Preview — strict integer cell sizing & clipping so tiles NEVER overflow
  useEffect(() => {
    const canvas = mapPreviewCanvasRef.current;
    if (!canvas || rightTab !== 'MAP') return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const pad = 18;
    const rawAvailable = Math.max(120, mapAvailSize - 4);
    const cell = Math.max(3, Math.floor((rawAvailable - pad * 2) / GRID_SIZE));
    const mapPx = cell * GRID_SIZE;
    const S = mapPx + pad * 2;

    if (canvas.width !== S || canvas.height !== S) {
      canvas.width = S;
      canvas.height = S;
    }

    const world = worldRef.current;

    // Deep Ocean Frame
    ctx.fillStyle = '#061a2b';
    ctx.fillRect(0, 0, S, S);

    // Clip strictly to the 30x30 island grid box so no tile or portal ever bleeds outside
    ctx.save();
    ctx.beginPath();
    ctx.rect(pad, pad, mapPx, mapPx);
    ctx.clip();

    // Draw 30x30 tiles (Oxy: gy=0 at bottom, gy=29 at top)
    for (let gy = 0; gy < GRID_SIZE; gy++) {
      for (let gx = 0; gx < GRID_SIZE; gx++) {
        const cx = pad + gx * cell;
        const cy = pad + (GRID_SIZE - 1 - gy) * cell;
        const isEdge = gx === 0 || gx === GRID_SIZE - 1 || gy === 0 || gy === GRID_SIZE - 1;
        const tile = world.grid[gy][gx];

        if (tile === TileType.BRICK) {
          ctx.fillStyle = '#9a3412';
        } else if (tile === TileType.CRATE) {
          ctx.fillStyle = '#d97706';
        } else if (tile === TileType.BOULDER) {
          ctx.fillStyle = '#64748b';
        } else {
          ctx.fillStyle = isEdge ? '#cbb074' : (gx + gy) % 2 === 0 ? '#285236' : '#234830';
        }
        ctx.fillRect(cx, cy, cell, cell);
      }
    }

    // Draw Portal Pairs & Shortcut connection lines
    for (const p of world.portals) {
      const ax = pad + (p.a.gx + 0.5) * cell;
      const ay = pad + (GRID_SIZE - (p.a.gy + 0.5)) * cell;
      const bx = pad + (p.b.gx + 0.5) * cell;
      const by = pad + (GRID_SIZE - (p.b.gy + 0.5)) * cell;

      ctx.strokeStyle = `${p.color}88`;
      ctx.lineWidth = 1.2;
      ctx.setLineDash([3, 3]);
      ctx.beginPath();
      ctx.moveTo(ax, ay);
      ctx.lineTo(bx, by);
      ctx.stroke();
      ctx.setLineDash([]);

      for (const [px, py] of [
        [ax, ay],
        [bx, by],
      ]) {
        ctx.fillStyle = p.color;
        ctx.beginPath();
        ctx.arc(px, py, Math.max(2.5, cell * 0.65), 0, Math.PI * 2);
        ctx.fill();
      }
    }

    // Draw 4 Tank Spawns
    for (const tk of world.tanks) {
      const tx = pad + tk.x * cell;
      const ty = pad + (GRID_SIZE - tk.y) * cell;
      ctx.fillStyle = tk.color;
      ctx.strokeStyle = '#ffffff';
      ctx.lineWidth = 1.2;
      ctx.beginPath();
      ctx.arc(tx, ty, Math.max(3, cell * 0.8), 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();

      ctx.fillStyle = '#ffffff';
      ctx.font = 'bold 9px "JetBrains Mono", monospace';
      ctx.textAlign = 'center';
      ctx.fillText(`#${tk.id}`, tx, Math.max(pad + 9, ty - 5));
    }

    ctx.restore();

    // Crisp Island Grid Frame
    ctx.strokeStyle = '#1e293b';
    ctx.lineWidth = 1.5;
    ctx.strokeRect(pad, pad, mapPx, mapPx);

    // Draw Oxy Axes labels in padding margin
    ctx.fillStyle = '#10b981';
    ctx.font = 'bold 9px "JetBrains Mono", monospace';
    ctx.textAlign = 'left';
    ctx.fillText('O(0,0)', pad, S - 4);
    ctx.textAlign = 'right';
    ctx.fillText('X=29 →', S - pad, S - 4);
    ctx.textAlign = 'left';
    ctx.fillText('↑ Y=29', pad, 12);
  }, [worldRef, rightTab, mapAvailSize]);

  const col3Pct = Math.max(22, Number((100 - col1Pct - col2Pct).toFixed(1)));

  return (
    <div className="fixed inset-0 z-40 bg-[#060e1a] text-slate-100 flex flex-col overflow-y-auto lg:overflow-hidden select-none">
      {/* 1. TOP COMMAND HEADER */}
      <header className="flex flex-wrap items-center justify-between gap-3 px-5 py-2.5 bg-[#0a1526] border-b border-slate-800 shrink-0">
        <div className="flex items-center gap-3">
          <svg
            className="w-9 h-9 shrink-0"
            viewBox="0 0 64 64"
            fill="none"
            xmlns="http://www.w3.org/2000/svg"
          >
            <rect
              x="4"
              y="4"
              width="56"
              height="56"
              rx="12"
              fill="#062c22"
              stroke="#10b981"
              strokeWidth="2.5"
            />
            <path
              d="M14 48H50M16 14V50"
              stroke="#38bdf8"
              strokeWidth="2"
              strokeDasharray="3 3"
            />
            <rect
              x="20"
              y="22"
              width="22"
              height="18"
              rx="3"
              fill="#10b981"
              stroke="#022c22"
              strokeWidth="2"
            />
            <circle cx="31" cy="31" r="6" fill="#a7f3d0" />
            <rect x="34" y="29" width="18" height="4" rx="1.5" fill="#a7f3d0" />
          </svg>
          <div>
            <div className="flex items-center gap-2">
              <h1
                className="text-lg sm:text-xl font-bold tracking-tight text-white"
                style={{ fontFamily: 'var(--font-display)' }}
              >
                CODETANK OXY: ISLAND BATTLE ROYALE
              </h1>
              <span className="text-xs font-mono text-emerald-400">
                · Đấu Trường Lập Trình C++ 30x30
              </span>
            </div>
            <p className="text-[11px] text-slate-400">
              Hệ trục tọa độ Oxy gốc O(0,0) ở Góc Dưới-Trái · Đấu Online thời gian thực qua PeerJS WebRTC · Kéo vách ngăn để chỉnh kích thước cột
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={handleResetLobbyColumns}
            title="Khôi phục tỉ lệ 3 cột mặc định ở màn hình chờ"
            className="px-2.5 py-1.5 text-xs font-medium bg-slate-800/90 hover:bg-slate-700 text-slate-300 rounded-lg border border-slate-700 flex items-center gap-1.5 cursor-pointer whitespace-nowrap"
          >
            <Columns3 className="w-3.5 h-3.5 text-emerald-400" />
            Đặt Lại Bố Cục
          </button>

          <button
            type="button"
            onClick={onOpenMultiplayerModal}
            className="px-3.5 py-1.5 text-xs font-semibold bg-slate-800 hover:bg-slate-700 text-sky-300 rounded-lg border border-slate-700 flex items-center gap-1.5 transition-colors cursor-pointer whitespace-nowrap"
          >
            <Users className="w-4 h-4" />
            Phòng Online &amp; Sửa Code 3 Bot
          </button>

          <button
            type="button"
            aria-label={muted ? 'Bật âm thanh' : 'Tắt âm thanh'}
            onClick={onToggleMute}
            className="p-2 bg-slate-800 hover:bg-slate-700 text-slate-300 rounded-lg border border-slate-700 cursor-pointer"
          >
            {muted ? <VolumeX className="w-4 h-4" /> : <Volume2 className="w-4 h-4" />}
          </button>
        </div>
      </header>

      {/* 2. MAIN 3-COLUMN RESIZABLE TACTICAL PREPARATION DECK */}
      <div
        ref={deckContainerRef}
        className="flex-1 min-h-0 flex flex-col lg:flex-row p-3.5 gap-2 lg:gap-0 overflow-y-auto lg:overflow-hidden"
      >
        {/* COLUMN 1: PLAYER TANK SHOWCASE, PEERJS QUICK ROOM BAR & 4-TANK ROSTER */}
        <section
          style={{ width: `${col1Pct}%` }}
          className="w-full lg:w-auto flex flex-col gap-2.5 min-h-0 overflow-y-auto pr-0.5 shrink-0"
        >
          <div className="bg-[#0b1628] border border-slate-800 rounded-xl p-3 flex flex-col gap-2">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Shield className="w-4 h-4 text-emerald-400" />
                <h2 className="text-xs font-bold uppercase tracking-wider text-slate-200">
                  Hồ Sơ Chiến Xa #{mySlotId} (Của Bạn)
                </h2>
              </div>
              <span className="text-[11px] font-mono text-emerald-400">
                Máu: 5 HP · Đạn: 5/5
              </span>
            </div>

            <canvas
              ref={tankPreviewCanvasRef}
              width={340}
              height={100}
              className="w-full h-[100px] rounded-lg border border-slate-800 block"
            />

            {/* Balanced Match Tempo & Physics Specs */}
            <div className="grid grid-cols-2 gap-1.5 text-xs font-mono tabular-nums">
              <div className="bg-slate-900/90 border border-slate-800/90 rounded-lg p-2">
                <span className="text-[10px] text-slate-400 block">Tốc Độ Di Chuyển</span>
                <strong className="text-emerald-400 text-xs">{BASE_MOVE_SPEED.toFixed(1)} ô/giây</strong>
                <span className="text-[10px] text-slate-500 block">Lướt: 3 ô / 0.3s (CD 8s)</span>
              </div>
              <div className="bg-slate-900/90 border border-slate-800/90 rounded-lg p-2">
                <span className="text-[10px] text-slate-400 block">Tốc Độ Đạn Pháo</span>
                <strong className="text-amber-300 text-xs">{BULLET_SPEED.toFixed(1)} ô/giây</strong>
                <span className="text-[10px] text-slate-500 block">Nảy tường gạch 2 lần</span>
              </div>
            </div>
          </div>

          {/* PeerJS Quick Online Room Card (Create Short ID or Join by Short ID) */}
          <div className="bg-[#0b1628] border border-slate-800 rounded-xl p-3 flex flex-col gap-2">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-1.5">
                <Radio className="w-3.5 h-3.5 text-emerald-400" />
                <h3 className="text-xs font-bold uppercase tracking-wider text-slate-200">
                  Phòng Chơi Online (PeerJS)
                </h3>
              </div>
              {networkRole !== 'OFFLINE' && roomCode && (
                <div className="flex items-center gap-1 bg-slate-950 border border-emerald-500/50 px-2 py-0.5 rounded text-xs font-mono">
                  <span className="text-slate-400">ID:</span>
                  <strong className="text-emerald-400">{roomCode}</strong>
                  <button
                    type="button"
                    onClick={handleCopyShortCode}
                    title="Sao chép mã phòng"
                    className="p-0.5 text-slate-300 hover:text-white cursor-pointer"
                  >
                    {copiedCode ? (
                      <Check className="w-3 h-3 text-emerald-400" />
                    ) : (
                      <Copy className="w-3 h-3" />
                    )}
                  </button>
                </div>
              )}
            </div>

            <div className="flex items-center gap-1.5">
              <button
                type="button"
                onClick={onCreatePeerRoom}
                className="px-2.5 py-1.5 text-xs font-bold bg-emerald-600 hover:bg-emerald-500 text-white rounded-lg flex items-center gap-1 cursor-pointer whitespace-nowrap"
              >
                <Radio className="w-3.5 h-3.5" />
                {networkRole === 'HOST' ? 'Đổi Mã Mới' : 'Tạo Phòng'}
              </button>

              <input
                type="text"
                aria-label="Nhập mã phòng PeerJS để tham gia"
                value={quickJoinCode}
                onChange={(e) => setQuickJoinCode(e.target.value.toUpperCase())}
                placeholder="Nhập mã ID..."
                className="flex-1 min-w-0 px-2.5 py-1.5 bg-slate-950 border border-slate-700 rounded-lg text-xs font-mono text-sky-300 uppercase focus:outline-none focus:border-sky-500"
              />

              <button
                type="button"
                onClick={() => onJoinPeerRoom(quickJoinCode)}
                className="px-2.5 py-1.5 text-xs font-bold bg-sky-500 hover:bg-sky-400 text-slate-950 rounded-lg flex items-center gap-1 cursor-pointer whitespace-nowrap"
              >
                <LogIn className="w-3.5 h-3.5" />
                Vào
              </button>

              {networkRole !== 'OFFLINE' && (
                <button
                  type="button"
                  onClick={onLeavePeerRoom}
                  title="Rời phòng Online"
                  className="p-1.5 bg-rose-950/90 hover:bg-rose-900 text-rose-200 border border-rose-700/60 rounded-lg cursor-pointer"
                >
                  <LogOut className="w-3.5 h-3.5" />
                </button>
              )}
            </div>

            <div className="text-[11px] text-slate-400 truncate">
              {peerError ? (
                <span className="text-rose-400">{peerError}</span>
              ) : (
                <span>{peerStatus}</span>
              )}
            </div>
          </div>

          {/* 4-Tank Match Roster */}
          <div className="bg-[#0b1628] border border-slate-800 rounded-xl p-3 flex-1 flex flex-col justify-start gap-2">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Crosshair className="w-4 h-4 text-sky-400" />
                <h3 className="text-xs font-bold uppercase tracking-wider text-slate-200">
                  Danh Sách 4 Chiến Xa Xuất Trận
                </h3>
              </div>
              <button
                type="button"
                onClick={onOpenMultiplayerModal}
                className="text-[11px] text-sky-400 hover:underline cursor-pointer"
              >
                Xem / Sửa Code Bot →
              </button>
            </div>

            <div className="space-y-1.5">
              {worldRef.current.tanks.map((tk) => {
                const onlineP = roomPlayers.find((p) => p.slotId === tk.id);
                const customCfg = competitorConfigs.find((c) => c.id === tk.id);
                const isMe = tk.id === mySlotId;
                const displayName = onlineP
                  ? `${onlineP.name}${isMe ? ' (Bạn)' : ' (Online)'}`
                  : tk.id === 1
                  ? tk.name
                  : customCfg?.name ?? tk.name;
                const displaySkillId = isMe
                  ? selectedSkill
                  : onlineP
                  ? onlineP.skillId
                  : customCfg?.skillId ?? tk.skillId;
                const sk = SKILLS.find((s) => s.id === displaySkillId) ?? SKILLS[0];
                return (
                  <div
                    key={tk.id}
                    className={`flex items-center justify-between px-2.5 py-1.5 rounded-lg border text-xs ${
                      isMe
                        ? 'bg-emerald-950/30 border-emerald-500/50'
                        : 'bg-slate-900/80 border-slate-800/90'
                    }`}
                  >
                    <div className="flex items-center gap-2 min-w-0">
                      <span
                        className="w-2.5 h-2.5 rounded-xs shrink-0"
                        style={{ backgroundColor: tk.color }}
                      />
                      <span className="font-bold text-slate-100 truncate">{displayName}</span>
                    </div>
                    <div className="flex items-center gap-1.5 shrink-0 font-mono text-[11px] tabular-nums">
                      <span className="text-slate-400">
                        ({tk.x.toFixed(1)}, {tk.y.toFixed(1)})
                      </span>
                      <span className="text-slate-600">·</span>
                      <span style={{ color: sk.accentColor }}>{sk.nameVi}</span>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </section>

        {/* RESIZE HANDLE 1: BETWEEN COL 1 & COL 2 */}
        <div
          role="separator"
          aria-orientation="vertical"
          aria-label="Kéo để chỉnh độ rộng cột Hồ Sơ Chiến Xa và cột Kỹ Năng"
          title="Núm kéo chuột trái/phải để chỉnh độ rộng cột (Nhấp đúp để đặt lại)"
          onMouseDown={(e) => startLobbyDrag('DIV1', e)}
          onDoubleClick={handleResetLobbyColumns}
          className={`hidden lg:flex w-3 shrink-0 items-center justify-center cursor-col-resize select-none group transition-colors ${
            draggingDivider === 'DIV1' ? 'bg-emerald-500/20' : 'hover:bg-emerald-500/10'
          }`}
        >
          <div
            className={`w-1 h-14 rounded-full flex items-center justify-center transition-colors ${
              draggingDivider === 'DIV1'
                ? 'bg-emerald-400'
                : 'bg-slate-800 group-hover:bg-emerald-400/80'
            }`}
          >
            <GripVertical className="w-3 h-3 text-slate-400 group-hover:text-slate-950 shrink-0" />
          </div>
        </div>

        {/* COLUMN 2: 6 SPECIAL SKILLS LOADOUT SELECTOR */}
        <section
          style={{ width: `${col2Pct}%` }}
          className="w-full lg:w-auto bg-[#0b1628] border border-slate-800 rounded-xl p-3.5 flex flex-col gap-2.5 min-h-0 overflow-y-auto shrink-0"
        >
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Zap className="w-4 h-4 text-amber-400" />
              <h2 className="text-xs font-bold uppercase tracking-wider text-slate-200">
                Chọn 1 Trong 6 Kỹ Năng Đặc Biệt (Hồi Chiêu 28s)
              </h2>
            </div>
            <span className="text-[11px] font-mono text-emerald-400">
              Đang chọn: #{selectedSkill}
            </span>
          </div>

          <div className="flex-1 flex flex-col gap-2 justify-between">
            {SKILLS.map((sk) => {
              const isSelected = selectedSkill === sk.id;
              return (
                <button
                  key={sk.id}
                  type="button"
                  onClick={() => onSelectSkill(sk.id)}
                  className={`w-full text-left p-2.5 rounded-xl border transition-all cursor-pointer ${
                    isSelected
                      ? 'bg-emerald-950/50 border-emerald-500 shadow-md'
                      : 'bg-slate-900/75 border-slate-800 hover:border-slate-700'
                  }`}
                >
                  <div className="flex items-center justify-between gap-2">
                    <div className="flex items-center gap-2">
                      <span
                        className="w-5 h-5 rounded flex items-center justify-center text-[11px] font-bold font-mono text-slate-950 shrink-0"
                        style={{ backgroundColor: sk.accentColor }}
                      >
                        {sk.id}
                      </span>
                      <span className="text-xs font-bold text-white">
                        {sk.nameVi}{' '}
                        <span className="text-slate-400 font-normal">({sk.codeName})</span>
                      </span>
                    </div>
                    <code className="text-[11px] font-mono text-emerald-300 shrink-0">
                      {sk.syntax}
                    </code>
                  </div>
                  <p className="text-[11px] text-slate-300 mt-1 leading-snug">
                    {sk.descriptionVi}
                  </p>
                </button>
              );
            })}
          </div>
        </section>

        {/* RESIZE HANDLE 2: BETWEEN COL 2 & COL 3 */}
        <div
          role="separator"
          aria-orientation="vertical"
          aria-label="Kéo để chỉnh độ rộng cột Kỹ Năng và cột Bản Đồ / Code"
          title="Núm kéo chuột trái/phải để chỉnh độ rộng cột Bản Đồ & Code (Nhấp đúp để đặt lại)"
          onMouseDown={(e) => startLobbyDrag('DIV2', e)}
          onDoubleClick={handleResetLobbyColumns}
          className={`hidden lg:flex w-3 shrink-0 items-center justify-center cursor-col-resize select-none group transition-colors ${
            draggingDivider === 'DIV2' ? 'bg-sky-500/20' : 'hover:bg-sky-500/10'
          }`}
        >
          <div
            className={`w-1 h-14 rounded-full flex items-center justify-center transition-colors ${
              draggingDivider === 'DIV2'
                ? 'bg-sky-400'
                : 'bg-slate-800 group-hover:bg-sky-400/80'
            }`}
          >
            <GripVertical className="w-3 h-3 text-slate-400 group-hover:text-slate-950 shrink-0" />
          </div>
        </div>

        {/* COLUMN 3: 30x30 ISLAND RADAR MINIMAP & PRE-MATCH C++ STRATEGY EDITOR */}
        <section
          style={{ width: `${col3Pct}%` }}
          className="w-full lg:w-auto flex-1 bg-[#0b1628] border border-slate-800 rounded-xl p-3.5 flex flex-col gap-2.5 min-h-0 overflow-hidden"
        >
          <div className="flex items-center justify-between gap-2 shrink-0">
            <div className="flex items-center gap-1.5">
              <button
                type="button"
                onClick={() => setRightTab('MAP')}
                className={`px-3 py-1.5 text-xs font-semibold rounded-lg flex items-center gap-1.5 cursor-pointer transition-colors ${
                  rightTab === 'MAP'
                    ? 'bg-emerald-600 text-white'
                    : 'bg-slate-900 text-slate-400 hover:text-slate-200'
                }`}
              >
                <Radar className="w-3.5 h-3.5" />
                Bản Đồ Đảo Oxy 30x30
              </button>
              <button
                type="button"
                onClick={() => setRightTab('CODE')}
                className={`px-3 py-1.5 text-xs font-semibold rounded-lg flex items-center gap-1.5 cursor-pointer transition-colors ${
                  rightTab === 'CODE'
                    ? 'bg-emerald-600 text-white'
                    : 'bg-slate-900 text-slate-400 hover:text-slate-200'
                }`}
              >
                <Code2 className="w-3.5 h-3.5" />
                Soạn Sẵn Code C++
              </button>
            </div>
          </div>

          {/* Preset Strategy Selector */}
          <div className="flex flex-col gap-1.5 shrink-0">
            <span className="text-[11px] font-semibold text-slate-300 flex items-center gap-1.5">
              <Sparkles className="w-3.5 h-3.5 text-amber-400" />
              Chọn Chiến Thuật C++ Xuất Trận:
            </span>
            <div className="grid grid-cols-2 gap-1.5">
              {PLAYER_CODE_PRESETS.map((preset) => {
                const active = selectedPresetId === preset.id;
                return (
                  <button
                    key={preset.id}
                    type="button"
                    onClick={() => {
                      setSelectedPresetId(preset.id);
                      onChangeMainCode(preset.code);
                    }}
                    className={`px-2.5 py-1.5 rounded-lg border text-left transition-colors cursor-pointer ${
                      active
                        ? 'bg-sky-950/60 border-sky-400 text-white'
                        : 'bg-slate-900/80 border-slate-800 text-slate-300 hover:border-slate-700'
                    }`}
                  >
                    <div className="text-xs font-bold truncate">{preset.nameVi}</div>
                    <div className="text-[10px] text-sky-300 font-mono mt-0.5 truncate">
                      {preset.badgeVi}
                    </div>
                  </button>
                );
              })}
            </div>
          </div>

          {rightTab === 'MAP' ? (
            <div className="flex-1 flex flex-col items-center justify-between bg-[#061423] border border-slate-800 rounded-xl p-2.5 gap-2 min-h-0 overflow-hidden">
              <div
                ref={mapWrapperRef}
                className="flex-1 w-full min-h-[150px] flex items-center justify-center overflow-hidden"
              >
                <canvas
                  ref={mapPreviewCanvasRef}
                  className="rounded border border-slate-800 block max-w-full max-h-full"
                />
              </div>
              <div className="w-full grid grid-cols-2 gap-x-2 gap-y-0.5 text-[10px] text-slate-300 font-mono px-1 shrink-0">
                <span>• Cổng Xanh: (4,14) ↔ (25,15)</span>
                <span>• Cổng Tím: (14,4) ↔ (15,25)</span>
                <span>• Tường Gạch (1): Nảy đạn 2 lần</span>
                <span>• Vật phẩm: Ngẫu nhiên (Tối đa 3)</span>
              </div>
            </div>
          ) : (
            <div className="flex-1 flex flex-col min-h-0 bg-[#070d17] border border-slate-800 rounded-xl overflow-hidden select-text">
              <div className="px-3 py-1.5 bg-slate-900 border-b border-slate-800 text-[11px] text-slate-400 font-mono">
                main_ai.cpp (Sẽ chạy tự động khi bắt đầu trận)
              </div>
              <textarea
                aria-label="Chỉnh sửa trước chương trình C++ tại sảnh chờ"
                value={mainCode}
                onChange={(e) => onChangeMainCode(e.target.value)}
                spellCheck={false}
                className="code-editor flex-1 w-full p-3 bg-transparent text-slate-100 text-xs font-mono leading-relaxed resize-none focus:outline-none"
              />
            </div>
          )}
        </section>
      </div>

      {/* 3. BOTTOM LAUNCH CONTROL BAR */}
      <footer className="px-5 py-3 bg-[#0a1526] border-t border-slate-800 flex flex-wrap items-center justify-between gap-3 shrink-0">
        <div className="flex flex-wrap items-center gap-4 text-xs text-slate-300">
          <span className="flex items-center gap-1.5">
            <CheckCircle2 className="w-4 h-4 text-emerald-400" />
            Kỹ năng: <strong className="text-emerald-300">{activeSkillDef.nameVi}</strong>
          </span>
          <span aria-hidden="true" className="text-slate-700">·</span>
          <span>
            Chiến thuật:{' '}
            <strong className="text-sky-300">
              {PLAYER_CODE_PRESETS.find((p) => p.id === selectedPresetId)?.nameVi}
            </strong>
          </span>
          <span aria-hidden="true" className="text-slate-700">·</span>
          <span>
            Trạng thái Phòng:{' '}
            <strong className="text-white tabular-nums">
              {networkRole === 'OFFLINE'
                ? 'Offline (Đấu 3 Bot)'
                : `Online [${roomCode}] · ${roomPlayers.length}/4 người chơi`}
            </strong>
          </span>
        </div>

        <div className="flex items-center gap-3">
          {networkRole === 'CLIENT' ? (
            <span className="px-5 py-2.5 text-xs font-bold bg-sky-950/80 text-sky-300 border border-sky-500/50 rounded-xl">
              Đang chờ Chủ Phòng (#1) bấm Bắt Đầu Trận Đấu...
            </span>
          ) : (
            <button
              type="button"
              data-start="true"
              onClick={onStartMatch}
              className="px-7 py-2.5 text-sm font-bold bg-emerald-500 hover:bg-emerald-400 text-slate-950 rounded-xl shadow-lg flex items-center gap-2 transition-colors cursor-pointer whitespace-nowrap"
            >
              <Play className="w-4 h-4 fill-current" />
              Bắt Đầu Trận Đấu (Xuất Trận)
            </button>
          )}
        </div>
      </footer>
    </div>
  );
};

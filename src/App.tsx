import React, { useEffect, useRef, useState, useCallback } from 'react';
import {
  Play,
  Pause,
  RotateCcw,
  Grid,
  Radar,
  Volume2,
  VolumeX,
  Users,
  Trophy,
  Skull,
  ShieldAlert,
  LogOut,
  GripVertical,
  Columns3,
  Radio,
} from 'lucide-react';
import {
  SkillId,
  SKILLS,
  GameWorldState,
  GameShellState,
  CompetitorConfig,
} from './game/types';
import {
  createInitialWorldState,
  stepWorldSimulation,
  triggerLiveOverride,
  executeInstantMoveTo,
  executeInstantShoot,
  addConsoleLog,
  DEFAULT_COMPETITOR_CONFIGS,
} from './game/engine';
import { compileCppSource } from './game/cppInterpreter';
import { PLAYER_STARTER_CODE } from './game/presets';
import { soundFX } from './game/audio';
import {
  PeerRoomManager,
  NetworkRole,
  RoomPlayerInfo,
  applySyncedWorldToClient,
} from './game/peerNetwork';
import { IslandCanvas } from './components/IslandCanvas';
import { CodeWorkspace } from './components/CodeWorkspace';
import { MultiplayerModal } from './components/MultiplayerModal';
import { TitleLobbyScreen } from './components/TitleLobbyScreen';

interface HudSnapshot {
  shellState: GameShellState;
  matchTime: number;
  winnerId: number | null;
  tanks: Array<{
    id: number;
    name: string;
    isPlayer: boolean;
    color: string;
    x: number;
    y: number;
    hp: number;
    maxHp: number;
    ammo: number;
    maxAmmo: number;
    alive: boolean;
    reloadTimer: number;
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
  }>;
  logs: GameWorldState['logs'];
}

interface LayoutPreferences {
  leftSidebarPct: number;
  centerMapPct: number;
  mainHeightPct: number;
  overrideHeightPct: number;
}

const DEFAULT_LAYOUT: LayoutPreferences = {
  leftSidebarPct: 18,
  centerMapPct: 52,
  mainHeightPct: 45,
  overrideHeightPct: 27,
};

const LAYOUT_STORAGE_KEY = 'codetank_layout_v3';

function loadInitialLayout(): LayoutPreferences {
  try {
    const raw = window.localStorage.getItem(LAYOUT_STORAGE_KEY);
    if (!raw) return DEFAULT_LAYOUT;
    const parsed = JSON.parse(raw);
    const leftSidebarPct =
      typeof parsed.leftSidebarPct === 'number'
        ? Math.max(14, Math.min(28, parsed.leftSidebarPct))
        : DEFAULT_LAYOUT.leftSidebarPct;
    const centerMapPct =
      typeof parsed.centerMapPct === 'number'
        ? Math.max(28, Math.min(80 - leftSidebarPct, parsed.centerMapPct))
        : DEFAULT_LAYOUT.centerMapPct;
    return {
      leftSidebarPct,
      centerMapPct,
      mainHeightPct:
        typeof parsed.mainHeightPct === 'number'
          ? Math.max(16, Math.min(72, parsed.mainHeightPct))
          : DEFAULT_LAYOUT.mainHeightPct,
      overrideHeightPct:
        typeof parsed.overrideHeightPct === 'number'
          ? Math.max(14, Math.min(62, parsed.overrideHeightPct))
          : DEFAULT_LAYOUT.overrideHeightPct,
    };
  } catch {
    return DEFAULT_LAYOUT;
  }
}

function extractHudSnapshot(w: GameWorldState): HudSnapshot {
  return {
    shellState: w.shellState,
    matchTime: w.matchTime,
    winnerId: w.winnerId,
    tanks: w.tanks.map((t) => ({
      id: t.id,
      name: t.name,
      isPlayer: t.isPlayer,
      color: t.color,
      x: t.x,
      y: t.y,
      hp: t.hp,
      maxHp: t.maxHp,
      ammo: t.ammo,
      maxAmmo: t.maxAmmo,
      alive: t.alive,
      reloadTimer: t.reloadTimer,
      dashCooldown: t.dashCooldown,
      skillId: t.skillId,
      skillCooldown: t.skillCooldown,
      activeSkillTimer: t.activeSkillTimer,
      knockbackBulletsBuff: t.knockbackBulletsBuff,
      compileTimer: t.compileTimer,
      executingOverride: t.executingOverride,
      lastError: t.lastError,
      kills: t.kills,
      damageDealt: t.damageDealt,
    })),
    logs: [...w.logs],
  };
}

export default function App() {
  const isAutoStart =
    typeof window !== 'undefined' &&
    new URLSearchParams(window.location.search).get('autostart') === '1';

  const [selectedSkill, setSelectedSkill] = useState<SkillId>(SkillId.BLINK);
  const [myPlayerName, setMyPlayerName] = useState<string>('YOU (TANK #1)');
  const [roomCode, setRoomCode] = useState<string>('');
  const [networkRole, setNetworkRole] = useState<NetworkRole>('OFFLINE');
  const [mySlotId, setMySlotId] = useState<number>(1);
  const [roomPlayers, setRoomPlayers] = useState<RoomPlayerInfo[]>([]);
  const [peerStatus, setPeerStatus] = useState<string>('Chế độ Offline (Đấu với 3 AI Bot)');
  const [peerError, setPeerError] = useState<string | null>(null);

  const [mainCode, setMainCode] = useState<string>(PLAYER_STARTER_CODE);
  const [competitorConfigs, setCompetitorConfigs] = useState<CompetitorConfig[]>(() =>
    DEFAULT_COMPETITOR_CONFIGS.map((c) => ({ ...c }))
  );
  const [overrideCode, setOverrideCode] = useState<string>(
    'dash("N");\nautoFire(3, "RICOCHET");'
  );

  const [showGrid, setShowGrid] = useState<boolean>(true);
  const [showSensor, setShowSensor] = useState<boolean>(true);
  const [muted, setMuted] = useState<boolean>(false);
  const [isRoomModalOpen, setIsRoomModalOpen] = useState<boolean>(false);

  // Draggable 3-Column Split-Pane Layout State
  const [layout, setLayout] = useState<LayoutPreferences>(loadInitialLayout);
  const [activeDrag, setActiveDrag] = useState<'LEFT_SIDEBAR' | 'MAIN_COLS' | null>(null);
  const mainContainerRef = useRef<HTMLElement>(null);

  useEffect(() => {
    try {
      window.localStorage.setItem(LAYOUT_STORAGE_KEY, JSON.stringify(layout));
    } catch {
      // Ignore storage quota errors
    }
  }, [layout]);

  const startMainDrag = useCallback(
    (which: 'LEFT_SIDEBAR' | 'MAIN_COLS', e: React.MouseEvent) => {
      e.preventDefault();
      setActiveDrag(which);

      const prevCursor = document.body.style.cursor;
      const prevSelect = document.body.style.userSelect;
      document.body.style.cursor = 'col-resize';
      document.body.style.userSelect = 'none';

      const onMouseMove = (ev: MouseEvent) => {
        const container = mainContainerRef.current;
        if (!container) return;
        const rect = container.getBoundingClientRect();
        if (rect.width <= 300) return;
        const cursorPct = ((ev.clientX - rect.left) / rect.width) * 100;

        if (which === 'LEFT_SIDEBAR') {
          setLayout((prev) => {
            const totalLeftAndCenter = prev.leftSidebarPct + prev.centerMapPct;
            const maxLeft = Math.min(28, totalLeftAndCenter - 28);
            const newLeft = Math.max(14, Math.min(maxLeft, Number(cursorPct.toFixed(1))));
            const newCenter = Number((totalLeftAndCenter - newLeft).toFixed(1));
            return {
              ...prev,
              leftSidebarPct: newLeft,
              centerMapPct: newCenter,
            };
          });
        } else {
          setLayout((prev) => {
            const rawCenter = cursorPct - prev.leftSidebarPct;
            const maxCenter = Math.min(66, 80 - prev.leftSidebarPct);
            const newCenter = Math.max(28, Math.min(maxCenter, Number(rawCenter.toFixed(1))));
            return {
              ...prev,
              centerMapPct: newCenter,
            };
          });
        }
      };

      const onMouseUp = () => {
        setActiveDrag(null);
        document.body.style.cursor = prevCursor;
        document.body.style.userSelect = prevSelect;
        window.removeEventListener('mousemove', onMouseMove);
        window.removeEventListener('mouseup', onMouseUp);
      };

      window.addEventListener('mousemove', onMouseMove);
      window.addEventListener('mouseup', onMouseUp);
    },
    []
  );

  const handleResetAllLayout = useCallback(() => {
    setLayout(DEFAULT_LAYOUT);
  }, []);

  const handleChangeCodeVerticalSplit = useCallback(
    (mainHeightPct: number, overrideHeightPct: number) => {
      setLayout((prev) => ({ ...prev, mainHeightPct, overrideHeightPct }));
    },
    []
  );

  const handleResetCodeVerticalSplit = useCallback(() => {
    setLayout((prev) => ({
      ...prev,
      mainHeightPct: DEFAULT_LAYOUT.mainHeightPct,
      overrideHeightPct: DEFAULT_LAYOUT.overrideHeightPct,
    }));
  }, []);

  const worldRef = useRef<GameWorldState>(
    createInitialWorldState(
      SkillId.BLINK,
      PLAYER_STARTER_CODE,
      'OFFLINE',
      'OXY-3030',
      DEFAULT_COMPETITOR_CONFIGS
    )
  );

  if (isAutoStart && worldRef.current.shellState === 'title') {
    worldRef.current.shellState = 'playing';
  }

  const [hud, setHud] = useState<HudSnapshot>(() => extractHudSnapshot(worldRef.current));

  const networkRoleRef = useRef<NetworkRole>(networkRole);
  networkRoleRef.current = networkRole;
  const myPlayerNameRef = useRef<string>(myPlayerName);
  myPlayerNameRef.current = myPlayerName;
  const selectedSkillRef = useRef<SkillId>(selectedSkill);
  selectedSkillRef.current = selectedSkill;

  // Mirror shellState to document.body.dataset.state & expose window.__GAME_STATE__ hook
  useEffect(() => {
    document.body.dataset.state = hud.shellState;
    (window as any).__GAME_STATE__ = () => {
      const w = worldRef.current;
      const p = w.tanks[0];
      return {
        shellState: w.shellState,
        matchTime: w.matchTime,
        bulletCount: w.bullets.length,
        player: p
          ? {
              x: p.x,
              y: p.y,
              hp: p.hp,
              ammo: p.ammo,
              turretAngle: p.turretAngle,
              compileTimer: p.compileTimer,
              executingOverride: p.executingOverride,
              overrideQueueLen: p.overrideQueue.length,
            }
          : null,
        latestLogs: w.logs.slice(0, 5).map((l) => l.message),
      };
    };
  }, [hud.shellState]);

  // Initialize PeerRoomManager once
  const peerManagerRef = useRef<PeerRoomManager | null>(null);
  useEffect(() => {
    const mgr = new PeerRoomManager({
      onStatusChange: (status, err) => {
        setPeerStatus(status);
        setPeerError(err);
      },
      onRoleChange: (role, slotId, code) => {
        setNetworkRole(role);
        setMySlotId(slotId);
        if (code) setRoomCode(code);
      },
      onRosterChange: (players) => {
        setRoomPlayers(players);
      },
      onClientLoadoutReceived: (slotId, name, skillId, code) => {
        setCompetitorConfigs((prev) =>
          prev.map((c) => (c.id === slotId ? { id: slotId, name, skillId, mainCode: code } : c))
        );
        const targetTank = worldRef.current.tanks.find((t) => t.id === slotId);
        if (targetTank) {
          targetTank.name = name;
          targetTank.skillId = skillId;
          targetTank.mainCode = code;
          targetTank.setupDone = false;
          targetTank.actionQueue = [];
          addConsoleLog(
            worldRef.current,
            name,
            'INFO',
            `Đã đồng bộ trang bị & code C++ của Chiến Xa #${slotId} qua PeerJS.`
          );
          setHud(extractHudSnapshot(worldRef.current));
        }
      },
      onClientApplyMainCode: (slotId, code) => {
        const targetTank = worldRef.current.tanks.find((t) => t.id === slotId);
        if (!targetTank) return;
        try {
          compileCppSource(code);
          targetTank.mainCode = code;
          targetTank.setupDone = false;
          targetTank.actionQueue = [];
          targetTank.lastError = null;
          setCompetitorConfigs((prev) =>
            prev.map((c) => (c.id === slotId ? { ...c, mainCode: code } : c))
          );
          addConsoleLog(
            worldRef.current,
            targetTank.name,
            'INFO',
            `Chiến Xa #${slotId} đã nạp lại chương trình C++ chính.`
          );
        } catch (err: any) {
          const errMsg = err?.message || 'Lỗi cú pháp C++';
          targetTank.lastError = errMsg;
          addConsoleLog(worldRef.current, targetTank.name, 'ERROR', errMsg);
        }
      },
      onClientTriggerOverride: (slotId, code) => {
        triggerLiveOverride(worldRef.current, slotId, code);
      },
      onClientInstantMoveTo: (slotId, gx, gy) => {
        executeInstantMoveTo(worldRef.current, slotId, gx, gy);
        setHud(extractHudSnapshot(worldRef.current));
      },
      onClientInstantShoot: (slotId, targetX, targetY) => {
        executeInstantShoot(worldRef.current, slotId, targetX, targetY);
        setHud(extractHudSnapshot(worldRef.current));
      },
      onWorldSyncReceived: (payload, assignedSlotId) => {
        applySyncedWorldToClient(worldRef.current, payload, assignedSlotId);
        document.body.dataset.state = worldRef.current.shellState;
        setHud(extractHudSnapshot(worldRef.current));
      },
      getWorldState: () => worldRef.current,
      getHostInfo: () => ({
        name: myPlayerNameRef.current,
        skillId: selectedSkillRef.current,
      }),
    });

    peerManagerRef.current = mgr;
    return () => {
      mgr.disconnect();
      peerManagerRef.current = null;
    };
  }, []);

  // Sync Client's loadout to Host whenever Client changes name, skill, or mainCode in Lobby
  useEffect(() => {
    if (networkRole === 'CLIENT' || networkRole === 'HOST') {
      peerManagerRef.current?.sendClientLoadoutUpdate(myPlayerName, selectedSkill, mainCode);
    }
  }, [networkRole, myPlayerName, selectedSkill, mainCode]);

  // Simulation Loop (30Hz tick with PeerJS Host -> Client world state broadcast)
  useEffect(() => {
    let lastTime = performance.now();
    let hudAccum = 0;
    let netSyncTick = 0;

    const intervalId = window.setInterval(() => {
      const now = performance.now();
      const rawDt = (now - lastTime) / 1000;
      lastTime = now;

      if (networkRoleRef.current === 'CLIENT') {
        // Client receives authoritative world state from Host via WebRTC DataChannel
        return;
      }

      const prevShell = worldRef.current.shellState;
      stepWorldSimulation(worldRef.current, rawDt);

      netSyncTick++;
      if (
        networkRoleRef.current === 'HOST' &&
        (netSyncTick % 2 === 0 || worldRef.current.shellState !== prevShell)
      ) {
        peerManagerRef.current?.broadcastWorldState(worldRef.current);
      }

      hudAccum += rawDt;
      if (hudAccum >= 0.12 || worldRef.current.shellState !== prevShell) {
        hudAccum = 0;
        setHud(extractHudSnapshot(worldRef.current));
      }
    }, 32);

    return () => window.clearInterval(intervalId);
  }, []);

  const handleCreatePeerRoom = useCallback((customCode?: string) => {
    const safeCode = typeof customCode === 'string' ? customCode : undefined;
    peerManagerRef.current?.createHostRoom(safeCode);
  }, []);

  const handleJoinPeerRoom = useCallback(
    (targetCode: string) => {
      peerManagerRef.current?.joinRoom(targetCode, myPlayerName, selectedSkill, mainCode);
    },
    [myPlayerName, selectedSkill, mainCode]
  );

  const handleLeavePeerRoom = useCallback(() => {
    peerManagerRef.current?.disconnect();
  }, []);

  const handleStartMatch = useCallback(() => {
    if (networkRole === 'CLIENT') return;
    const mode = networkRole === 'HOST' ? 'ONLINE' : 'OFFLINE';
    const fresh = createInitialWorldState(
      selectedSkill,
      mainCode,
      mode,
      roomCode || 'OXY-3030',
      competitorConfigs
    );
    fresh.tanks[0].name = myPlayerName || 'YOU (TANK #1)';
    fresh.shellState = 'playing';
    worldRef.current = fresh;
    document.body.dataset.state = 'playing';
    setHud(extractHudSnapshot(fresh));
    peerManagerRef.current?.broadcastWorldState(fresh);

    if (document.activeElement instanceof HTMLElement) {
      document.activeElement.blur();
    }
  }, [selectedSkill, mainCode, networkRole, roomCode, competitorConfigs, myPlayerName]);

  const handleResetMatch = useCallback(() => {
    if (networkRole === 'CLIENT') return;
    const mode = networkRole === 'HOST' ? 'ONLINE' : 'OFFLINE';
    const fresh = createInitialWorldState(
      selectedSkill,
      mainCode,
      mode,
      roomCode || 'OXY-3030',
      competitorConfigs
    );
    fresh.tanks[0].name = myPlayerName || 'YOU (TANK #1)';
    fresh.shellState = 'playing';
    worldRef.current = fresh;
    document.body.dataset.state = 'playing';
    setHud(extractHudSnapshot(fresh));
    peerManagerRef.current?.broadcastWorldState(fresh);
  }, [selectedSkill, mainCode, networkRole, roomCode, competitorConfigs, myPlayerName]);

  const handleExitToLobby = useCallback(() => {
    if (networkRole === 'CLIENT') {
      peerManagerRef.current?.disconnect();
    }
    const mode = networkRole === 'HOST' ? 'ONLINE' : 'OFFLINE';
    const fresh = createInitialWorldState(
      selectedSkill,
      mainCode,
      mode,
      roomCode || 'OXY-3030',
      competitorConfigs
    );
    fresh.tanks[0].name = myPlayerName || 'YOU (TANK #1)';
    fresh.shellState = 'title';
    worldRef.current = fresh;
    document.body.dataset.state = 'title';
    setHud(extractHudSnapshot(fresh));
    peerManagerRef.current?.broadcastWorldState(fresh);
  }, [selectedSkill, mainCode, networkRole, roomCode, competitorConfigs, myPlayerName]);

  const handleTogglePause = useCallback(() => {
    if (networkRole === 'CLIENT') return;
    const w = worldRef.current;
    if (w.shellState === 'playing') {
      w.shellState = 'paused';
    } else if (w.shellState === 'paused') {
      w.shellState = 'playing';
    }
    document.body.dataset.state = w.shellState;
    setHud(extractHudSnapshot(w));
    peerManagerRef.current?.broadcastWorldState(w);
  }, [networkRole]);

  // Keyboard shortcuts: Enter/Space on title screen starts; Escape pauses/resumes when not typing in textarea or modal
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement)?.tagName;
      if (tag === 'TEXTAREA' || tag === 'INPUT' || tag === 'SELECT' || isRoomModalOpen) return;

      if (worldRef.current.shellState === 'title' && (e.key === 'Enter' || e.key === ' ')) {
        e.preventDefault();
        handleStartMatch();
      } else if (
        (worldRef.current.shellState === 'playing' || worldRef.current.shellState === 'paused') &&
        (e.key === 'Escape' || e.key === 'p' || e.key === 'P')
      ) {
        e.preventDefault();
        handleTogglePause();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [handleStartMatch, handleTogglePause, isRoomModalOpen]);

  const handleApplyMainCode = (newCode: string): { ok: boolean; error?: string } => {
    try {
      compileCppSource(newCode);
    } catch (err: any) {
      const msg = err?.message || 'Lỗi cú pháp C++';
      const myTank = worldRef.current.tanks.find((t) => t.id === mySlotId) ?? worldRef.current.tanks[0];
      if (myTank) {
        myTank.lastError = msg;
        addConsoleLog(worldRef.current, myTank.name, 'ERROR', msg);
      }
      setHud(extractHudSnapshot(worldRef.current));
      return { ok: false, error: msg };
    }

    if (networkRole === 'CLIENT') {
      peerManagerRef.current?.sendClientApplyMainCode(newCode);
      return { ok: true };
    }

    const player = worldRef.current.tanks[0];
    player.mainCode = newCode;
    player.setupDone = false;
    player.actionQueue = [];
    player.lastError = null;
    addConsoleLog(
      worldRef.current,
      player.name,
      'INFO',
      'Đã biên dịch và nạp lại chương trình C++ chính (setup & loop).'
    );
    setHud(extractHudSnapshot(worldRef.current));
    return { ok: true };
  };

  const handleTriggerOverride = (code: string) => {
    try {
      compileCppSource(`void __override__() {\n${code}\n}`);
    } catch (err: any) {
      const msg = err?.message || 'Lỗi cú pháp C++';
      return { ok: false, error: msg };
    }

    if (networkRole === 'CLIENT') {
      peerManagerRef.current?.sendClientTriggerOverride(code);
      return { ok: true };
    }

    const res = triggerLiveOverride(worldRef.current, 1, code);
    setHud(extractHudSnapshot(worldRef.current));
    return res;
  };

  const handleSkillChange = (newSkill: SkillId) => {
    setSelectedSkill(newSkill);
    const myTank = worldRef.current.tanks.find((t) => t.id === mySlotId);
    if (myTank && networkRole !== 'CLIENT') {
      myTank.skillId = newSkill;
      setHud(extractHudSnapshot(worldRef.current));
    }
  };

  const handleChangeMyPlayerName = (name: string) => {
    setMyPlayerName(name);
    if (networkRole !== 'CLIENT') {
      const hostTank = worldRef.current.tanks[0];
      if (hostTank) {
        hostTank.name = name || 'YOU (TANK #1)';
        setHud(extractHudSnapshot(worldRef.current));
      }
    }
  };

  const handleUpdateCompetitorCode = (
    tankId: number,
    name: string,
    skillId: SkillId,
    code: string
  ) => {
    setCompetitorConfigs((prev) =>
      prev.map((c) => (c.id === tankId ? { id: tankId, name, skillId, mainCode: code } : c))
    );

    const t = worldRef.current.tanks.find((tk) => tk.id === tankId);
    if (t) {
      t.name = name;
      t.skillId = skillId;
      t.mainCode = code;
      t.setupDone = false;
      t.actionQueue = [];
      setHud(extractHudSnapshot(worldRef.current));
    }
  };

  const handleSelectCanvasCoord = (gx: number, gy: number) => {
    if (selectedSkill === SkillId.BLINK) {
      setOverrideCode(`useSkill(${gx}, ${gy});\nautoFire(2, "DIRECT");`);
    } else {
      setOverrideCode(`moveTo(${gx}, ${gy}, true, "SAFEST");\nautoFire(2, "DIRECT");`);
    }
  };

  const handleInstantMoveTo = (gx: number, gy: number) => {
    if (networkRole === 'CLIENT') {
      peerManagerRef.current?.sendClientInstantMoveTo(gx, gy);
      return;
    }
    executeInstantMoveTo(worldRef.current, 1, gx, gy);
    setHud(extractHudSnapshot(worldRef.current));
  };

  const handleInstantShoot = (x: number, y: number) => {
    if (networkRole === 'CLIENT') {
      peerManagerRef.current?.sendClientInstantShoot(x, y);
      return;
    }
    executeInstantShoot(worldRef.current, 1, x, y);
    setHud(extractHudSnapshot(worldRef.current));
  };

  const playerSnap = hud.tanks.find((t) => t.id === mySlotId) ?? hud.tanks[0];
  const rightWidthPct = Number((100 - layout.leftSidebarPct - layout.centerMapPct).toFixed(1));

  return (
    <main
      ref={mainContainerRef}
      className="w-screen h-screen bg-[#07101c] text-slate-100 flex flex-col lg:flex-row overflow-hidden relative"
    >
      {/* COLUMN 1 (LEFT SIDEBAR): MATCH CONTROLS, SKILL SELECTOR, AND 4 TANK STATUS CARDS */}
      <aside
        data-testid="left-hud-sidebar"
        style={{ width: `${layout.leftSidebarPct}%` }}
        className="w-full lg:w-auto h-full flex flex-col p-2 gap-2 overflow-hidden shrink-0 bg-[#081220]"
      >
        {/* Top Match Control Panel */}
        <div className="flex flex-col gap-2 p-2.5 bg-[#0d1829] border border-slate-800 rounded-lg shrink-0">
          {/* Brand Title + Utility Buttons */}
          <div className="flex items-center justify-between gap-1.5">
            <div className="flex items-center gap-1.5 min-w-0">
              <svg className="w-4 h-4 text-emerald-400 shrink-0" viewBox="0 0 24 24" fill="none">
                <rect
                  x="3"
                  y="6"
                  width="14"
                  height="12"
                  rx="2"
                  fill="currentColor"
                  fillOpacity="0.2"
                  stroke="currentColor"
                  strokeWidth="2"
                />
                <circle cx="10" cy="12" r="3" fill="currentColor" />
                <path d="M13 12H22" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" />
              </svg>
              <span
                className="text-xs font-bold tracking-wide text-white truncate"
                style={{ fontFamily: 'var(--font-display)' }}
              >
                CODETANK OXY
              </span>
            </div>

            <div className="flex items-center gap-1 shrink-0">
              {networkRole !== 'OFFLINE' && (
                <span className="px-1.5 py-0.5 text-[10px] font-mono bg-emerald-950/80 border border-emerald-500/50 text-emerald-300 rounded flex items-center gap-1">
                  <Radio className="w-2.5 h-2.5 text-emerald-400" />
                  {roomCode} (#{mySlotId})
                </span>
              )}

              {/* Reset Resizable Layout Button */}
              <button
                type="button"
                onClick={handleResetAllLayout}
                title="Khôi phục kích thước mặc định cho tất cả các khung (Trái, Bản Đồ, Code)"
                className="px-1.5 py-1 text-[11px] bg-slate-800 hover:bg-slate-700 text-slate-300 rounded border border-slate-700 flex items-center gap-1 cursor-pointer"
              >
                <Columns3 className="w-3 h-3 text-emerald-400" />
                <span>Bố Cục</span>
              </button>

              {/* Mute Toggle */}
              <button
                type="button"
                aria-label={muted ? 'Bật âm thanh' : 'Tắt âm thanh'}
                onClick={() => {
                  soundFX.muted = !muted;
                  setMuted(!muted);
                }}
                className="p-1.5 bg-slate-800 hover:bg-slate-700 text-slate-300 rounded border border-slate-700 cursor-pointer"
              >
                {muted ? <VolumeX className="w-3.5 h-3.5" /> : <Volume2 className="w-3.5 h-3.5" />}
              </button>
            </div>
          </div>

          {/* Primary Match Control Buttons */}
          {networkRole !== 'CLIENT' ? (
            <div className="grid grid-cols-2 gap-1.5">
              <button
                type="button"
                onClick={handleTogglePause}
                className="px-2 py-1.5 text-xs font-semibold bg-emerald-600 hover:bg-emerald-500 text-white rounded flex items-center justify-center gap-1 transition-colors cursor-pointer whitespace-nowrap"
              >
                {hud.shellState === 'playing' ? (
                  <>
                    <Pause className="w-3.5 h-3.5 shrink-0" /> Tạm Dừng
                  </>
                ) : (
                  <>
                    <Play className="w-3.5 h-3.5 shrink-0" /> Tiếp Tục
                  </>
                )}
              </button>

              <button
                type="button"
                onClick={handleResetMatch}
                className="px-2 py-1.5 text-xs font-medium bg-slate-800 hover:bg-slate-700 text-slate-200 rounded border border-slate-700 flex items-center justify-center gap-1 transition-colors cursor-pointer whitespace-nowrap"
              >
                <RotateCcw className="w-3.5 h-3.5 shrink-0" /> Đặt Lại Trận
              </button>
            </div>
          ) : (
            <button
              type="button"
              onClick={handleExitToLobby}
              className="w-full px-2.5 py-1.5 text-xs font-semibold bg-rose-950/90 hover:bg-rose-900 text-rose-200 border border-rose-700/60 rounded flex items-center justify-center gap-1 cursor-pointer whitespace-nowrap"
            >
              <LogOut className="w-3.5 h-3.5 shrink-0" /> Rời Phòng
            </button>
          )}

          {/* Skill Selector Dropdown */}
          <select
            aria-label="Chọn Kỹ Năng Đặc Biệt (Hồi chiêu 28s)"
            value={selectedSkill}
            onChange={(e) => handleSkillChange(Number(e.target.value) as SkillId)}
            className="w-full bg-slate-900 text-emerald-300 text-xs font-medium px-2 py-1.5 rounded border border-slate-700 focus:outline-none focus:border-emerald-500"
          >
            {SKILLS.map((sk) => (
              <option key={sk.id} value={sk.id}>
                Kỹ Năng {sk.id}: {sk.nameVi} ({sk.duration > 0 ? `${sk.duration}s` : 'Tức thời'})
              </option>
            ))}
          </select>

          {/* Secondary Tactical Toggles: Online Room, Grid, Sensor */}
          <div className="grid grid-cols-3 gap-1.5">
            <button
              type="button"
              onClick={() => setIsRoomModalOpen(true)}
              title="Phòng Online PeerJS & Chỉnh Code AI"
              className="px-1.5 py-1 text-[11px] font-medium bg-slate-800 hover:bg-slate-700 text-sky-300 rounded border border-slate-700 flex items-center justify-center gap-1 cursor-pointer truncate"
            >
              <Users className="w-3 h-3 shrink-0" />
              <span className="truncate">
                {networkRole === 'OFFLINE' ? 'Phòng' : roomCode}
              </span>
            </button>

            <button
              type="button"
              aria-label="Bật tắt lưới tọa độ Oxy"
              onClick={() => setShowGrid((g) => !g)}
              className={`px-1.5 py-1 text-[11px] rounded border flex items-center justify-center gap-1 cursor-pointer truncate ${
                showGrid
                  ? 'bg-slate-800 text-emerald-300 border-emerald-700/60'
                  : 'bg-slate-900 text-slate-400 border-slate-800'
              }`}
            >
              <Grid className="w-3 h-3 shrink-0" />
              <span className="truncate">Lưới</span>
            </button>

            <button
              type="button"
              aria-label="Bật tắt vòng cảm biến 20 ô"
              onClick={() => setShowSensor((s) => !s)}
              className={`px-1.5 py-1 text-[11px] rounded border flex items-center justify-center gap-1 cursor-pointer truncate ${
                showSensor
                  ? 'bg-slate-800 text-sky-300 border-sky-700/60'
                  : 'bg-slate-900 text-slate-400 border-slate-800'
              }`}
            >
              <Radar className="w-3 h-3 shrink-0" />
              <span className="truncate">Cảm Biến</span>
            </button>
          </div>
        </div>

        {/* Vertical Stack of 4 Tank Status Cards */}
        <div className="flex items-center justify-between px-1 text-[11px] font-semibold uppercase tracking-wider text-slate-400 shrink-0">
          <span>Chiến Xa Trong Trận (4)</span>
          <span className="font-mono text-emerald-400 tabular-nums">
            {Math.round(hud.matchTime)}s
          </span>
        </div>

        <div className="flex-1 flex flex-col gap-2 overflow-y-auto min-h-0 pr-0.5">
          {hud.tanks.map((t) => {
            const sk = SKILLS.find((s) => s.id === t.skillId) ?? SKILLS[0];
            return (
              <div
                key={t.id}
                className={`flex-1 min-h-[84px] px-2.5 py-2 rounded-lg border transition-opacity flex flex-col justify-between ${
                  t.alive
                    ? t.id === mySlotId
                      ? 'bg-[#0d1b2e] border-emerald-500/50'
                      : 'bg-[#0d1829] border-slate-800'
                    : 'bg-slate-950/60 border-slate-900 opacity-55'
                }`}
              >
                <div className="flex items-center justify-between gap-1">
                  <span
                    className="text-xs font-bold truncate"
                    style={{ color: t.alive ? t.color : '#64748b' }}
                  >
                    {t.name}
                  </span>
                  <div className="flex items-center gap-1.5 shrink-0">
                    <span className="text-[10px] font-mono text-emerald-300/90 bg-emerald-950/60 px-1.5 py-0.5 rounded border border-emerald-800/40">
                      Hạ: {t.kills}
                    </span>
                    <span className="text-[11px] font-mono tabular-nums text-slate-400">
                      ({t.x.toFixed(1)}, {t.y.toFixed(1)})
                    </span>
                  </div>
                </div>

                {/* Discrete HP Hearts & Ammo Pips */}
                <div className="flex items-center justify-between gap-2">
                  <div className="flex items-center gap-0.5" title={`Máu: ${t.hp}/${t.maxHp}`}>
                    <span className="text-[10px] font-mono text-slate-400 mr-1">HP</span>
                    {Array.from({ length: t.maxHp }).map((_, idx) => (
                      <svg
                        key={idx}
                        className="w-3.5 h-3.5"
                        viewBox="0 0 24 24"
                        fill={idx < t.hp ? '#ef4444' : 'none'}
                        stroke={idx < t.hp ? '#ef4444' : '#475569'}
                        strokeWidth="2"
                      >
                        <path d="M12 21.35l-1.45-1.32C5.4 15.36 2 12.28 2 8.5 2 5.42 4.42 3 7.5 3c1.74 0 3.41.81 4.5 2.09C13.09 3.81 14.76 3 16.5 3 19.58 3 22 5.42 22 8.5c0 3.78-3.4 6.86-8.55 11.54L12 21.35z" />
                      </svg>
                    ))}
                  </div>

                  <div className="flex items-center gap-0.5" title={`Đạn: ${t.ammo}/${t.maxAmmo}`}>
                    <span className="text-[10px] font-mono text-slate-400 mr-1">ĐẠN</span>
                    {t.reloadTimer > 0 ? (
                      <span className="text-[10px] font-mono text-amber-400 tabular-nums">
                        Nạp {t.reloadTimer.toFixed(1)}s
                      </span>
                    ) : (
                      Array.from({ length: t.maxAmmo }).map((_, idx) => (
                        <span
                          key={idx}
                          className={`w-1.5 h-2.5 rounded-xs ${
                            idx < t.ammo ? 'bg-amber-400' : 'bg-slate-800'
                          }`}
                        />
                      ))
                    )}
                  </div>
                </div>

                {/* Cooldowns & Active Buffs */}
                <div className="flex items-center justify-between gap-1 text-[10px] font-mono tabular-nums text-slate-400 whitespace-nowrap">
                  <span className="truncate">
                    {sk.nameVi}:{' '}
                    {t.activeSkillTimer > 0 ? (
                      <strong className="text-emerald-400">{t.activeSkillTimer.toFixed(1)}s</strong>
                    ) : t.skillCooldown > 0 ? (
                      <span className="text-amber-300">{t.skillCooldown.toFixed(0)}s</span>
                    ) : (
                      <strong className="text-sky-300">OK</strong>
                    )}
                  </span>
                  <span className="shrink-0">
                    Lướt:{' '}
                    {t.dashCooldown > 0 ? (
                      <span className="text-amber-300">{t.dashCooldown.toFixed(1)}s</span>
                    ) : (
                      <strong className="text-emerald-400">OK</strong>
                    )}
                  </span>
                </div>
              </div>
            );
          })}
        </div>
      </aside>

      {/* VERTICAL RESIZER 1: DRAG LEFT/RIGHT BETWEEN LEFT SIDEBAR & CENTER MAP PANEL */}
      <div
        role="separator"
        aria-orientation="vertical"
        aria-label="Kéo để chỉnh độ rộng Cột Thông Tin Trái và Khung Bản Đồ Game"
        title="Núm kéo chuột trái/phải để điều chỉnh độ rộng Cột Thông Tin Trái & Khung Bản Đồ (Nhấp đúp để đặt lại)"
        data-testid="resizer-left-sidebar"
        onMouseDown={(e) => startMainDrag('LEFT_SIDEBAR', e)}
        onDoubleClick={() =>
          setLayout((prev) => ({
            ...prev,
            leftSidebarPct: DEFAULT_LAYOUT.leftSidebarPct,
            centerMapPct: DEFAULT_LAYOUT.centerMapPct,
          }))
        }
        className={`hidden lg:flex w-2.5 h-full shrink-0 items-center justify-center cursor-col-resize border-x transition-colors select-none group ${
          activeDrag === 'LEFT_SIDEBAR'
            ? 'bg-emerald-500/30 border-emerald-400'
            : 'bg-[#091322] hover:bg-emerald-500/20 border-slate-800 hover:border-emerald-500/60'
        }`}
      >
        <div
          className={`w-1.5 h-16 rounded-full flex items-center justify-center transition-colors ${
            activeDrag === 'LEFT_SIDEBAR'
              ? 'bg-emerald-400'
              : 'bg-slate-800 group-hover:bg-emerald-400'
          }`}
        >
          <GripVertical
            className={`w-3.5 h-3.5 shrink-0 ${
              activeDrag === 'LEFT_SIDEBAR'
                ? 'text-slate-950'
                : 'text-slate-400 group-hover:text-slate-950'
            }`}
          />
        </div>
      </div>

      {/* COLUMN 2 (CENTER MAP PANEL): FULL-HEIGHT 30x30 OXY ISLAND CANVAS */}
      <section
        data-testid="center-map-panel"
        style={{ width: `${layout.centerMapPct}%` }}
        className="w-full lg:w-auto h-full flex flex-col p-2 overflow-hidden shrink-0"
      >
        <IslandCanvas
          worldRef={worldRef}
          showGrid={showGrid}
          showSensor={showSensor}
          onSelectCoord={handleSelectCanvasCoord}
          onInstantMoveTo={handleInstantMoveTo}
          onInstantShoot={handleInstantShoot}
        />
      </section>

      {/* VERTICAL RESIZER 2: DRAG LEFT/RIGHT BETWEEN CENTER MAP PANEL & RIGHT CODE PANEL */}
      <div
        role="separator"
        aria-orientation="vertical"
        aria-label="Kéo để chỉnh độ rộng Khung Bản Đồ Game và Khung Code C++"
        title="Núm kéo chuột trái/phải để điều chỉnh độ rộng Khung Bản Đồ Game và Khung Code C++ (Nhấp đúp để đặt lại)"
        data-testid="resizer-main-cols"
        onMouseDown={(e) => startMainDrag('MAIN_COLS', e)}
        onDoubleClick={() =>
          setLayout((prev) => ({
            ...prev,
            leftSidebarPct: DEFAULT_LAYOUT.leftSidebarPct,
            centerMapPct: DEFAULT_LAYOUT.centerMapPct,
          }))
        }
        className={`hidden lg:flex w-2.5 h-full shrink-0 items-center justify-center cursor-col-resize border-x transition-colors select-none group ${
          activeDrag === 'MAIN_COLS'
            ? 'bg-emerald-500/30 border-emerald-400'
            : 'bg-[#091322] hover:bg-emerald-500/20 border-slate-800 hover:border-emerald-500/60'
        }`}
      >
        <div
          className={`w-1.5 h-16 rounded-full flex items-center justify-center transition-colors ${
            activeDrag === 'MAIN_COLS'
              ? 'bg-emerald-400'
              : 'bg-slate-800 group-hover:bg-emerald-400'
          }`}
        >
          <GripVertical
            className={`w-3.5 h-3.5 shrink-0 ${
              activeDrag === 'MAIN_COLS'
                ? 'text-slate-950'
                : 'text-slate-400 group-hover:text-slate-950'
            }`}
          />
        </div>
      </div>

      {/* COLUMN 3 (RIGHT CODE PANEL): MAIN C++ EDITOR, LIVE OVERRIDE TERMINAL, CONSOLE & VIETNAMESE DOCS */}
      <div
        data-testid="right-code-panel"
        style={{ width: `${rightWidthPct}%` }}
        className="w-full lg:w-auto flex-1 h-full min-w-0 overflow-hidden"
      >
        <CodeWorkspace
          mainCode={mainCode}
          onChangeMainCode={setMainCode}
          onApplyMainCode={handleApplyMainCode}
          overrideCode={overrideCode}
          onChangeOverrideCode={setOverrideCode}
          onTriggerOverride={handleTriggerOverride}
          compileTimer={playerSnap?.compileTimer ?? 0}
          executingOverride={playerSnap?.executingOverride ?? false}
          logs={hud.logs}
          lastError={playerSnap?.lastError ?? null}
          mainHeightPct={layout.mainHeightPct}
          overrideHeightPct={layout.overrideHeightPct}
          onChangeVerticalSplit={handleChangeCodeVerticalSplit}
          onResetVerticalSplit={handleResetCodeVerticalSplit}
        />
      </div>

      {/* MULTIPLAYER & BOT CODE MODAL (PeerJS WebRTC) */}
      <MultiplayerModal
        isOpen={isRoomModalOpen}
        onClose={() => setIsRoomModalOpen(false)}
        roomCode={roomCode}
        networkRole={networkRole}
        mySlotId={mySlotId}
        myPlayerName={myPlayerName}
        onChangeMyPlayerName={handleChangeMyPlayerName}
        peerStatus={peerStatus}
        peerError={peerError}
        roomPlayers={roomPlayers}
        onCreatePeerRoom={handleCreatePeerRoom}
        onJoinPeerRoom={handleJoinPeerRoom}
        onLeavePeerRoom={handleLeavePeerRoom}
        tanks={worldRef.current.tanks}
        competitorConfigs={competitorConfigs}
        onUpdateCompetitorCode={handleUpdateCompetitorCode}
      />

      {/* 1. DEDICATED TACTICAL PRE-MATCH LOBBY & TITLE SCREEN (`document.body.dataset.state = 'title'`) */}
      {hud.shellState === 'title' && (
        <TitleLobbyScreen
          worldRef={worldRef}
          selectedSkill={selectedSkill}
          onSelectSkill={handleSkillChange}
          mainCode={mainCode}
          onChangeMainCode={setMainCode}
          competitorConfigs={competitorConfigs}
          roomCode={roomCode}
          networkRole={networkRole}
          mySlotId={mySlotId}
          roomPlayers={roomPlayers}
          peerStatus={peerStatus}
          peerError={peerError}
          onCreatePeerRoom={() => handleCreatePeerRoom()}
          onJoinPeerRoom={handleJoinPeerRoom}
          onLeavePeerRoom={handleLeavePeerRoom}
          muted={muted}
          onToggleMute={() => {
            soundFX.muted = !muted;
            setMuted(!muted);
          }}
          onOpenMultiplayerModal={() => setIsRoomModalOpen(true)}
          onStartMatch={handleStartMatch}
        />
      )}

      {/* 2. PAUSE MODAL (`document.body.dataset.state = 'paused'`) */}
      {hud.shellState === 'paused' && (
        <div className="fixed inset-0 z-40 bg-slate-950/80 flex items-center justify-center p-4">
          <div className="max-w-md w-full bg-[#0d1726] border border-slate-700 rounded-xl p-6 shadow-2xl text-center space-y-5">
            <h2 className="text-xl font-bold text-white" style={{ fontFamily: 'var(--font-display)' }}>
              TẠM DỪNG TRẬN ĐẤU
            </h2>
            <p className="text-xs text-slate-400">
              {networkRole === 'CLIENT'
                ? 'Chủ Phòng đang tạm dừng trận đấu. Bạn vẫn có thể sửa code C++ ở khung bên phải.'
                : 'Bạn có thể tiếp tục chiến đấu, chơi lại trận mới, hoặc thoát ra màn hình chờ để điều chỉnh trang bị và code Bot.'}
            </p>
            <div className="grid grid-cols-2 gap-3 text-left bg-slate-900/80 p-3.5 rounded-lg border border-slate-800 font-mono text-xs tabular-nums">
              <div>
                <span className="text-slate-400 block">Thời gian trận:</span>
                <strong className="text-white text-sm">{Math.round(hud.matchTime)}s</strong>
              </div>
              <div>
                <span className="text-slate-400 block">Sát thương gây ra:</span>
                <strong className="text-emerald-400 text-sm">{playerSnap?.damageDealt ?? 0} HP</strong>
              </div>
            </div>
            <div className="flex flex-wrap items-center justify-center gap-2.5">
              {networkRole !== 'CLIENT' && (
                <>
                  <button
                    type="button"
                    onClick={handleTogglePause}
                    className="px-4 py-2 text-xs font-bold bg-emerald-500 hover:bg-emerald-400 text-slate-950 rounded-lg cursor-pointer"
                  >
                    Tiếp Tục Chiến Đấu
                  </button>
                  <button
                    type="button"
                    onClick={handleResetMatch}
                    className="px-4 py-2 text-xs font-semibold bg-slate-800 hover:bg-slate-700 text-slate-200 rounded-lg cursor-pointer"
                  >
                    Chơi Lại
                  </button>
                </>
              )}
              <button
                type="button"
                onClick={handleExitToLobby}
                className="px-4 py-2 text-xs font-semibold bg-rose-950/80 hover:bg-rose-900 text-rose-200 border border-rose-700/60 rounded-lg flex items-center gap-1.5 cursor-pointer"
              >
                <LogOut className="w-3.5 h-3.5" />
                Thoát Ra Màn Hình Chờ
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 3. VICTORY / GAME OVER MODAL (`document.body.dataset.state = 'gameover'`) */}
      {hud.shellState === 'gameover' && (
        <div className="fixed inset-0 z-40 bg-slate-950/85 flex items-center justify-center p-4">
          <div className="max-w-md w-full bg-[#0d1726] border border-slate-700 rounded-xl p-6 shadow-2xl text-center space-y-5">
            {hud.winnerId === mySlotId ? (
              <div className="flex flex-col items-center gap-2">
                <Trophy className="w-12 h-12 text-amber-400" />
                <h2 className="text-2xl font-bold text-emerald-400" style={{ fontFamily: 'var(--font-display)' }}>
                  CHIẾN THẮNG TUYỆT ĐỐI!
                </h2>
                <p className="text-xs text-slate-300">
                  Thuật toán C++ của bạn (Chiến Xa #{mySlotId}) đã làm chủ hoàn toàn Đảo Oxy 30x30!
                </p>
              </div>
            ) : (
              <div className="flex flex-col items-center gap-2">
                {playerSnap?.hp === 0 ? (
                  <Skull className="w-12 h-12 text-rose-500" />
                ) : (
                  <ShieldAlert className="w-12 h-12 text-amber-400" />
                )}
                <h2 className="text-2xl font-bold text-rose-400" style={{ fontFamily: 'var(--font-display)' }}>
                  KẾT THÚC TRẬN ĐẤU
                </h2>
                <p className="text-xs text-slate-300">
                  Người chiến thắng:{' '}
                  <strong className="text-white">
                    {hud.tanks.find((t) => t.id === hud.winnerId)?.name || 'Hòa trận'}
                  </strong>
                </p>
              </div>
            )}

            <div className="grid grid-cols-3 gap-2.5 bg-slate-900/90 p-3.5 rounded-lg border border-slate-800 font-mono text-xs tabular-nums">
              <div>
                <span className="text-slate-400 block text-[11px]">Thời Gian</span>
                <strong className="text-white text-sm">{Math.round(hud.matchTime)}s</strong>
              </div>
              <div>
                <span className="text-slate-400 block text-[11px]">Sát Thương</span>
                <strong className="text-amber-300 text-sm">{playerSnap?.damageDealt ?? 0}</strong>
              </div>
              <div>
                <span className="text-slate-400 block text-[11px]">Hạ Gục</span>
                <strong className="text-emerald-400 text-sm">{playerSnap?.kills ?? 0}</strong>
              </div>
            </div>

            <div className="flex items-center justify-center gap-3">
              {networkRole !== 'CLIENT' && (
                <button
                  type="button"
                  data-start="true"
                  onClick={handleResetMatch}
                  className="px-5 py-2.5 text-xs font-bold bg-emerald-500 hover:bg-emerald-400 text-slate-950 rounded-lg cursor-pointer"
                >
                  Chơi Lại Trận Mới
                </button>
              )}
              <button
                type="button"
                onClick={handleExitToLobby}
                className="px-4 py-2.5 text-xs font-semibold bg-slate-800 hover:bg-slate-700 text-slate-200 rounded-lg flex items-center gap-1.5 cursor-pointer"
              >
                <LogOut className="w-3.5 h-3.5" />
                Thoát Ra Màn Hình Chờ
              </button>
            </div>
          </div>
        </div>
      )}
    </main>
  );
}

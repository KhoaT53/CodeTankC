import React, { useState } from 'react';
import {
  Users,
  Copy,
  Check,
  X,
  Bot,
  Wifi,
  RotateCcw,
  CheckCircle2,
  Radio,
  LogIn,
  LogOut,
  AlertCircle,
  UserCheck,
} from 'lucide-react';
import { Tank, SkillId, SKILLS, CompetitorConfig } from '../game/types';
import { DEFAULT_COMPETITOR_CONFIGS } from '../game/engine';
import { NetworkRole, RoomPlayerInfo } from '../game/peerNetwork';

interface MultiplayerModalProps {
  isOpen: boolean;
  onClose: () => void;
  roomCode: string;
  networkRole: NetworkRole;
  mySlotId: number;
  myPlayerName: string;
  onChangeMyPlayerName: (name: string) => void;
  peerStatus: string;
  peerError: string | null;
  roomPlayers: RoomPlayerInfo[];
  onCreatePeerRoom: (customCode?: string) => void;
  onJoinPeerRoom: (targetCode: string) => void;
  onLeavePeerRoom: () => void;
  tanks: Tank[];
  competitorConfigs: CompetitorConfig[];
  onUpdateCompetitorCode: (tankId: number, name: string, skillId: SkillId, code: string) => void;
}

export const MultiplayerModal: React.FC<MultiplayerModalProps> = ({
  isOpen,
  onClose,
  roomCode,
  networkRole,
  mySlotId,
  myPlayerName,
  onChangeMyPlayerName,
  peerStatus,
  peerError,
  roomPlayers,
  onCreatePeerRoom,
  onJoinPeerRoom,
  onLeavePeerRoom,
  tanks,
  competitorConfigs,
  onUpdateCompetitorCode,
}) => {
  const [selectedTankId, setSelectedTankId] = useState<number>(2);
  const [joinInputCode, setJoinInputCode] = useState<string>('');
  const [copied, setCopied] = useState(false);

  if (!isOpen) return null;

  const activeTank = tanks.find((t) => t.id === selectedTankId) ?? tanks[1];
  const activeConfig =
    competitorConfigs.find((c) => c.id === selectedTankId) ??
    competitorConfigs[0] ?? {
      id: activeTank?.id ?? 2,
      name: activeTank?.name ?? 'BOT #2',
      skillId: activeTank?.skillId ?? SkillId.SHRINK,
      mainCode: activeTank?.mainCode ?? '',
    };

  const handleCopyRoom = () => {
    if (!roomCode) return;
    navigator.clipboard?.writeText(roomCode).catch(() => {});
    setCopied(true);
    setTimeout(() => setCopied(false), 1800);
  };

  const handleRestoreDefaultBot = () => {
    const def = DEFAULT_COMPETITOR_CONFIGS.find((c) => c.id === activeConfig.id);
    if (def) {
      onUpdateCompetitorCode(def.id, def.name, def.skillId, def.mainCode);
    }
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Phòng Đấu Online PeerJS & Cấu Hình Code Đối Thủ"
      className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/85 p-4"
    >
      <div className="w-full max-w-4xl bg-[#0d1726] border border-slate-700 rounded-xl shadow-2xl overflow-hidden flex flex-col max-h-[90vh]">
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-3 bg-slate-900 border-b border-slate-800 shrink-0">
          <div className="flex items-center gap-2.5">
            <Users className="w-5 h-5 text-emerald-400" />
            <h2 className="text-base font-bold text-white">
              Phòng Chơi Online Thời Gian Thực (PeerJS WebRTC) &amp; Cấu Hình Code 3 Đối Thủ
            </h2>
          </div>
          <button
            type="button"
            aria-label="Đóng cửa sổ Phòng Online"
            onClick={onClose}
            className="p-1 text-slate-400 hover:text-white rounded cursor-pointer"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* PeerJS Real-Time Room Control Panel */}
        <div className="px-5 py-3.5 bg-slate-900/60 border-b border-slate-800 flex flex-col gap-3 shrink-0">
          {/* Top Row: Player Name + Create Room OR Join Room */}
          <div className="grid grid-cols-1 md:grid-cols-12 gap-3 items-end">
            {/* Player Name */}
            <div className="md:col-span-3 flex flex-col gap-1">
              <label htmlFor="my-player-name" className="text-[11px] font-medium text-slate-300">
                Tên Hiển Thị Của Bạn:
              </label>
              <input
                id="my-player-name"
                type="text"
                value={myPlayerName}
                onChange={(e) => onChangeMyPlayerName(e.target.value)}
                placeholder="VD: KHOA TANK"
                className="px-2.5 py-1.5 bg-slate-950 border border-slate-700 rounded-lg text-xs text-white focus:outline-none focus:border-emerald-500"
              />
            </div>

            {/* Host Room Box */}
            <div className="md:col-span-4 flex flex-col gap-1">
              <span className="text-[11px] font-medium text-emerald-300">
                1. Tạo Phòng Mới (Làm Chủ Phòng):
              </span>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => onCreatePeerRoom()}
                  className="flex-1 px-3 py-1.5 text-xs font-bold bg-emerald-500 hover:bg-emerald-400 text-slate-950 rounded-lg flex items-center justify-center gap-1.5 transition-colors cursor-pointer whitespace-nowrap"
                >
                  <Radio className="w-3.5 h-3.5" />
                  {networkRole === 'HOST' ? 'Tạo Mã Phòng Mới' : 'Tạo Phòng Online'}
                </button>

                {networkRole !== 'OFFLINE' && roomCode && (
                  <div className="flex items-center gap-1 bg-slate-950 border border-emerald-500/60 px-2.5 py-1 rounded-lg">
                    <span className="text-xs font-mono font-bold text-emerald-400 tracking-wider">
                      {roomCode}
                    </span>
                    <button
                      type="button"
                      onClick={handleCopyRoom}
                      title="Sao chép mã phòng để gửi cho bạn bè"
                      className="p-1 text-slate-300 hover:text-white cursor-pointer"
                    >
                      {copied ? (
                        <Check className="w-3.5 h-3.5 text-emerald-400" />
                      ) : (
                        <Copy className="w-3.5 h-3.5" />
                      )}
                    </button>
                  </div>
                )}
              </div>
            </div>

            {/* Join Room Box */}
            <div className="md:col-span-5 flex flex-col gap-1">
              <label htmlFor="join-room-code-input" className="text-[11px] font-medium text-sky-300">
                2. Hoặc Nhập Mã ID Để Vào Phòng Bạn Bè:
              </label>
              <div className="flex items-center gap-2">
                <input
                  id="join-room-code-input"
                  type="text"
                  value={joinInputCode}
                  onChange={(e) => setJoinInputCode(e.target.value.toUpperCase())}
                  placeholder="Nhập mã ID ngắn (VD: A7K9M2)"
                  className="flex-1 px-2.5 py-1.5 bg-slate-950 border border-slate-700 rounded-lg text-xs font-mono text-sky-300 uppercase focus:outline-none focus:border-sky-500"
                />
                <button
                  type="button"
                  onClick={() => onJoinPeerRoom(joinInputCode)}
                  className="px-3.5 py-1.5 text-xs font-bold bg-sky-500 hover:bg-sky-400 text-slate-950 rounded-lg flex items-center gap-1.5 transition-colors cursor-pointer whitespace-nowrap"
                >
                  <LogIn className="w-3.5 h-3.5" />
                  Vào Phòng
                </button>
                {networkRole !== 'OFFLINE' && (
                  <button
                    type="button"
                    onClick={onLeavePeerRoom}
                    title="Ngắt kết nối phòng Online và quay về chế độ Offline"
                    className="px-2.5 py-1.5 text-xs font-semibold bg-rose-950/90 hover:bg-rose-900 text-rose-200 border border-rose-700/60 rounded-lg flex items-center gap-1 cursor-pointer whitespace-nowrap"
                  >
                    <LogOut className="w-3.5 h-3.5" />
                    Rời
                  </button>
                )}
              </div>
            </div>
          </div>

          {/* Status & Connected Players Bar */}
          <div className="flex flex-wrap items-center justify-between gap-2 px-3 py-2 rounded-lg bg-slate-950/90 border border-slate-800 text-xs">
            <div className="flex items-center gap-2 min-w-0">
              <Wifi
                className={`w-4 h-4 shrink-0 ${
                  networkRole === 'HOST'
                    ? 'text-emerald-400'
                    : networkRole === 'CLIENT'
                    ? 'text-sky-400'
                    : 'text-slate-500'
                }`}
              />
              <span className="text-slate-200 truncate">{peerStatus}</span>
              {peerError && (
                <span className="text-rose-400 flex items-center gap-1 font-medium">
                  <AlertCircle className="w-3.5 h-3.5 shrink-0" />
                  {peerError}
                </span>
              )}
            </div>

            <div className="flex items-center gap-2 shrink-0 font-mono text-[11px]">
              {networkRole === 'OFFLINE' ? (
                <span className="text-slate-400">Chế độ: Đấu với 3 Bot AI</span>
              ) : (
                <span className="text-emerald-300 flex items-center gap-1">
                  <UserCheck className="w-3.5 h-3.5" />
                  Bạn điều khiển: <strong>Chiến Xa #{mySlotId}</strong> (
                  {networkRole === 'HOST' ? 'Chủ Phòng' : 'Khách'}) · Đã kết nối:{' '}
                  <strong>{roomPlayers.length}/4</strong>
                </span>
              )}
            </div>
          </div>
        </div>

        {/* Competitor Tabs */}
        <div className="flex items-center justify-between px-5 pt-2.5 border-b border-slate-800 bg-slate-950/40 shrink-0">
          <div className="flex items-center gap-2">
            {tanks.slice(1).map((t) => {
              const cfg = competitorConfigs.find((c) => c.id === t.id);
              const onlinePlayer = roomPlayers.find((p) => p.slotId === t.id);
              const tabName = onlinePlayer ? `${onlinePlayer.name} (Online)` : cfg?.name ?? t.name;
              return (
                <button
                  key={t.id}
                  type="button"
                  onClick={() => setSelectedTankId(t.id)}
                  className={`px-3.5 py-2 text-xs font-semibold rounded-t-lg border-t border-x transition-colors flex items-center gap-1.5 cursor-pointer ${
                    selectedTankId === t.id
                      ? 'bg-[#0d1726] text-white border-slate-700'
                      : 'bg-slate-900/60 text-slate-400 border-transparent hover:text-slate-200'
                  }`}
                >
                  <Bot className="w-3.5 h-3.5" style={{ color: t.color }} />
                  #{t.id}: {tabName}
                </button>
              );
            })}
          </div>
          <span className="text-[11px] text-slate-400 hidden sm:inline">
            Các vị trí chưa có người chơi Online sẽ do AI Bot điều khiển
          </span>
        </div>

        {/* Active Competitor Code Inspector / Editor */}
        {activeConfig && (
          <div className="flex-1 p-4 flex flex-col gap-2.5 min-h-0 overflow-hidden">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="flex items-center gap-2">
                <label htmlFor="comp-name-input" className="text-xs text-slate-400">
                  Tên Chiến Xa #{activeConfig.id}:
                </label>
                <input
                  id="comp-name-input"
                  type="text"
                  value={activeConfig.name}
                  onChange={(e) =>
                    onUpdateCompetitorCode(
                      activeConfig.id,
                      e.target.value,
                      activeConfig.skillId,
                      activeConfig.mainCode
                    )
                  }
                  className="px-2.5 py-1 bg-slate-900 border border-slate-700 rounded text-xs text-white"
                />
              </div>

              <div className="flex items-center gap-2">
                <label htmlFor="comp-skill-select" className="text-xs text-slate-400">
                  Kỹ Năng Đặc Biệt:
                </label>
                <select
                  id="comp-skill-select"
                  value={activeConfig.skillId}
                  onChange={(e) =>
                    onUpdateCompetitorCode(
                      activeConfig.id,
                      activeConfig.name,
                      Number(e.target.value) as SkillId,
                      activeConfig.mainCode
                    )
                  }
                  className="px-2.5 py-1 bg-slate-900 border border-slate-700 rounded text-xs text-slate-200"
                >
                  {SKILLS.map((sk) => (
                    <option key={sk.id} value={sk.id}>
                      {sk.id}. {sk.nameVi} ({sk.codeName})
                    </option>
                  ))}
                </select>

                <button
                  type="button"
                  onClick={handleRestoreDefaultBot}
                  className="px-2.5 py-1 text-xs bg-slate-800 hover:bg-slate-700 text-slate-300 rounded border border-slate-700 flex items-center gap-1 cursor-pointer"
                  title="Khôi phục code mặc định của Bot này"
                >
                  <RotateCcw className="w-3 h-3" />
                  Mặc định
                </button>
              </div>
            </div>

            <div className="flex items-center justify-between gap-2 text-xs text-slate-400">
              <span>
                 Mã nguồn C++ đang nạp cho Chiến Xa #{activeConfig.id} (Khi người chơi Online tham gia vào vị trí này, code của họ sẽ tự động đồng bộ vào đây):
              </span>
              <span className="text-emerald-400 flex items-center gap-1 font-mono text-[11px] shrink-0">
                <CheckCircle2 className="w-3.5 h-3.5" />
                Tự động lưu khi vào trận
              </span>
            </div>

            <textarea
              aria-label={`Mã nguồn C++ của ${activeConfig.name}`}
              value={activeConfig.mainCode}
              onChange={(e) =>
                onUpdateCompetitorCode(
                  activeConfig.id,
                  activeConfig.name,
                  activeConfig.skillId,
                  e.target.value
                )
              }
              spellCheck={false}
              className="code-editor flex-1 min-h-[180px] w-full p-3 bg-[#070d17] border border-slate-800 rounded text-xs text-slate-100 font-mono resize-none focus:outline-none focus:border-emerald-500"
            />
          </div>
        )}

        <div className="px-5 py-3 bg-slate-900 border-t border-slate-800 flex items-center justify-between shrink-0">
          <span className="text-xs text-slate-400">
            Khi Chủ Phòng bấm &ldquo;Bắt Đầu Trận Đấu&rdquo;, toàn bộ người chơi trong phòng sẽ tự động vào trận và đồng bộ thời gian thực.
          </span>
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-1.5 text-xs font-semibold bg-emerald-600 hover:bg-emerald-500 text-white rounded transition-colors cursor-pointer"
          >
            Lưu &amp; Đóng
          </button>
        </div>
      </div>
    </div>
  );
};

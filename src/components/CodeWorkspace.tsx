import React, { useRef, useState } from 'react';
import {
  Terminal,
  Play,
  BookOpen,
  Code2,
  AlertTriangle,
  CheckCircle2,
  Sparkles,
  GripHorizontal,
} from 'lucide-react';
import { ConsoleLogEntry, COMPILE_COOLDOWN } from '../game/types';
import { PLAYER_CODE_PRESETS, LIVE_OVERRIDE_SNIPPETS } from '../game/presets';

interface CodeWorkspaceProps {
  mainCode: string;
  onChangeMainCode: (code: string) => void;
  onApplyMainCode: (code: string) => { ok: boolean; error?: string };
  overrideCode: string;
  onChangeOverrideCode: (code: string) => void;
  onTriggerOverride: (code: string) => { ok: boolean; error?: string };
  compileTimer: number;
  executingOverride: boolean;
  logs: ConsoleLogEntry[];
  lastError: string | null;
  mainHeightPct: number;
  overrideHeightPct: number;
  onChangeVerticalSplit: (mainPct: number, overridePct: number) => void;
  onResetVerticalSplit: () => void;
}

export const CodeWorkspace: React.FC<CodeWorkspaceProps> = ({
  mainCode,
  onChangeMainCode,
  onApplyMainCode,
  overrideCode,
  onChangeOverrideCode,
  onTriggerOverride,
  compileTimer,
  executingOverride,
  logs,
  lastError,
  mainHeightPct,
  overrideHeightPct,
  onChangeVerticalSplit,
  onResetVerticalSplit,
}) => {
  const [bottomTab, setBottomTab] = useState<'CONSOLE' | 'DOCS'>('CONSOLE');
  const [applyFeedback, setApplyFeedback] = useState<string | null>(null);
  const [draggingHandle, setDraggingHandle] = useState<'TOP' | 'BOTTOM' | null>(null);
  const containerRef = useRef<HTMLElement>(null);

  const splitRef = useRef({ mainHeightPct, overrideHeightPct });
  splitRef.current = { mainHeightPct, overrideHeightPct };

  const handleApplyMain = () => {
    const res = onApplyMainCode(mainCode);
    if (res.ok) {
      setApplyFeedback('Đã nạp chương trình AI chính thành công!');
      setTimeout(() => setApplyFeedback(null), 2500);
    }
  };

  const handleCompileOverride = () => {
    if (!overrideCode.trim() || compileTimer > 0) return;
    onTriggerOverride(overrideCode);
  };

  const startVerticalDrag = (which: 'TOP' | 'BOTTOM', e: React.MouseEvent) => {
    e.preventDefault();
    setDraggingHandle(which);

    const prevCursor = document.body.style.cursor;
    const prevUserSelect = document.body.style.userSelect;
    document.body.style.cursor = 'row-resize';
    document.body.style.userSelect = 'none';

    const onMouseMove = (ev: MouseEvent) => {
      const el = containerRef.current;
      if (!el) return;
      const rect = el.getBoundingClientRect();
      if (rect.height <= 100) return;

      const relY = ev.clientY - rect.top;
      const pct = (relY / rect.height) * 100;
      const curMain = splitRef.current.mainHeightPct;
      const curOverride = splitRef.current.overrideHeightPct;

      if (which === 'TOP') {
        const totalTopTwo = curMain + curOverride;
        const newMain = Math.max(16, Math.min(totalTopTwo - 14, pct));
        const newOverride = Math.max(14, totalTopTwo - newMain);
        onChangeVerticalSplit(Number(newMain.toFixed(1)), Number(newOverride.toFixed(1)));
      } else {
        const clampedSplit = Math.max(curMain + 14, Math.min(86, pct));
        const newOverride = clampedSplit - curMain;
        onChangeVerticalSplit(curMain, Number(newOverride.toFixed(1)));
      }
    };

    const onMouseUp = () => {
      setDraggingHandle(null);
      document.body.style.cursor = prevCursor;
      document.body.style.userSelect = prevUserSelect;
      window.removeEventListener('mousemove', onMouseMove);
      window.removeEventListener('mouseup', onMouseUp);
    };

    window.addEventListener('mousemove', onMouseMove);
    window.addEventListener('mouseup', onMouseUp);
  };

  const bottomHeightPct = Math.max(14, Number((100 - mainHeightPct - overrideHeightPct).toFixed(1)));

  return (
    <aside
      ref={containerRef}
      className="w-full h-full flex flex-col bg-[#0c1524] select-text overflow-hidden"
    >
      {/* 1. UPPER EDITOR: MAIN AI PROGRAM (setup & loop) */}
      <div
        style={{ height: `${mainHeightPct}%` }}
        className="min-h-[95px] flex flex-col overflow-hidden"
      >
        <div className="flex items-center justify-between gap-2 px-3 py-1.5 bg-slate-900/90 border-b border-slate-800 shrink-0">
          <div className="flex items-center gap-1.5 min-w-0">
            <Code2 className="w-4 h-4 text-emerald-400 shrink-0" />
            <h2 className="text-xs font-semibold tracking-wide text-slate-100 truncate">
              AI Chính (setup &amp; loop)
            </h2>
          </div>

          <div className="flex items-center gap-1.5 shrink-0">
            <select
              aria-label="Chọn chiến thuật mẫu C++"
              onChange={(e) => {
                const preset = PLAYER_CODE_PRESETS.find((p) => p.id === e.target.value);
                if (preset) {
                  onChangeMainCode(preset.code);
                  onApplyMainCode(preset.code);
                }
              }}
              className="bg-slate-800 text-slate-200 text-xs px-2 py-1 rounded border border-slate-700 max-w-[180px] truncate focus:outline-none focus:border-emerald-500"
            >
              {PLAYER_CODE_PRESETS.map((p) => (
                <option key={p.id} value={p.id}>
                  Mẫu: {p.nameVi}
                </option>
              ))}
            </select>

            <button
              type="button"
              onClick={handleApplyMain}
              className="px-2.5 py-1 text-xs font-semibold bg-emerald-600 hover:bg-emerald-500 text-white rounded transition-colors whitespace-nowrap shrink-0 cursor-pointer"
            >
              Nạp Code Chính
            </button>
          </div>
        </div>

        {applyFeedback && (
          <div className="px-3.5 py-1 bg-emerald-950/80 border-b border-emerald-800/60 text-emerald-300 text-xs flex items-center gap-1.5 shrink-0">
            <CheckCircle2 className="w-3.5 h-3.5 shrink-0" />
            <span>{applyFeedback}</span>
          </div>
        )}

        <div className="relative flex-1 min-h-0 bg-[#080f1a]">
          <textarea
            aria-label="Trình soạn thảo C++ AI chính"
            value={mainCode}
            onChange={(e) => onChangeMainCode(e.target.value)}
            spellCheck={false}
            className="code-editor w-full h-full p-3 bg-transparent text-slate-100 text-xs leading-relaxed resize-none focus:outline-none font-mono"
          />
        </div>
      </div>

      {/* DRAG HANDLE 1: RESIZE BETWEEN MAIN EDITOR & LIVE OVERRIDE */}
      <div
        role="separator"
        aria-orientation="horizontal"
        aria-label="Kéo để chỉnh chiều cao khung Code Chính và khung Ghi Đè"
        title="Núm kéo chuột lên/xuống để chỉnh kích thước khung Code Chính (Nhấp đúp để đặt lại)"
        data-testid="resizer-code-top"
        onMouseDown={(e) => startVerticalDrag('TOP', e)}
        onDoubleClick={onResetVerticalSplit}
        className={`h-2.5 shrink-0 flex items-center justify-center cursor-row-resize border-y transition-colors select-none group ${
          draggingHandle === 'TOP'
            ? 'bg-emerald-500/30 border-emerald-400'
            : 'bg-slate-900 hover:bg-emerald-500/20 border-slate-800 hover:border-emerald-500/60'
        }`}
      >
        <div className="flex items-center gap-1 px-2 py-0.5 rounded-full bg-slate-800/90 group-hover:bg-emerald-500/30">
          <GripHorizontal
            className={`w-3.5 h-3.5 ${
              draggingHandle === 'TOP'
                ? 'text-emerald-300'
                : 'text-slate-400 group-hover:text-emerald-300'
            }`}
          />
        </div>
      </div>

      {/* 2. MIDDLE EDITOR: LIVE OVERRIDE TERMINAL (1.0s Compile Cooldown) */}
      <div
        style={{ height: `${overrideHeightPct}%` }}
        className="min-h-[90px] flex flex-col bg-[#0e192b] overflow-hidden"
      >
        <div className="flex items-center justify-between gap-2 px-3 py-1.5 bg-slate-900/90 border-b border-slate-800 shrink-0">
          <div className="flex items-center gap-2 min-w-0">
            <Terminal className="w-4 h-4 text-sky-400 shrink-0" />
            <span className="text-xs font-semibold text-slate-100 truncate">
              Terminal Ghi Đè Trực Tiếp (Live Override)
            </span>
            {executingOverride && (
              <span className="text-[11px] font-mono text-emerald-400 shrink-0">
                · Đang chạy
              </span>
            )}
          </div>

          <button
            type="button"
            disabled={compileTimer > 0 || !overrideCode.trim()}
            onClick={handleCompileOverride}
            className={`px-2.5 py-1 text-xs font-semibold rounded flex items-center gap-1.5 transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
              compileTimer > 0
                ? 'bg-sky-900/60 text-sky-300 cursor-not-allowed'
                : 'bg-sky-500 hover:bg-sky-400 text-slate-950'
            }`}
          >
            <Play className="w-3.5 h-3.5 fill-current" />
            {compileTimer > 0
              ? `Đang Biên Dịch (${compileTimer.toFixed(1)}s)...`
              : 'Biên Dịch & Ghi Đè (Compile & Override)'}
          </button>
        </div>

        {/* Quick Tactical Snippets Bar */}
        <div className="flex items-center gap-1.5 px-3 py-1 bg-slate-950/60 border-b border-slate-800/80 overflow-x-auto shrink-0">
          <Sparkles className="w-3.5 h-3.5 text-amber-400 shrink-0" />
          {LIVE_OVERRIDE_SNIPPETS.map((snip, idx) => (
            <button
              key={idx}
              type="button"
              onClick={() => onChangeOverrideCode(snip.code)}
              className="px-2 py-0.5 text-[11px] bg-slate-800/90 hover:bg-slate-700 text-slate-300 rounded border border-slate-700 whitespace-nowrap shrink-0 cursor-pointer"
            >
              {snip.label}
            </button>
          ))}
        </div>

        {/* Compile Cooldown Progress Bar */}
        {compileTimer > 0 && (
          <div className="w-full h-1.5 bg-slate-900 overflow-hidden shrink-0">
            <div
              className="h-full bg-sky-400 transition-all duration-75"
              style={{
                width: `${Math.min(100, ((COMPILE_COOLDOWN - compileTimer) / COMPILE_COOLDOWN) * 100)}%`,
              }}
            />
          </div>
        )}

        <textarea
          aria-label="Lệnh C++ Ghi Đè Trực Tiếp"
          value={overrideCode}
          onChange={(e) => onChangeOverrideCode(e.target.value)}
          placeholder='// Nhập lệnh C++ khẩn cấp (VD: dash("N"); autoFire(3, "RICOCHET");)...'
          spellCheck={false}
          className="code-editor flex-1 min-h-0 w-full p-2.5 bg-[#070d17] text-sky-200 text-xs leading-relaxed resize-none focus:outline-none font-mono"
        />
      </div>

      {/* DRAG HANDLE 2: RESIZE BETWEEN LIVE OVERRIDE & CONSOLE/DOCS */}
      <div
        role="separator"
        aria-orientation="horizontal"
        aria-label="Kéo để chỉnh chiều cao khung Ghi Đè và khung Nhật Ký / Tài Liệu"
        title="Núm kéo chuột lên/xuống để chỉnh kích thước khung Nhật Ký & Tài Liệu (Nhấp đúp để đặt lại)"
        data-testid="resizer-code-bottom"
        onMouseDown={(e) => startVerticalDrag('BOTTOM', e)}
        onDoubleClick={onResetVerticalSplit}
        className={`h-2.5 shrink-0 flex items-center justify-center cursor-row-resize border-y transition-colors select-none group ${
          draggingHandle === 'BOTTOM'
            ? 'bg-sky-500/30 border-sky-400'
            : 'bg-slate-900 hover:bg-sky-500/20 border-slate-800 hover:border-sky-500/60'
        }`}
      >
        <div className="flex items-center gap-1 px-2 py-0.5 rounded-full bg-slate-800/90 group-hover:bg-sky-500/30">
          <GripHorizontal
            className={`w-3.5 h-3.5 ${
              draggingHandle === 'BOTTOM'
                ? 'text-sky-300'
                : 'text-slate-400 group-hover:text-sky-300'
            }`}
          />
        </div>
      </div>

      {/* 3. BOTTOM TABS: CONSOLE LOG & TÀI LIỆU C++ API (DOCS) */}
      <div
        style={{ height: `${bottomHeightPct}%` }}
        className="flex-1 min-h-[85px] flex flex-col bg-[#09111e] overflow-hidden"
      >
        <div className="flex items-center justify-between px-3 py-1.5 bg-slate-900 border-b border-slate-800 shrink-0">
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => setBottomTab('CONSOLE')}
              className={`px-2.5 py-1 text-xs font-medium rounded transition-colors cursor-pointer whitespace-nowrap ${
                bottomTab === 'CONSOLE'
                  ? 'bg-slate-800 text-white'
                  : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              Nhật Ký &amp; Báo Lỗi Biên Dịch ({logs.length})
            </button>
            <button
              type="button"
              onClick={() => setBottomTab('DOCS')}
              className={`px-2.5 py-1 text-xs font-medium rounded flex items-center gap-1.5 transition-colors cursor-pointer whitespace-nowrap ${
                bottomTab === 'DOCS'
                  ? 'bg-slate-800 text-emerald-300'
                  : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              <BookOpen className="w-3.5 h-3.5" />
              Tài Liệu C++ API (Docs)
            </button>
          </div>

          {lastError && (
            <span className="text-[11px] text-rose-400 flex items-center gap-1 truncate max-w-[220px]">
              <AlertTriangle className="w-3.5 h-3.5 shrink-0" />
              {lastError}
            </span>
          )}
        </div>

        <div className="flex-1 min-h-0 overflow-y-auto p-3 text-xs font-mono">
          {bottomTab === 'CONSOLE' ? (
            <div className="space-y-1.5">
              {logs.map((entry) => (
                <div key={entry.id} className="flex items-start gap-2 leading-snug">
                  <span className="text-slate-500 shrink-0">[{entry.time}]</span>
                  <span
                    className={`font-semibold shrink-0 ${
                      entry.type === 'ERROR'
                        ? 'text-rose-400'
                        : entry.type === 'OVERRIDE'
                        ? 'text-sky-400'
                        : entry.type === 'COMPILE'
                        ? 'text-amber-300'
                        : entry.type === 'COMBAT'
                        ? 'text-emerald-400'
                        : 'text-slate-300'
                    }`}
                  >
                    {entry.tankName}:
                  </span>
                  <span className="text-slate-200 break-words">{entry.message}</span>
                </div>
              ))}
            </div>
          ) : (
            <div className="space-y-3 text-slate-300 font-sans text-xs leading-relaxed">
              <div>
                <h4 className="font-semibold text-emerald-400 mb-1">
                  1. Hệ Trục Tọa Độ Oxy &amp; Địa Hình (getGridType)
                </h4>
                <p className="text-slate-400">
                  Gốc <code className="text-amber-300">(0, 0)</code> ở <strong>Góc Dưới-Trái</strong>.{' '}
                  <code className="text-amber-300">X</code> tăng sang Phải (0..29),{' '}
                  <code className="text-amber-300">Y</code> tăng lên Trên (0..29). Ra ngoài [0, 30) là{' '}
                  <code className="text-sky-300">-1 (Nước biển - Chết ngay)</code>.
                </p>
                <p className="text-slate-400 mt-0.5">
                  Mã ô: <code>0</code> Đất trống · <code>1</code> Tường gạch (đạn nảy tối đa 2 lần) ·{' '}
                  <code>2</code> Thùng gỗ (2 HP) · <code>3</code> Tảng đá (4 HP) · <code>4</code> Cổng dịch chuyển.
                </p>
              </div>

              <div>
                <h4 className="font-semibold text-emerald-400 mb-1">
                  2. Di Chuyển &amp; Tìm Đường A* 8 Hướng
                </h4>
                <ul className="space-y-1 font-mono text-[11px] text-sky-200">
                  <li>void moveDir(int/string dir, int steps); // 0="E", 90="N", 180="W", 270="S"</li>
                  <li>void moveTo(int x, int y, bool avoidEnemy = false, string mode = "SHORTEST"); // "SAFEST"</li>
                  <li>void dash(int/string dir); // Lướt 3.0 ô trong 0.2s (Hồi chiêu 8s)</li>
                </ul>
              </div>

              <div>
                <h4 className="font-semibold text-emerald-400 mb-1">
                  3. Chiến Đấu &amp; Kỹ Năng Đặc Biệt (Hồi chiêu 28s)
                </h4>
                <ul className="space-y-1 font-mono text-[11px] text-sky-200">
                  <li>void shoot(int angle); // Bắn 1 viên góc 0..360 (cách nhau 0.5s)</li>
                  <li>void autoFire(int count, string strategy = "DIRECT"); // hoặc "RICOCHET"</li>
                  <li>void reload(); // Nạp 5/5 viên (tốn 2.5s, vẫn di chuyển được)</li>
                  <li>void useSkill(); // Kỹ năng 1, 2, 3, 5, 6</li>
                  <li>void useSkill(int targetX, int targetY); // Kỹ năng 4: Dịch Chuyển (Blink)</li>
                </ul>
              </div>

              <div>
                <h4 className="font-semibold text-emerald-400 mb-1">
                  4. Cảm Biến Địch (Bán kính 20 ô) &amp; Vật Phẩm
                </h4>
                <ul className="space-y-1 font-mono text-[11px] text-sky-200">
                  <li>EnemyInfo getNearestEnemyInfo(); // .id, .x, .y, .hp, .angle, .dist, .status (1: Rõ, 2: Chắn)</li>
                  <li>vector&lt;EnemyInfo&gt; getAllVisibleEnemies();</li>
                  <li>pair&lt;int, int&gt; getNearestEnemyAngleStatus(); // .first = angle, .second = status</li>
                  <li>pair&lt;int, int&gt; getNearestItemPos(string type = "ANY"); // "CLOCK","HEART_1","HEART_2","AMMO","KNOCKBACK"</li>
                  <li>double getX(); double getY(); int getHP(); int getAmmo();</li>
                  <li>bool isSkillReady(); bool isDashReady(); int getGridType(int x, int y);</li>
                </ul>
              </div>
            </div>
          )}
        </div>
      </div>
    </aside>
  );
};

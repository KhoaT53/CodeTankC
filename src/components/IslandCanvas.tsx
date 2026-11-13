import React, { useEffect, useRef, useState } from 'react';
import {
  GRID_SIZE,
  SENSOR_RADIUS,
  COMPILE_COOLDOWN,
  TileType,
  SkillId,
  GameWorldState,
} from '../game/types';
import {
  oxyToCanvas,
  canvasToOxy,
  getGridTypeAt,
  scanVisibleEnemies,
} from '../game/mathAndPathfinding';

interface IslandCanvasProps {
  worldRef: React.MutableRefObject<GameWorldState>;
  showGrid: boolean;
  showSensor: boolean;
  onSelectCoord?: (gx: number, gy: number) => void;
}

const RULER_LEFT = 30;
const RULER_BOTTOM = 28;
const OCEAN_PADDING = 18;

export const IslandCanvas: React.FC<IslandCanvasProps> = ({
  worldRef,
  showGrid,
  showSensor,
  onSelectCoord,
}) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [hoverInfo, setHoverInfo] = useState<{
    x: number;
    y: number;
    gx: number;
    gy: number;
    tileType: number;
  } | null>(null);

  const showGridRef = useRef(showGrid);
  const showSensorRef = useRef(showSensor);
  showGridRef.current = showGrid;
  showSensorRef.current = showSensor;

  useEffect(() => {
    const canvas = canvasRef.current;
    const container = containerRef.current;
    if (!canvas || !container) return;

    let timerId = 0;
    let disposed = false;

    const renderFrame = () => {
      if (disposed) return;
      const timeMs = performance.now();
      const ctx = canvas.getContext('2d');
      if (!ctx) return;

      const world = worldRef.current;
      const W = canvas.width;
      const H = canvas.height;

      const offsetLeft = RULER_LEFT + OCEAN_PADDING;
      const offsetTop = OCEAN_PADDING;
      const islandPx = Math.max(
        140,
        Math.min(W - offsetLeft - OCEAN_PADDING, H - offsetTop - RULER_BOTTOM - OCEAN_PADDING)
      );
      const cellPx = islandPx / GRID_SIZE;

      ctx.save();

      // Screen shake effect on heavy hits
      if (world.screenShake > 0) {
        const mag = world.screenShake * 6;
        ctx.translate((Math.random() - 0.5) * mag, (Math.random() - 0.5) * mag);
      }

      // 1. Deep Ocean Water (-1) background with animated wave ripples
      ctx.fillStyle = '#072a40';
      ctx.fillRect(0, 0, W, H);

      const wavePhase = timeMs * 0.0025;
      ctx.strokeStyle = 'rgba(56, 189, 248, 0.14)';
      ctx.lineWidth = 1.5;
      for (let wy = 10; wy < H - RULER_BOTTOM; wy += 18) {
        ctx.beginPath();
        for (let wx = RULER_LEFT; wx < W; wx += 22) {
          const yOff = Math.sin(wavePhase + wx * 0.05 + wy * 0.03) * 2.5;
          if (wx === RULER_LEFT) ctx.moveTo(wx, wy + yOff);
          else ctx.lineTo(wx, wy + yOff);
        }
        ctx.stroke();
      }

      // 2. Ocean Foam Shore Outline around [0, 30) x [0, 30)
      const foamPulse = 2 + Math.sin(wavePhase * 1.5) * 1.5;
      ctx.strokeStyle = 'rgba(125, 211, 252, 0.45)';
      ctx.lineWidth = foamPulse;
      ctx.strokeRect(offsetLeft - 2, offsetTop - 2, islandPx + 4, islandPx + 4);

      // 3. Render 30x30 Island Grid Tiles (Oxy: gy=0 is bottom row, gy=29 is top row)
      for (let gy = 0; gy < GRID_SIZE; gy++) {
        for (let gx = 0; gx < GRID_SIZE; gx++) {
          const { cx, cy } = oxyToCanvas(gx, gy + 1, islandPx, offsetLeft, offsetTop);
          const isEdgeSand = gx === 0 || gx === GRID_SIZE - 1 || gy === 0 || gy === GRID_SIZE - 1;
          const checker = (gx + gy) % 2 === 0;

          // Base ground (0): Tropical sand along perimeter, lush island turf inside
          if (isEdgeSand) {
            ctx.fillStyle = checker ? '#d6b87c' : '#cbb074';
          } else {
            ctx.fillStyle = checker ? '#2d5a3c' : '#285236';
          }
          ctx.fillRect(cx, cy, Math.ceil(cellPx), Math.ceil(cellPx));

          const tile = world.grid[gy][gx];

          // Brick Wall (1) - Indestructible Red-Brown Brick
          if (tile === TileType.BRICK) {
            ctx.fillStyle = '#7c2d12';
            ctx.fillRect(cx, cy, cellPx, cellPx);
            ctx.fillStyle = '#9a3412';
            ctx.fillRect(cx + 1, cy + 1, cellPx - 2, cellPx * 0.42);
            ctx.fillRect(cx + 1, cy + cellPx * 0.52, cellPx * 0.45, cellPx * 0.42);
            ctx.fillRect(cx + cellPx * 0.52, cy + cellPx * 0.52, cellPx * 0.42, cellPx * 0.42);
            ctx.strokeStyle = '#431407';
            ctx.lineWidth = 1;
            ctx.strokeRect(cx + 0.5, cy + 0.5, cellPx - 1, cellPx - 1);
          }

          // Wooden Crate (2) - Destructible (2 HP)
          else if (tile === TileType.CRATE) {
            const hp = world.obstacleHp[gy][gx];
            ctx.fillStyle = '#92400e';
            ctx.fillRect(cx + 1, cy + 1, cellPx - 2, cellPx - 2);
            ctx.strokeStyle = '#fbbf24';
            ctx.lineWidth = 1.2;
            ctx.strokeRect(cx + 2, cy + 2, cellPx - 4, cellPx - 4);
            // Cross beam
            ctx.beginPath();
            ctx.moveTo(cx + 2, cy + 2);
            ctx.lineTo(cx + cellPx - 2, cy + cellPx - 2);
            ctx.stroke();
            if (hp === 1) {
              // Damage crack
              ctx.strokeStyle = '#1e293b';
              ctx.lineWidth = 1.5;
              ctx.beginPath();
              ctx.moveTo(cx + cellPx * 0.3, cy + cellPx * 0.2);
              ctx.lineTo(cx + cellPx * 0.55, cy + cellPx * 0.5);
              ctx.lineTo(cx + cellPx * 0.4, cy + cellPx * 0.8);
              ctx.stroke();
            }
          }

          // Rock Boulder (3) - Destructible (4 HP)
          else if (tile === TileType.BOULDER) {
            const hp = world.obstacleHp[gy][gx];
            ctx.fillStyle = '#475569';
            ctx.beginPath();
            ctx.roundRect(cx + 1.5, cy + 1.5, cellPx - 3, cellPx - 3, 4);
            ctx.fill();
            ctx.fillStyle = '#94a3b8';
            ctx.fillRect(cx + 3, cy + 3, cellPx * 0.4, cellPx * 0.32);
            ctx.strokeStyle = '#1e293b';
            ctx.lineWidth = 1;
            ctx.strokeRect(cx + 1.5, cy + 1.5, cellPx - 3, cellPx - 3);
            if (hp < 4) {
              ctx.fillStyle = '#f8fafc';
              ctx.font = `bold ${Math.max(8, Math.floor(cellPx * 0.42))}px "JetBrains Mono", monospace`;
              ctx.textAlign = 'center';
              ctx.textBaseline = 'middle';
              ctx.fillText(String(hp), cx + cellPx / 2, cy + cellPx / 2);
            }
          }
        }
      }

      // 4. Optional Grid Overlay
      if (showGridRef.current) {
        ctx.strokeStyle = 'rgba(255, 255, 255, 0.11)';
        ctx.lineWidth = 0.75;
        for (let i = 0; i <= GRID_SIZE; i++) {
          const vx = offsetLeft + i * cellPx;
          ctx.beginPath();
          ctx.moveTo(vx, offsetTop);
          ctx.lineTo(vx, offsetTop + islandPx);
          ctx.stroke();

          const hy = offsetTop + i * cellPx;
          ctx.beginPath();
          ctx.moveTo(offsetLeft, hy);
          ctx.lineTo(offsetLeft + islandPx, hy);
          ctx.stroke();
        }
      }

      // 5. Render Teleporter Pairs (4)
      for (const portal of world.portals) {
        const endpoints = [portal.a, portal.b];
        for (const ep of endpoints) {
          const { cx, cy } = oxyToCanvas(ep.gx + 0.5, ep.gy + 0.5, islandPx, offsetLeft, offsetTop);
          const r = cellPx * 0.42;

          ctx.save();
          ctx.translate(cx, cy);
          ctx.rotate(timeMs * 0.004 * (portal.pairId === 0 ? 1 : -1));
          ctx.strokeStyle = portal.cooldown > 0 ? '#64748b' : portal.color;
          ctx.lineWidth = 2.2;
          ctx.setLineDash([4, 3]);
          ctx.beginPath();
          ctx.arc(0, 0, r, 0, Math.PI * 2);
          ctx.stroke();

          ctx.fillStyle = portal.cooldown > 0 ? 'rgba(100,116,139,0.25)' : `${portal.color}44`;
          ctx.beginPath();
          ctx.arc(0, 0, r * 0.6, 0, Math.PI * 2);
          ctx.fill();
          ctx.restore();

          if (portal.cooldown > 0) {
            ctx.fillStyle = '#e2e8f0';
            ctx.font = `bold ${Math.max(8, Math.floor(cellPx * 0.36))}px "JetBrains Mono", monospace`;
            ctx.textAlign = 'center';
            ctx.textBaseline = 'middle';
            ctx.fillText(portal.cooldown.toFixed(1), cx, cy);
          }
        }
      }

      // 6. Render Power-Up Items on map
      for (const item of world.items) {
        const { cx, cy } = oxyToCanvas(item.gx + 0.5, item.gy + 0.5, islandPx, offsetLeft, offsetTop);
        const bob = Math.sin(timeMs * 0.006 + item.gx) * 2;
        const r = cellPx * 0.38;

        ctx.save();
        ctx.translate(cx, cy + bob);

        let bg = '#1e293b';
        let border = '#fbbf24';
        let label = '?';
        if (item.type === 'CLOCK') {
          bg = '#0c4a6e';
          border = '#38bdf8';
          label = '⏱';
        } else if (item.type === 'HEART_1') {
          bg = '#064e3b';
          border = '#4ade80';
          label = '+1♥';
        } else if (item.type === 'HEART_2') {
          bg = '#14532d';
          border = '#22c55e';
          label = '+2♥';
        } else if (item.type === 'AMMO') {
          bg = '#451a03';
          border = '#fbbf24';
          label = 'ĐẠN';
        } else if (item.type === 'KNOCKBACK') {
          bg = '#4c0519';
          border = '#f43f5e';
          label = 'ĐẨY';
        }

        ctx.fillStyle = bg;
        ctx.strokeStyle = border;
        ctx.lineWidth = 1.6;
        ctx.beginPath();
        ctx.roundRect(-r, -r, r * 2, r * 2, 4);
        ctx.fill();
        ctx.stroke();

        ctx.fillStyle = '#ffffff';
        ctx.font = `bold ${Math.max(7, Math.floor(cellPx * 0.34))}px "JetBrains Mono", monospace`;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(label, 0, 0.5);
        ctx.restore();
      }

      // 7. Player Sensor Vision Circle (20-unit radius) & Raycast LoS lines
      const playerTank = world.tanks.find((t) => t.isPlayer);
      if (showSensorRef.current && playerTank && playerTank.alive) {
        const { cx: px, cy: py } = oxyToCanvas(
          playerTank.x,
          playerTank.y,
          islandPx,
          offsetLeft,
          offsetTop
        );
        ctx.save();
        ctx.strokeStyle = 'rgba(16, 185, 129, 0.25)';
        ctx.lineWidth = 1.2;
        ctx.setLineDash([5, 5]);
        ctx.beginPath();
        ctx.arc(px, py, SENSOR_RADIUS * cellPx, 0, Math.PI * 2);
        ctx.stroke();

        const visible = scanVisibleEnemies(playerTank, world.tanks, world.grid);
        for (const e of visible) {
          const { cx: ex, cy: ey } = oxyToCanvas(e.x, e.y, islandPx, offsetLeft, offsetTop);
          ctx.strokeStyle = e.status === 1 ? 'rgba(16, 185, 129, 0.55)' : 'rgba(245, 158, 11, 0.55)';
          ctx.lineWidth = 1.4;
          ctx.setLineDash(e.status === 1 ? [3, 3] : [2, 4]);
          ctx.beginPath();
          ctx.moveTo(px, py);
          ctx.lineTo(ex, ey);
          ctx.stroke();
        }
        ctx.restore();
      }

      // 8. Render Bullets & Trails
      for (const b of world.bullets) {
        if (b.trail.length > 1) {
          ctx.strokeStyle = b.hasKnockback ? 'rgba(244, 63, 94, 0.55)' : 'rgba(251, 191, 36, 0.45)';
          ctx.lineWidth = b.hasKnockback ? 3 : 2;
          ctx.beginPath();
          for (let i = 0; i < b.trail.length; i++) {
            const pt = oxyToCanvas(b.trail[i].x, b.trail[i].y, islandPx, offsetLeft, offsetTop);
            if (i === 0) ctx.moveTo(pt.cx, pt.cy);
            else ctx.lineTo(pt.cx, pt.cy);
          }
          ctx.stroke();
        }

        const { cx, cy } = oxyToCanvas(b.x, b.y, islandPx, offsetLeft, offsetTop);
        ctx.fillStyle = b.hasKnockback ? '#f43f5e' : '#fef08a';
        ctx.beginPath();
        ctx.arc(cx, cy, b.hasKnockback ? 4.2 : 3.2, 0, Math.PI * 2);
        ctx.fill();
      }

      // 9. Render All 4 Military Tanks
      for (const tank of world.tanks) {
        if (!tank.alive && tank.deathAnimTimer <= 0) continue;

        const { cx, cy } = oxyToCanvas(tank.x, tank.y, islandPx, offsetLeft, offsetTop);
        const isShrunk = tank.skillId === SkillId.SHRINK && tank.activeSkillTimer > 0;
        const isPhase = tank.skillId === SkillId.PHASE_SHIFT && tank.activeSkillTimer > 0;
        const scale = isShrunk ? 0.52 : 1.0;
        const tankRadius = cellPx * 0.42 * scale;

        ctx.save();
        ctx.translate(cx, cy);
        if (isPhase) {
          ctx.globalAlpha = 0.58;
        }
        if (!tank.alive) {
          ctx.globalAlpha = Math.max(0, tank.deathAnimTimer / 0.6);
          ctx.scale(1.3 - tank.deathAnimTimer * 0.4, 1.3 - tank.deathAnimTimer * 0.4);
        }

        // Active Skill Aura ring
        if (tank.activeSkillTimer > 0) {
          ctx.strokeStyle = '#38bdf8';
          ctx.lineWidth = 2;
          ctx.beginPath();
          ctx.arc(0, 0, tankRadius + 4, 0, Math.PI * 2);
          ctx.stroke();
        }

        // Tank Hull (Note: in Canvas Y points down, while Oxy angle 90 points UP, so canvas angle = -oxyAngle)
        ctx.save();
        ctx.rotate((-tank.hullAngle * Math.PI) / 180);

        // Treads
        ctx.fillStyle = '#0f172a';
        ctx.fillRect(-tankRadius, -tankRadius * 0.92, tankRadius * 2, tankRadius * 0.36);
        ctx.fillRect(-tankRadius, tankRadius * 0.56, tankRadius * 2, tankRadius * 0.36);

        // Main Armor Hull
        ctx.fillStyle = tank.hitFlashTimer > 0 ? '#ffffff' : tank.color;
        ctx.strokeStyle = '#0f172a';
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        ctx.roundRect(-tankRadius * 0.85, -tankRadius * 0.68, tankRadius * 1.7, tankRadius * 1.36, 3);
        ctx.fill();
        ctx.stroke();
        ctx.restore();

        // Tank Turret & Cannon Barrel
        ctx.save();
        ctx.rotate((-tank.turretAngle * Math.PI) / 180);
        ctx.fillStyle = '#1e293b';
        ctx.fillRect(0, -tankRadius * 0.2, tankRadius * 1.28, tankRadius * 0.4);
        ctx.fillStyle = tank.hitFlashTimer > 0 ? '#ffffff' : tank.turretColor;
        ctx.beginPath();
        ctx.arc(0, 0, tankRadius * 0.48, 0, Math.PI * 2);
        ctx.fill();
        ctx.strokeStyle = '#0f172a';
        ctx.lineWidth = 1.2;
        ctx.stroke();
        ctx.restore();

        ctx.restore();

        // Floating Tank Name, HP Bar & 2.5s Compile Progress Bar
        if (tank.alive) {
          const barW = Math.max(28, cellPx * 1.3);
          const barY = cy - cellPx * 0.68;

          // Tank ID label
          ctx.fillStyle = tank.isPlayer ? '#a7f3d0' : '#f8fafc';
          ctx.font = `bold ${Math.max(9, Math.floor(cellPx * 0.38))}px "JetBrains Mono", monospace`;
          ctx.textAlign = 'center';
          ctx.fillText(tank.isPlayer ? 'BẠN (#1)' : `#${tank.id}`, cx, barY - 6);

          // HP Bar
          ctx.fillStyle = 'rgba(15, 23, 42, 0.85)';
          ctx.fillRect(cx - barW / 2, barY - 3, barW, 4.5);
          ctx.fillStyle = tank.hp >= 3 ? '#10b981' : tank.hp === 2 ? '#f59e0b' : '#ef4444';
          ctx.fillRect(cx - barW / 2, barY - 3, (barW * tank.hp) / tank.maxHp, 4.5);

          // Live Override 1.0s Compile Bar
          if (tank.compileTimer > 0) {
            const pct = 1 - tank.compileTimer / COMPILE_COOLDOWN;
            ctx.fillStyle = 'rgba(15, 23, 42, 0.92)';
            ctx.fillRect(cx - barW * 0.65, cy + cellPx * 0.55, barW * 1.3, 6);
            ctx.fillStyle = '#38bdf8';
            ctx.fillRect(cx - barW * 0.65, cy + cellPx * 0.55, barW * 1.3 * pct, 6);
          }
        }
      }

      // 10. Particles & Floating Combat Text
      for (const p of world.particles) {
        if (!p.active) continue;
        const { cx, cy } = oxyToCanvas(p.x, p.y, islandPx, offsetLeft, offsetTop);
        ctx.save();
        ctx.globalAlpha = Math.max(0, p.life / p.maxLife);
        ctx.fillStyle = p.color;
        ctx.fillRect(cx - p.size / 2, cy - p.size / 2, p.size, p.size);
        ctx.restore();
      }

      for (const ft of world.floatingTexts) {
        const { cx, cy } = oxyToCanvas(ft.x, ft.y, islandPx, offsetLeft, offsetTop);
        ctx.save();
        ctx.globalAlpha = Math.max(0, ft.life / ft.maxLife);
        ctx.font = 'bold 11px "JetBrains Mono", monospace';
        ctx.textAlign = 'center';
        ctx.strokeStyle = '#0f172a';
        ctx.lineWidth = 3;
        ctx.strokeText(ft.text, cx, cy);
        ctx.fillStyle = ft.color;
        ctx.fillText(ft.text, cx, cy);
        ctx.restore();
      }

      // 12. Cartesian Oxy Coordinate Rulers:
      // Left Border = Y-Axis (0..29 pointing UP), Bottom Border = X-Axis (0..29 pointing RIGHT)
      ctx.fillStyle = '#0f172a';
      ctx.fillRect(0, 0, RULER_LEFT, H);
      ctx.fillRect(0, H - RULER_BOTTOM, W, RULER_BOTTOM);

      ctx.strokeStyle = '#334155';
      ctx.lineWidth = 1;
      ctx.beginPath();
      // Y-axis line
      ctx.moveTo(RULER_LEFT, offsetTop);
      ctx.lineTo(RULER_LEFT, offsetTop + islandPx);
      // X-axis line
      ctx.moveTo(offsetLeft, H - RULER_BOTTOM);
      ctx.lineTo(offsetLeft + islandPx, H - RULER_BOTTOM);
      ctx.stroke();

      ctx.fillStyle = '#94a3b8';
      ctx.font = '600 9px "JetBrains Mono", monospace';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';

      for (let i = 0; i < GRID_SIZE; i++) {
        // Show every coordinate if space permits, or every 2nd on compact canvas
        if (cellPx >= 18 || i % 2 === 0 || i === 29) {
          // X-axis tick along bottom
          const xPos = offsetLeft + (i + 0.5) * cellPx;
          ctx.fillText(String(i), xPos, H - RULER_BOTTOM / 2);

          // Y-axis tick along left (0 at bottom, 29 at top!)
          const yPos = offsetTop + (GRID_SIZE - 1 - i + 0.5) * cellPx;
          ctx.fillText(String(i), RULER_LEFT / 2, yPos);
        }
      }

      // Origin (0,0) Badge at Bottom-Left Corner
      ctx.fillStyle = '#10b981';
      ctx.font = 'bold 10px "JetBrains Mono", monospace';
      ctx.fillText('O(0,0)', RULER_LEFT / 2 + 4, H - RULER_BOTTOM / 2);

      ctx.restore();

      if (!disposed) {
        timerId = window.setTimeout(renderFrame, 32);
      }
    };

    const updateSize = () => {
      const rect = container.getBoundingClientRect();
      const size = Math.max(200, Math.floor(Math.min(rect.width - 4, rect.height - 4)));
      if (canvas.width !== size || canvas.height !== size) {
        canvas.width = size;
        canvas.height = size;
      }
    };

    updateSize();
    const ro = new ResizeObserver(updateSize);
    ro.observe(container);
    renderFrame();

    return () => {
      disposed = true;
      window.clearTimeout(timerId);
      ro.disconnect();
    };
  }, [worldRef]);

  const handleMouseMove = (e: React.MouseEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    const mx = e.clientX - rect.left;
    const my = e.clientY - rect.top;

    const offsetLeft = RULER_LEFT + OCEAN_PADDING;
    const offsetTop = OCEAN_PADDING;
    const islandPx = Math.max(
      140,
      Math.min(
        canvas.width - offsetLeft - OCEAN_PADDING,
        canvas.height - offsetTop - RULER_BOTTOM - OCEAN_PADDING
      )
    );

    const { x, y } = canvasToOxy(mx, my, islandPx, offsetLeft, offsetTop);
    const gx = Math.floor(x);
    const gy = Math.floor(y);
    const tileType = getGridTypeAt(worldRef.current.grid, gx, gy);

    setHoverInfo({
      x: Number(x.toFixed(1)),
      y: Number(y.toFixed(1)),
      gx,
      gy,
      tileType,
    });
  };

  const handleCanvasClick = () => {
    if (hoverInfo && hoverInfo.gx >= 0 && hoverInfo.gx < GRID_SIZE && hoverInfo.gy >= 0 && hoverInfo.gy < GRID_SIZE) {
      onSelectCoord?.(hoverInfo.gx, hoverInfo.gy);
    }
  };

  const getTileLabelVi = (t: number) => {
    switch (t) {
      case TileType.EMPTY:
        return '0: Đất trống';
      case TileType.BRICK:
        return '1: Tường gạch (Bật đạn)';
      case TileType.CRATE:
        return '2: Thùng gỗ (2 HP)';
      case TileType.BOULDER:
        return '3: Tảng đá (4 HP)';
      case TileType.PORTAL:
        return '4: Cổng dịch chuyển';
      default:
        return '-1: Nước biển sâu (Tử vong)';
    }
  };

  return (
    <div className="flex-1 flex flex-col bg-[#061826] rounded-lg border border-slate-800 overflow-hidden min-h-[180px]">
      {/* Oxy Axis Legend & Live Hover Coordinate Readout Strip */}
      <div className="flex items-center justify-between gap-3 bg-slate-950/95 border-b border-slate-800/90 px-3 py-1 text-[11px] font-mono tabular-nums text-slate-200 shrink-0">
        <span className="text-emerald-400 font-semibold whitespace-nowrap">
          Hệ Trục Oxy: Gốc O(0,0) Dưới-Trái · X(0..29) Ngang · Y(0..29) Dọc
        </span>
        {hoverInfo ? (
          <span className="truncate">
            Tọa độ: <strong className="text-amber-300">({hoverInfo.x.toFixed(1)}, {hoverInfo.y.toFixed(1)})</strong>
            {' · '}Ô: <strong className="text-sky-300">[{hoverInfo.gx}, {hoverInfo.gy}]</strong>
            {' · '}
            <span className="text-slate-300">{getTileLabelVi(hoverInfo.tileType)}</span>
          </span>
        ) : (
          <span className="text-slate-400 truncate">
            Di chuột hoặc nhấp vào ô trên đảo để lấy tọa độ Oxy (x, y)
          </span>
        )}
      </div>

      <div
        ref={containerRef}
        className="relative flex-1 flex items-center justify-center overflow-hidden min-h-0"
      >
        <canvas
          ref={canvasRef}
          data-testid="island-canvas"
          onMouseMove={handleMouseMove}
          onMouseLeave={() => setHoverInfo(null)}
          onClick={handleCanvasClick}
          className="cursor-crosshair block"
        />
      </div>
    </div>
  );
};

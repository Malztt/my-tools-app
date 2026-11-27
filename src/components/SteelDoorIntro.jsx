import React, { useEffect, useState } from 'react';

const RING_RADIUS = 52;
const RING_CIRC = 2 * Math.PI * RING_RADIUS; // ~326.73
const LOAD_DURATION_MS = 2000;

export default function SteelDoorIntro() {
  // Phases: 'loading' -> 'ignite' -> 'shearing' -> 'done'
  const [phase, setPhase] = useState('loading');
  const [progress, setProgress] = useState(0); // 0..1

  useEffect(() => {
    let rafId = null;
    let tShear = null;
    let tDone = null;
    const startTime = performance.now();

    const tick = (now) => {
      const elapsed = now - startTime;
      const t = Math.min(1, elapsed / LOAD_DURATION_MS);
      const eased = t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2;
      setProgress(eased);

      if (t < 1) {
        rafId = requestAnimationFrame(tick);
      } else {
        setPhase('ignite');
        tShear = setTimeout(() => setPhase('shearing'), 240);
        tDone = setTimeout(() => setPhase('done'), 1280);
      }
    };

    rafId = requestAnimationFrame(tick);
    return () => {
      if (rafId) cancelAnimationFrame(rafId);
      if (tShear) clearTimeout(tShear);
      if (tDone) clearTimeout(tDone);
    };
  }, []);

  if (phase === 'done') return null;

  const isIgnite = phase === 'ignite';
  const isShearing = phase === 'shearing';
  const pct = Math.round(progress * 100);
  const dashOffset = RING_CIRC * (1 - progress);

  return (
    <div
      onClick={() => setPhase('done')}
      title="คลิกเพื่อข้าม"
      className={`fixed inset-0 z-[100] overflow-hidden select-none cursor-pointer ${
        isShearing ? 'pointer-events-none' : ''
      }`}
    >
      {/* Left / Upper-Left Diagonal Steel Blast Door */}
      <div
        className={`steel-door-panel steel-door-left ${isShearing ? 'steel-door-open-left' : ''}`}
      >
        <div className="steel-ribs" />
        <span className="steel-rivet top-6 left-6" />
        <span className="steel-rivet top-6 left-16" />
        <span className="steel-rivet bottom-6 left-6" />
        <span className="steel-rivet bottom-16 left-6" />
        <div className="absolute top-8 left-24 hidden sm:flex items-center gap-2 text-[10px] font-mono tracking-[0.28em] text-slate-400/70 uppercase">
          <span className="w-2 h-2 rounded-full bg-orange-400 shadow-[0_0_8px_rgba(251,146,60,0.9)]" />
          <span>SECTOR-01 // WORKTOOLS HEAVY UTILITY</span>
        </div>
        <div className="absolute bottom-8 left-14 hidden sm:block text-[10px] font-mono tracking-[0.24em] text-slate-500/75">
          HYDRAULIC SHEAR LOCK :: ACTIVE
        </div>
      </div>

      {/* Right / Lower-Right Diagonal Steel Blast Door */}
      <div
        className={`steel-door-panel steel-door-right ${isShearing ? 'steel-door-open-right' : ''}`}
      >
        <div className="steel-ribs" />
        <span className="steel-rivet top-6 right-6" />
        <span className="steel-rivet top-16 right-6" />
        <span className="steel-rivet bottom-6 right-6" />
        <span className="steel-rivet bottom-6 right-16" />
        <div className="absolute bottom-8 right-24 hidden sm:flex items-center gap-2 text-[10px] font-mono tracking-[0.28em] text-slate-400/70 uppercase">
          <span>SYSTEM READY</span>
          <span className="w-2 h-2 rounded-full bg-orange-400 shadow-[0_0_8px_rgba(251,146,60,0.9)]" />
        </div>
      </div>

      {/* Diagonal Orange Molten Shear Seam */}
      <div
        className={`steel-seam-line ${
          isIgnite ? 'steel-seam-ignite' : isShearing ? 'steel-seam-fade' : ''
        }`}
      />

      {/* Central W Lock Core with 2s Circular Loading Ring */}
      <div
        className={`absolute inset-0 flex items-center justify-center pointer-events-none transition-all duration-400 ${
          isShearing ? 'opacity-0 scale-125' : 'opacity-100 scale-100'
        }`}
      >
        <div className="relative flex flex-col items-center">
          <div
            className="relative w-36 h-36 sm:w-40 sm:h-40 rounded-full flex items-center justify-center transition-all duration-300"
            style={{
              background:
                'radial-gradient(circle at 35% 30%, #334155 0%, #1e293b 55%, #0f172a 100%)',
              boxShadow: isIgnite
                ? '0 0 46px rgba(249, 115, 22, 0.8), inset 0 2px 4px rgba(255,255,255,0.25), inset 0 -4px 10px rgba(0,0,0,0.8)'
                : '0 16px 40px rgba(0,0,0,0.8), inset 0 2px 4px rgba(255,255,255,0.18), inset 0 -4px 10px rgba(0,0,0,0.8)',
              border: '3px solid rgba(148, 163, 184, 0.32)',
            }}
          >
            {/* 4 Mechanical Lock Bolts */}
            <span className="steel-bolt top-1.5 left-1/2 -translate-x-1/2" />
            <span className="steel-bolt bottom-1.5 left-1/2 -translate-x-1/2" />
            <span className="steel-bolt left-1.5 top-1/2 -translate-y-1/2" />
            <span className="steel-bolt right-1.5 top-1/2 -translate-y-1/2" />

            {/* SVG Circular Loading Ring around W */}
            <svg className="absolute inset-0 w-full h-full" viewBox="0 0 140 140">
              <defs>
                <linearGradient id="steelOrangeArc" x1="0%" y1="0%" x2="100%" y2="100%">
                  <stop offset="0%" stopColor="#f97316" />
                  <stop offset="60%" stopColor="#fb923c" />
                  <stop offset="100%" stopColor="#fde047" />
                </linearGradient>
              </defs>
              <circle
                cx="70"
                cy="70"
                r={RING_RADIUS}
                fill="none"
                stroke="rgba(148, 163, 184, 0.22)"
                strokeWidth="5"
              />
              <circle
                cx="70"
                cy="70"
                r={RING_RADIUS}
                fill="none"
                stroke="url(#steelOrangeArc)"
                strokeWidth="5"
                strokeLinecap="round"
                strokeDasharray={RING_CIRC}
                strokeDashoffset={dashOffset}
                style={{
                  transform: 'rotate(-90deg)',
                  transformOrigin: '50% 50%',
                  filter: 'drop-shadow(0 0 10px rgba(249, 115, 22, 0.9))',
                }}
              />
            </svg>

            {/* Center Bold Rounded W Emblem */}
            <div className="w-20 h-20 sm:w-22 sm:h-22 rounded-full bg-slate-900/95 border border-slate-700/80 flex items-center justify-center shadow-inner">
              <svg
                viewBox="0 0 64 64"
                className="w-12 h-12 sm:w-14 sm:h-14 transition-all duration-300"
                fill="none"
                style={{
                  color: isIgnite ? '#fed7aa' : '#f1f5f9',
                  filter: isIgnite
                    ? 'drop-shadow(0 0 20px rgba(249, 115, 22, 0.98))'
                    : 'drop-shadow(0 0 12px rgba(249, 115, 22, 0.55))',
                }}
              >
                <path
                  d="M11 18L19.5 47L32 25L44.5 47L53 18"
                  stroke="currentColor"
                  strokeWidth="9.5"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              </svg>
            </div>
          </div>

          {/* Brand + Progress Label */}
          <div className="mt-4 px-4 py-1 rounded-full bg-slate-900/90 border border-slate-600/50 shadow-lg flex items-center gap-2">
            <span
              className={`w-2 h-2 rounded-full transition-colors duration-300 ${
                isIgnite
                  ? 'bg-emerald-400 shadow-[0_0_8px_rgba(52,211,153,0.95)]'
                  : 'bg-orange-400 shadow-[0_0_8px_rgba(251,146,60,0.95)]'
              }`}
            />
            <span className="text-xs font-mono font-bold tracking-[0.2em] text-slate-100 uppercase">
              {pct < 100 ? `WORKTOOLS ${pct}%` : 'UNLOCKED'}
            </span>
          </div>
        </div>
      </div>
    </div>
  );
}

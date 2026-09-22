import { useEffect, useRef } from 'react';
import { SHARP_NAMES } from '../music/notes';
import { useEngine } from '../hooks/useEngine';

/**
 * Live view of what the detector is actually hearing. Enabled with ?debug=1.
 * This is the first thing to look at when detection misbehaves on real
 * hardware: if the chroma bars are flat, the problem is the microphone or the
 * constraints, not the matching.
 */
export function DebugPanel() {
  const { engine, state } = useEngine();
  const barsRef = useRef<(HTMLDivElement | null)[]>([]);
  const matchesRef = useRef<HTMLPreElement>(null);
  const statsRef = useRef<HTMLPreElement>(null);

  useEffect(() => {
    if (state !== 'running') return;
    return engine.onFrame((frame) => {
      let peak = 0;
      for (const value of frame.chroma) if (value > peak) peak = value;

      frame.chroma.forEach((value, i) => {
        const bar = barsRef.current[i];
        if (!bar) return;
        bar.style.height = `${peak > 0 ? (value / peak) * 100 : 0}%`;
        bar.classList.toggle('active', peak > 0 && value / peak > 0.55);
      });

      if (matchesRef.current) {
        matchesRef.current.textContent = frame.matches
          .slice(0, 5)
          .map((m) => `${m.chordId.padEnd(6)} ${(m.score * 100).toFixed(1)}%`)
          .join('\n');
      }
      if (statsRef.current) {
        statsRef.current.textContent = [
          `rms    ${frame.rms.toFixed(4)}${frame.silent ? '  (silent)' : ''}`,
          `flux   ${frame.flux.toFixed(2)}${frame.onset ? '  ONSET' : ''}`,
          `frame  ${frame.frameIndex}`,
        ].join('\n');
      }
    });
  }, [engine, state]);

  if (state !== 'running') {
    return (
      <section className="panel">
        <h2>Debug</h2>
        <p className="hint" style={{ marginBottom: 0 }}>
          Start the microphone to see live analysis.
        </p>
      </section>
    );
  }

  return (
    <section className="panel">
      <h2>Debug</h2>
      <p className="hint">Live chroma, top matches and frame stats.</p>
      <div className="chroma-bars">
        {SHARP_NAMES.map((_, i) => (
          <div
            key={i}
            ref={(el) => {
              barsRef.current[i] = el;
            }}
          />
        ))}
      </div>
      <div className="chroma-labels">
        {SHARP_NAMES.map((name) => (
          <span key={name}>{name}</span>
        ))}
      </div>
      <div className="row" style={{ marginTop: 14, alignItems: 'flex-start', gap: 28 }}>
        <pre className="match-list" ref={matchesRef} style={{ margin: 0 }} />
        <pre className="match-list" ref={statsRef} style={{ margin: 0 }} />
      </div>
    </section>
  );
}

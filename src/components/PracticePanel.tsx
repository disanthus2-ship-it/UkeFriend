import { useCallback, useEffect, useRef, useState } from 'react';
import { getChord } from '../music/chords';
import { PracticeSession, type SessionState } from '../practice/session';
import { formatMs } from '../practice/timing';
import { useAppStore } from '../state/store';
import { useEngine } from '../hooks/useEngine';
import { ChordDiagram } from './ChordDiagram';
import { MicGate } from './MicGate';

const RESULT_PAUSE_MS = 1500;

export function PracticePanel() {
  const selected = useAppStore((s) => s.selected);
  const showNoteNames = useAppStore((s) => s.showNoteNames);
  const calibrationOffsetMs = useAppStore((s) => s.calibrationOffsetMs);
  const record = useAppStore((s) => s.recordAttempt);

  const { engine, state: engineState, error, start } = useEngine();
  const [sessionState, setSessionState] = useState<SessionState | null>(null);
  const sessionRef = useRef<PracticeSession | null>(null);

  // These update ~23 times a second. Writing them straight to the DOM keeps
  // that traffic out of React's render path entirely.
  const confidenceRef = useRef<HTMLSpanElement>(null);
  const levelRef = useRef<HTMLSpanElement>(null);
  const heardRef = useRef<HTMLParagraphElement>(null);

  const beginSession = useCallback(() => {
    const session = new PracticeSession({
      chordIds: selected,
      detectorConfig: engine.config,
      calibrationOffsetMs,
      timeoutMs: 15000,
    });
    session.subscribe(setSessionState);
    sessionRef.current = session;
    session.start();
  }, [selected, engine, calibrationOffsetMs]);

  const endSession = useCallback(() => {
    sessionRef.current?.stop();
    sessionRef.current = null;
    setSessionState(null);
  }, []);

  useEffect(() => () => endSession(), [endSession]);

  // Feed analysis frames to the session and the meters.
  useEffect(() => {
    if (engineState !== 'running') return;
    return engine.onFrame((frame) => {
      const session = sessionRef.current;

      if (levelRef.current) {
        // Roughly -60 dB to 0 dB across the bar.
        const db = 20 * Math.log10(Math.max(frame.rms, 1e-6));
        levelRef.current.style.width = `${Math.max(0, Math.min(100, ((db + 60) / 60) * 100))}%`;
      }

      const expected = session?.snapshot().currentChordId ?? null;
      if (confidenceRef.current) {
        const match = expected ? frame.matches.find((m) => m.chordId === expected) : undefined;
        confidenceRef.current.style.width = `${Math.round((match?.score ?? 0) * 100)}%`;
      }
      if (heardRef.current) {
        const top = frame.matches[0];
        heardRef.current.textContent =
          frame.silent || !top ? '' : `hearing ${top.chordId} · ${(top.score * 100).toFixed(0)}%`;
      }

      const attempt = session?.handleFrame(frame);
      if (attempt) record(attempt);
    });
  }, [engine, engineState, record]);

  // Timestamp the prompt from a real paint, not from the state update that
  // scheduled it. The nested rAF runs after the browser has painted the frame
  // the first one was scheduled for.
  useEffect(() => {
    if (sessionState?.phase !== 'prompting') return;
    let inner = 0;
    const outer = requestAnimationFrame(() => {
      inner = requestAnimationFrame(() => {
        sessionRef.current?.markPrompted(performance.now());
      });
    });
    return () => {
      cancelAnimationFrame(outer);
      cancelAnimationFrame(inner);
    };
  }, [sessionState?.phase, sessionState?.promptIndex]);

  // Show the result briefly, then move on.
  useEffect(() => {
    if (sessionState?.phase !== 'result') return;
    const timer = setTimeout(() => sessionRef.current?.next(), RESULT_PAUSE_MS);
    return () => clearTimeout(timer);
  }, [sessionState?.phase, sessionState?.promptIndex]);

  if (engineState !== 'running' && engineState !== 'suspended') {
    return (
      <section className="panel">
        <h2>Practice</h2>
        <MicGate state={engineState} error={error} onStart={start} />
      </section>
    );
  }

  if (selected.length === 0) {
    return (
      <section className="panel">
        <h2>Practice</h2>
        <p className="hint" style={{ marginBottom: 0 }}>
          Choose at least one chord to practise.
        </p>
      </section>
    );
  }

  if (!sessionState || sessionState.phase === 'idle') {
    return (
      <section className="panel">
        <h2>Practice</h2>
        <div className="practice-stage">
          <p style={{ color: 'var(--muted)', textAlign: 'center', maxWidth: 400 }}>
            A chord appears, you strum it, and UkeFriend times how long it took you to sound
            it cleanly. {selected.length} chord{selected.length === 1 ? '' : 's'} in your set.
          </p>
          <button className="primary" onClick={beginSession}>
            Start practising
          </button>
        </div>
      </section>
    );
  }

  const chord = sessionState.currentChordId ? getChord(sessionState.currentChordId) : null;
  const last = sessionState.lastAttempt;
  const showingResult = sessionState.phase === 'result' && last;

  return (
    <section className="panel">
      <div className="row" style={{ justifyContent: 'space-between', marginBottom: 8 }}>
        <h2 style={{ margin: 0 }}>Practice</h2>
        <button
          className="ghost"
          style={{ minHeight: 34, padding: '4px 12px', fontSize: '0.82rem' }}
          onClick={endSession}
        >
          Stop
        </button>
      </div>

      <div className="practice-stage">
        {showingResult ? (
          <div className="result">
            <div className={`headline ${last.outcome === 'hit' ? 'hit' : 'miss'}`}>
              {last.outcome === 'hit'
                ? formatMs(last.latency?.totalMs ?? null)
                : last.outcome === 'miss'
                  ? 'Missed'
                  : 'Skipped'}
            </div>
            <p style={{ color: 'var(--muted)', margin: '4px 0 0' }}>{last.chordId}</p>
            {last.latency && (
              <div className="breakdown">
                <div>
                  <div className="label">Reaction</div>
                  <div className="value">{formatMs(last.latency.reactionMs)}</div>
                </div>
                <div>
                  <div className="label">Settle</div>
                  <div className="value">{formatMs(last.latency.settleMs)}</div>
                </div>
                <div>
                  <div className="label">Total</div>
                  <div className="value">{formatMs(last.latency.totalMs)}</div>
                </div>
              </div>
            )}
          </div>
        ) : (
          <>
            <div className="prompt-chord">{chord?.id ?? '—'}</div>
            {chord && <ChordDiagram chord={chord} showNoteNames={showNoteNames} size={0.9} />}
            <p className="prompt-status">
              {sessionState.phase === 'prompting' ? 'Get ready…' : 'Strum it'}
            </p>
          </>
        )}

        <div className="confidence" aria-hidden="true">
          <span ref={confidenceRef} />
        </div>
        <p className="heard" ref={heardRef} aria-live="off" />
        <div className="level-meter" aria-hidden="true">
          <span ref={levelRef} />
        </div>

        <div className="row" style={{ justifyContent: 'center' }}>
          <button
            className="ghost"
            onClick={() => {
              const attempt = sessionRef.current?.skip();
              if (attempt) record(attempt);
              sessionRef.current?.next();
            }}
          >
            Skip
          </button>
        </div>

        <p className="hint" style={{ margin: 0, textAlign: 'center' }}>
          {sessionState.attempts.filter((a) => a.outcome === 'hit').length} hit ·{' '}
          {sessionState.attempts.filter((a) => a.outcome === 'miss').length} missed
        </p>
      </div>
    </section>
  );
}

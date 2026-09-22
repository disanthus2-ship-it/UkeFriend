import { describe, it, expect } from 'vitest';
import { PracticeSession } from '../src/practice/session';
import {
  ChordDetector,
  DEFAULT_DETECTOR_CONFIG,
  type FrameAnalysis,
} from '../src/audio/detector';
import type { EngineFrame } from '../src/audio/engine';
import { getChord } from '../src/music/chords';
import { synthesizeVoicing, withLeadIn } from './helpers/synth';
import {
  applyAttempt,
  emptyStat,
  recordAttempt,
  loadStats,
  saveStats,
  clearStats,
  averageTotalMs,
  accuracy,
  RECENT_LIMIT,
  type StatsMap,
} from '../src/practice/stats';

const CONFIG = DEFAULT_DETECTOR_CONFIG;
const SR = CONFIG.sampleRate;

/**
 * Replay a synthesized performance through the real detector and the real
 * session, with the audio clock mapped onto a synthetic performance clock.
 * `t = 0 ms` on the performance clock is sample 0 of the buffer.
 */
function replay(audio: Float32Array): EngineFrame[] {
  const detector = new ChordDetector();
  const frames: EngineFrame[] = [];
  for (let start = 0, i = 0; start + CONFIG.fftSize <= audio.length; start += CONFIG.hopSize, i++) {
    const frame: FrameAnalysis = detector.processFrame(
      audio.subarray(start, start + CONFIG.fftSize),
      i,
    );
    frames.push({
      ...frame,
      performanceTime: (frame.centerSample / SR) * 1000,
      onsetPerformanceTime: (frame.onsetCenterSample / SR) * 1000,
    });
  }
  return frames;
}

/** Run a whole attempt: prompt at `promptAtMs`, then feed every frame. */
function runAttempt(chordId: string, audio: Float32Array, promptAtMs: number) {
  const session = new PracticeSession({
    chordIds: [chordId],
    detectorConfig: CONFIG,
    random: () => 0,
  });
  session.start();
  session.markPrompted(promptAtMs);

  for (const frame of replay(audio)) {
    if (frame.performanceTime < promptAtMs) continue;
    const attempt = session.handleFrame(frame);
    if (attempt) return { attempt, session };
  }
  return { attempt: null, session };
}

describe('practice session state machine', () => {
  it('starts idle and moves to prompting', () => {
    const session = new PracticeSession({ chordIds: ['C', 'G'], random: () => 0 });
    expect(session.snapshot().phase).toBe('idle');
    session.start();
    expect(session.snapshot().phase).toBe('prompting');
    expect(session.snapshot().currentChordId).toBeTruthy();
  });

  it('only starts listening once the prompt has been painted', () => {
    // Timing from a state update rather than a paint would charge the player
    // for React's render time.
    const session = new PracticeSession({ chordIds: ['C'], random: () => 0 });
    session.start();
    expect(session.snapshot().phase).toBe('prompting');
    session.markPrompted(1000);
    expect(session.snapshot().phase).toBe('listening');
  });

  it('ignores frames before the prompt is painted', () => {
    const session = new PracticeSession({ chordIds: ['C'], random: () => 0 });
    session.start();
    const frames = replay(synthesizeVoicing([0, 0, 0, 3], { duration: 1.0 }));
    for (const frame of frames) expect(session.handleFrame(frame)).toBeNull();
  });

  it('never prompts the same chord twice in a row', () => {
    const session = new PracticeSession({ chordIds: ['C', 'F', 'G'], random: () => 0.99 });
    session.start();
    let previous = session.snapshot().currentChordId;
    for (let i = 0; i < 12; i++) {
      session.markPrompted(0);
      session.skip(1);
      session.next();
      const current = session.snapshot().currentChordId;
      expect(current).not.toBe(previous);
      previous = current;
    }
  });

  it('finishes after a fixed number of prompts', () => {
    const session = new PracticeSession({ chordIds: ['C', 'G'], length: 3, random: () => 0 });
    session.start();
    for (let i = 0; i < 3; i++) {
      session.markPrompted(0);
      session.skip(1);
      session.next();
    }
    expect(session.snapshot().phase).toBe('finished');
    expect(session.snapshot().attempts).toHaveLength(3);
  });

  it('records a timeout as a miss', () => {
    const session = new PracticeSession({
      chordIds: ['C'],
      timeoutMs: 100,
      detectorConfig: CONFIG,
      random: () => 0,
    });
    session.start();
    session.markPrompted(0);
    const frames = replay(new Float32Array(SR)); // silence
    let attempt = null;
    for (const frame of frames) {
      attempt = session.handleFrame(frame);
      if (attempt) break;
    }
    expect(attempt?.outcome).toBe('miss');
    expect(attempt?.latency).toBeNull();
  });

  it('does not count a skip as a miss', () => {
    const session = new PracticeSession({ chordIds: ['C'], random: () => 0 });
    session.start();
    session.markPrompted(0);
    expect(session.skip(50)?.outcome).toBe('skipped');
  });

  it('handles an empty chord selection without crashing', () => {
    const session = new PracticeSession({ chordIds: [] });
    session.start();
    expect(session.snapshot().phase).toBe('finished');
  });

  it('stops cleanly', () => {
    const session = new PracticeSession({ chordIds: ['C'], random: () => 0 });
    session.start();
    session.stop();
    expect(session.snapshot().phase).toBe('idle');
    expect(session.snapshot().currentChordId).toBeNull();
  });

  it('notifies subscribers and can unsubscribe', () => {
    const session = new PracticeSession({ chordIds: ['C'], random: () => 0 });
    const seen: string[] = [];
    const unsubscribe = session.subscribe((s) => seen.push(s.phase));
    session.start();
    expect(seen).toContain('prompting');
    unsubscribe();
    const before = seen.length;
    session.markPrompted(0);
    expect(seen).toHaveLength(before);
  });
});

describe('end-to-end attempts against synthesized playing', () => {
  it('registers a hit and times it when the right chord is played', () => {
    const audio = withLeadIn(synthesizeVoicing([0, 0, 0, 3], { duration: 1.5 }), 0.4, SR);
    const { attempt } = runAttempt('C', audio, 400);

    expect(attempt?.outcome).toBe('hit');
    expect(attempt?.latency).not.toBeNull();
    // The strum begins exactly when the prompt appears, so a well-compensated
    // pipeline reports a small figure rather than the ~170 ms of raw pipeline lag.
    expect(attempt!.latency!.totalMs).toBeLessThan(120);
    expect(attempt!.latency!.rawTotalMs).toBeGreaterThan(attempt!.latency!.totalMs);
  });

  it('measures a slow reaction as reaction time, not settle time', () => {
    // Player waits 600 ms after the prompt, then strums cleanly.
    const audio = withLeadIn(synthesizeVoicing([0, 0, 0, 3], { duration: 1.5 }), 1.0, SR);
    const { attempt } = runAttempt('C', audio, 400); // strum at 1000 ms

    expect(attempt?.outcome).toBe('hit');
    expect(attempt!.latency!.reactionMs).toBeGreaterThan(520);
    expect(attempt!.latency!.reactionMs).toBeLessThan(680);
    expect(attempt!.latency!.settleMs!).toBeLessThan(150);
  });

  it('does not register a hit when the wrong chord is played', () => {
    const audio = withLeadIn(synthesizeVoicing([0, 2, 3, 2], { duration: 1.5 }), 0.4, SR); // G
    const session = new PracticeSession({
      chordIds: ['C'],
      timeoutMs: 100000,
      detectorConfig: CONFIG,
      random: () => 0,
    });
    session.start();
    session.markPrompted(400);
    for (const frame of replay(audio)) {
      if (frame.performanceTime < 400) continue;
      expect(session.handleFrame(frame)).toBeNull();
    }
  });

  it('works for every chord in the library', () => {
    for (const id of ['C', 'F', 'G', 'Am', 'Dm', 'E7', 'Bb', 'Bm']) {
      const chord = getChord(id)!;
      const audio = withLeadIn(synthesizeVoicing(chord.frets, { duration: 1.5 }), 0.4, SR);
      const { attempt } = runAttempt(id, audio, 400);
      expect(attempt?.outcome, `${id} was not registered as a hit`).toBe('hit');
    }
  }, 60000);

  it('reaction plus settle reconstructs the total', () => {
    const audio = withLeadIn(synthesizeVoicing([2, 0, 1, 0], { duration: 1.5 }), 0.8, SR);
    const { attempt } = runAttempt('F', audio, 400);
    const l = attempt!.latency!;
    expect(l.reactionMs! + l.settleMs!).toBeCloseTo(l.totalMs, 6);
  });
});

describe('stats', () => {
  it('accumulates hits, attempts and bests', () => {
    let stat = emptyStat('C');
    stat = applyAttempt(stat, {
      chordId: 'C',
      outcome: 'hit',
      at: 0,
      latency: {
        reactionMs: 200, settleMs: 100, totalMs: 300, rawTotalMs: 370,
        algorithmicDelayMs: 69, calibrationOffsetMs: 0, includesDeviceLatency: true,
      },
    });
    stat = applyAttempt(stat, {
      chordId: 'C',
      outcome: 'hit',
      at: 1,
      latency: {
        reactionMs: 150, settleMs: 50, totalMs: 200, rawTotalMs: 270,
        algorithmicDelayMs: 69, calibrationOffsetMs: 0, includesDeviceLatency: true,
      },
    });
    expect(stat.attempts).toBe(2);
    expect(stat.hits).toBe(2);
    expect(stat.bestTotalMs).toBe(200);
    expect(stat.bestSettleMs).toBe(50);
    expect(averageTotalMs(stat)).toBe(250);
    expect(accuracy(stat)).toBe(1);
  });

  it('counts a miss against accuracy but not against the best time', () => {
    let stat = emptyStat('C');
    stat = applyAttempt(stat, { chordId: 'C', outcome: 'miss', at: 0, latency: null });
    expect(stat.attempts).toBe(1);
    expect(stat.hits).toBe(0);
    expect(stat.bestTotalMs).toBeNull();
    expect(accuracy(stat)).toBe(0);
  });

  it('ignores skips entirely', () => {
    // Skipping is browsing, not failing.
    const stat = applyAttempt(emptyStat('C'), {
      chordId: 'C', outcome: 'skipped', at: 0, latency: null,
    });
    expect(stat.attempts).toBe(0);
  });

  it('keeps only the most recent results', () => {
    let stat = emptyStat('C');
    for (let i = 0; i < RECENT_LIMIT + 5; i++) {
      stat = applyAttempt(stat, {
        chordId: 'C', outcome: 'hit', at: i,
        latency: {
          reactionMs: 0, settleMs: 0, totalMs: i, rawTotalMs: i,
          algorithmicDelayMs: 69, calibrationOffsetMs: 0, includesDeviceLatency: true,
        },
      });
    }
    expect(stat.recentTotalsMs).toHaveLength(RECENT_LIMIT);
    expect(stat.recentTotalsMs[RECENT_LIMIT - 1]).toBe(RECENT_LIMIT + 4);
  });

  it('reports null averages before anything is recorded', () => {
    expect(averageTotalMs(emptyStat('C'))).toBeNull();
    expect(accuracy(emptyStat('C'))).toBeNull();
  });

  it('records into a map keyed by chord', () => {
    const map = recordAttempt({}, { chordId: 'G', outcome: 'miss', at: 0, latency: null });
    expect(map.G.attempts).toBe(1);
  });

  it('round-trips through storage', () => {
    const store = new Map<string, string>();
    const fake = {
      getItem: (k: string) => store.get(k) ?? null,
      setItem: (k: string, v: string) => void store.set(k, v),
      removeItem: (k: string) => void store.delete(k),
    } as unknown as Storage;

    const stats: StatsMap = recordAttempt({}, {
      chordId: 'C', outcome: 'hit', at: 0,
      latency: {
        reactionMs: 1, settleMs: 2, totalMs: 3, rawTotalMs: 4,
        algorithmicDelayMs: 69, calibrationOffsetMs: 0, includesDeviceLatency: true,
      },
    });
    saveStats(stats, fake);
    expect(loadStats(fake).C.bestTotalMs).toBe(3);
    clearStats(fake);
    expect(loadStats(fake)).toEqual({});
  });

  it('degrades to no history when storage throws', () => {
    // Private windows throw on access rather than returning null.
    const hostile = {
      getItem: () => { throw new Error('denied'); },
      setItem: () => { throw new Error('denied'); },
      removeItem: () => { throw new Error('denied'); },
    } as unknown as Storage;
    expect(loadStats(hostile)).toEqual({});
    expect(() => saveStats({}, hostile)).not.toThrow();
    expect(() => clearStats(hostile)).not.toThrow();
  });

  it('ignores corrupt or outdated stored data', () => {
    const make = (raw: string) => ({ getItem: () => raw, setItem: () => {}, removeItem: () => {} }) as unknown as Storage;
    expect(loadStats(make('not json'))).toEqual({});
    expect(loadStats(make('null'))).toEqual({});
    expect(loadStats(make('{"C":{"nonsense":true}}'))).toEqual({});
  });
});

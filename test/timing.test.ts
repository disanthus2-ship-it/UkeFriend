import { describe, it, expect } from 'vitest';
import {
  algorithmicDelayMs,
  onsetBiasMs,
  computeLatency,
  formatMs,
} from '../src/practice/timing';
import {
  ChordDetector,
  ConfirmationTracker,
  DEFAULT_DETECTOR_CONFIG,
  type DetectorConfig,
} from '../src/audio/detector';
import { CHORDS } from '../src/music/chords';
import { synthesizeVoicing, withLeadIn, type SynthOptions } from './helpers/synth';

const CONFIG = DEFAULT_DETECTOR_CONFIG;
const SR = CONFIG.sampleRate;

describe('algorithmic delay', () => {
  it('is around 69 ms at the default configuration', () => {
    expect(algorithmicDelayMs(CONFIG)).toBeCloseTo(69.1, 0);
  });

  it('grows with the window and the stability requirement', () => {
    const bigger: DetectorConfig = { ...CONFIG, fftSize: 16384 };
    const stricter: DetectorConfig = { ...CONFIG, stabilityFrames: 4 };
    expect(algorithmicDelayMs(bigger)).toBeGreaterThan(algorithmicDelayMs(CONFIG));
    expect(algorithmicDelayMs(stricter)).toBeGreaterThan(algorithmicDelayMs(CONFIG));
  });

  it('has no stability term when a single frame confirms', () => {
    const instant: DetectorConfig = { ...CONFIG, stabilityFrames: 1 };
    expect(algorithmicDelayMs(instant)).toBeCloseTo(
      (CONFIG.fftSize / 2 / SR) * 0.31 * 1000,
      3,
    );
  });

  it('scales with sample rate', () => {
    expect(algorithmicDelayMs({ ...CONFIG, sampleRate: 96000 })).toBeCloseTo(
      algorithmicDelayMs(CONFIG) / 2,
      3,
    );
  });

  it('reports an onset bias of about 16 ms', () => {
    expect(onsetBiasMs(CONFIG)).toBeCloseTo(16, 0);
  });
});

describe('latency breakdown', () => {
  const base = { promptAt: 1000, onsetAt: 1300, confirmedAt: 1500 };

  it('splits reaction from settle', () => {
    const r = computeLatency(base, CONFIG);
    // reaction = 1300 - 16 (onset bias) - 1000
    expect(r.reactionMs).toBeCloseTo(284, 0);
    // settle = (1500 - 69.1) - (1300 - 16)
    expect(r.settleMs).toBeCloseTo(146.9, 0);
    expect(r.totalMs).toBeCloseTo(430.9, 0);
  });

  it('reports the uncompensated total too', () => {
    expect(computeLatency(base, CONFIG).rawTotalMs).toBe(500);
  });

  it('reaction plus settle equals total', () => {
    const r = computeLatency(base, CONFIG);
    expect(r.reactionMs! + r.settleMs!).toBeCloseTo(r.totalMs, 6);
  });

  it('leaves settle unchanged by calibration, because device latency cancels', () => {
    // Device latency delays the strum and the confirmation equally. That makes
    // settle time the figure a player can actually trust across devices.
    const none = computeLatency(base, CONFIG, 0);
    const heavy = computeLatency(base, CONFIG, 150);
    expect(heavy.settleMs).toBeCloseTo(none.settleMs!, 6);
    expect(heavy.reactionMs).toBeCloseTo(none.reactionMs! - 150, 6);
  });

  it('flags when figures still include unmeasured device latency', () => {
    expect(computeLatency(base, CONFIG, 0).includesDeviceLatency).toBe(true);
    expect(computeLatency(base, CONFIG, 40).includesDeviceLatency).toBe(false);
  });

  it('handles a missing onset', () => {
    const r = computeLatency({ ...base, onsetAt: null }, CONFIG);
    expect(r.reactionMs).toBeNull();
    expect(r.settleMs).toBeNull();
    expect(r.totalMs).toBeCloseTo(430.9, 0);
  });

  it('never reports a negative time', () => {
    const r = computeLatency({ promptAt: 1000, onsetAt: 1001, confirmedAt: 1002 }, CONFIG);
    expect(r.totalMs).toBe(0);
    expect(r.reactionMs).toBe(0);
    expect(r.settleMs).toBe(0);
  });
});

/**
 * The compensation constants above were derived from measurement, so they need
 * a test that fails if the detector's timing ever drifts away from them.
 * Ground truth is exact here: the synthesized strum starts at a known sample.
 */
describe('end-to-end timing accuracy against known ground truth', () => {
  const LEAD_IN_MS = 400;

  function runAttempt(
    chordId: string,
    frets: readonly (number | null)[],
    opts: Partial<SynthOptions> = {},
  ): { onsetMs: number | null; confirmedMs: number | null } {
    const audio = withLeadIn(
      synthesizeVoicing(frets, { duration: 1.3, ...opts }),
      LEAD_IN_MS / 1000,
      SR,
    );
    const detector = new ChordDetector();
    const tracker = new ConfirmationTracker();
    let onsetMs: number | null = null;
    let confirmedMs: number | null = null;

    for (let start = 0, i = 0; start + CONFIG.fftSize <= audio.length; start += CONFIG.hopSize, i++) {
      const frame = detector.processFrame(audio.subarray(start, start + CONFIG.fftSize), i);
      if (frame.onset && onsetMs === null) onsetMs = (frame.onsetCenterSample / SR) * 1000;
      const confirmation = tracker.push(frame, chordId);
      if (confirmation && confirmedMs === null) {
        confirmedMs = (confirmation.centerSample / SR) * 1000;
      }
    }
    return { onsetMs, confirmedMs };
  }

  it('locates the strum within 25 ms of where it really is', () => {
    for (const chord of CHORDS) {
      const { onsetMs } = runAttempt(chord.id, chord.frets);
      expect(onsetMs, `no onset detected for ${chord.id}`).not.toBeNull();
      const corrected = onsetMs! - onsetBiasMs(CONFIG);
      expect(Math.abs(corrected - LEAD_IN_MS), `onset error for ${chord.id}`).toBeLessThan(25);
    }
  }, 60000);

  it('reports a compensated total close to zero for an instant, perfect strum', () => {
    // The player "reacts" instantly: the prompt is at the moment the strum
    // begins, so a perfectly compensated pipeline reports close to 0 ms.
    const errors: number[] = [];
    for (const chord of CHORDS) {
      const { onsetMs, confirmedMs } = runAttempt(chord.id, chord.frets);
      expect(confirmedMs, `no confirmation for ${chord.id}`).not.toBeNull();
      const result = computeLatency(
        { promptAt: LEAD_IN_MS, onsetAt: onsetMs, confirmedAt: confirmedMs! },
        CONFIG,
      );
      errors.push(result.totalMs);
    }
    const median = [...errors].sort((a, b) => a - b)[Math.floor(errors.length / 2)];
    // Median residual should be near zero; hop granularity is 43 ms, so a
    // single chord can legitimately sit a hop either side.
    expect(median).toBeLessThan(45);
    expect(Math.max(...errors)).toBeLessThan(120);
  }, 60000);

  it('attributes a slow strum to settle time, not to the analysis', () => {
    // A player who rolls the strum over 50 ms genuinely took longer to sound a
    // clean chord. That must show up as settle time, not be compensated away.
    const fast = runAttempt('C', [0, 0, 0, 3], { strumSpread: 0.005 });
    const slow = runAttempt('C', [0, 0, 0, 3], { strumSpread: 0.05 });

    const fastResult = computeLatency(
      { promptAt: LEAD_IN_MS, onsetAt: fast.onsetMs, confirmedAt: fast.confirmedMs! },
      CONFIG,
    );
    const slowResult = computeLatency(
      { promptAt: LEAD_IN_MS, onsetAt: slow.onsetMs, confirmedAt: slow.confirmedMs! },
      CONFIG,
    );
    expect(slowResult.settleMs!).toBeGreaterThan(fastResult.settleMs!);
  });
});

describe('formatting', () => {
  it('renders milliseconds, seconds and missing values', () => {
    expect(formatMs(345.6)).toBe('346 ms');
    expect(formatMs(1500)).toBe('1.50 s');
    expect(formatMs(null)).toBe('—');
    expect(formatMs(NaN)).toBe('—');
  });
});

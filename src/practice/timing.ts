import { ONSET_FFT_SIZE, type DetectorConfig } from '../audio/detector';

/**
 * How much of the analysis window a plucked chord must occupy before it can be
 * recognised, as a fraction of the half-window.
 *
 * The obvious assumption is 1.0 — that a chord is only identifiable once it
 * fills the window. Measured against synthesized strums it is about 0.31: a
 * plucked chord's energy is heavily front-loaded, so the windowed spectrum is
 * dominated by the new chord long before the window is full. Assuming 1.0
 * over-compensated by ~60 ms and drove most reported latencies to zero.
 */
const WINDOW_LAG_FRACTION = 0.31;

/**
 * Bias of the onset timestamp, as a fraction of the onset window.
 * Measured at a consistent +16 ms across timbre, strum speed and level.
 */
const ONSET_LAG_FRACTION = 0.75;

/**
 * Latency the analysis itself introduces before a chord can be confirmed, in ms.
 *
 * Two terms:
 * 1. Window occupancy — see `WINDOW_LAG_FRACTION` above (~26 ms at defaults).
 * 2. The stability run: a chord is confirmed only after winning
 *    `stabilityFrames` frames in a row, so the confirming frame sits
 *    `stabilityFrames - 1` hops after the first frame that qualified
 *    (~43 ms at defaults).
 *
 * Together ~69 ms at 48 kHz / 8192 / 2048 / 2, which matches the measured
 * median lag. This is subtracted from every reported figure. It is deliberately
 * separate from device audio latency, which cannot be measured this way.
 */
export function algorithmicDelayMs(config: DetectorConfig): number {
  const windowTerm = (config.fftSize / 2 / config.sampleRate) * WINDOW_LAG_FRACTION;
  const stabilityTerm = ((config.stabilityFrames - 1) * config.hopSize) / config.sampleRate;
  return (windowTerm + stabilityTerm) * 1000;
}

/** Bias of the onset timestamp, in ms. Subtracted from detected attack times. */
export function onsetBiasMs(config: DetectorConfig): number {
  return ((ONSET_FFT_SIZE * ONSET_LAG_FRACTION) / config.sampleRate) * 1000;
}

/** The raw timestamps an attempt produces, all on the performance clock. */
export interface AttemptTimestamps {
  /** When the chord prompt was painted. */
  readonly promptAt: number;
  /** When the strum's attack was detected, or null if none was seen. */
  readonly onsetAt: number | null;
  /** When the chord was confirmed correct. */
  readonly confirmedAt: number;
}

export interface LatencyBreakdown {
  /**
   * Prompt to strum: how fast the player reacted, before any question of
   * whether the chord was right. Null when no onset was seen, which happens if
   * the player was already strumming as the prompt appeared.
   *
   * Includes the device's microphone latency, which no browser API reports.
   */
  readonly reactionMs: number | null;
  /**
   * Strum to clean chord. The figure that catches a fumbled shape: a finger
   * that buzzes for 200 ms before it seats shows up here and nowhere else.
   *
   * Device latency delays the strum and the confirmation equally, so it
   * cancels out of this subtraction. That makes settle time the most
   * trustworthy number the app reports, and the one worth training against.
   */
  readonly settleMs: number | null;
  /** Prompt to confirmed chord, compensated. */
  readonly totalMs: number;
  /** Prompt to confirmed chord with nothing subtracted. */
  readonly rawTotalMs: number;
  /** How much was subtracted for the analysis window and stability run. */
  readonly algorithmicDelayMs: number;
  /** How much was subtracted from the user's own calibration, if any. */
  readonly calibrationOffsetMs: number;
  /** True when no calibration has been done, so the figures include device latency. */
  readonly includesDeviceLatency: boolean;
}

/**
 * Turn an attempt's timestamps into the figures the UI shows.
 *
 * Both audio timestamps are corrected for their own measured bias, then for the
 * user's calibration offset if they ran one. What remains uncorrected without
 * calibration is the device's capture latency — typically 20-60 ms, but over
 * 150 ms on Bluetooth.
 */
export function computeLatency(
  timestamps: AttemptTimestamps,
  config: DetectorConfig,
  calibrationOffsetMs = 0,
): LatencyBreakdown {
  const algorithmic = algorithmicDelayMs(config);
  const onsetBias = onsetBiasMs(config);
  const { promptAt, onsetAt, confirmedAt } = timestamps;

  const trueConfirmAt = confirmedAt - algorithmic - calibrationOffsetMs;
  const rawTotalMs = confirmedAt - promptAt;

  let reactionMs: number | null = null;
  let settleMs: number | null = null;
  if (onsetAt !== null) {
    const trueOnsetAt = onsetAt - onsetBias - calibrationOffsetMs;
    reactionMs = Math.max(0, trueOnsetAt - promptAt);
    settleMs = Math.max(0, trueConfirmAt - trueOnsetAt);
  }

  return {
    reactionMs,
    settleMs,
    totalMs: Math.max(0, trueConfirmAt - promptAt),
    rawTotalMs,
    algorithmicDelayMs: algorithmic,
    calibrationOffsetMs,
    includesDeviceLatency: calibrationOffsetMs === 0,
  };
}

/** Format a millisecond figure for display. */
export function formatMs(ms: number | null): string {
  if (ms === null || !Number.isFinite(ms)) return '—';
  if (ms < 1000) return `${Math.round(ms)} ms`;
  return `${(ms / 1000).toFixed(2)} s`;
}

/**
 * Maps the audio clock onto `performance.now()`.
 *
 * Frames arrive stamped with an audio-context time, but the chord prompt is
 * stamped with `performance.now()`. Subtracting one from the other without
 * aligning the clocks would produce a latency figure that is wrong by however
 * far the two clocks happen to have drifted apart.
 */
export class AudioClock {
  private anchorContextTime: number;
  private anchorPerformanceTime: number;

  constructor(private readonly context: BaseAudioContext) {
    this.anchorContextTime = context.currentTime;
    this.anchorPerformanceTime = performance.now();
    this.resync();
  }

  /**
   * Re-align the two clocks. `getOutputTimestamp()` gives a properly correlated
   * pair; where it is unavailable or not yet populated we fall back to sampling
   * both clocks at once, which is close enough for a 1 ms-resolution metric.
   */
  resync(): void {
    const ctx = this.context as AudioContext;
    if (typeof ctx.getOutputTimestamp === 'function') {
      const ts = ctx.getOutputTimestamp();
      if (ts && ts.contextTime !== undefined && ts.performanceTime !== undefined && ts.contextTime > 0) {
        this.anchorContextTime = ts.contextTime;
        this.anchorPerformanceTime = ts.performanceTime;
        return;
      }
    }
    this.anchorContextTime = this.context.currentTime;
    this.anchorPerformanceTime = performance.now();
  }

  /** Convert an audio-context time (seconds) to a performance timestamp (ms). */
  toPerformanceTime(contextTime: number): number {
    return this.anchorPerformanceTime + (contextTime - this.anchorContextTime) * 1000;
  }

  /** Convert a performance timestamp (ms) to an audio-context time (seconds). */
  toContextTime(performanceTime: number): number {
    return this.anchorContextTime + (performanceTime - this.anchorPerformanceTime) / 1000;
  }
}

/**
 * Everything we can and cannot know about the device's audio latency.
 *
 * `outputLatency` is the only figure the platform reports honestly, and it
 * describes the wrong direction — playback, not capture. There is no standard
 * API for input latency: Chrome exposes `MediaTrackSettings.latency` but it
 * returns a hardcoded 0.01 regardless of the hardware attached. So input
 * latency is either calibrated by the user or simply acknowledged.
 */
export interface LatencyInfo {
  /** AudioContext.baseLatency in ms, or null if unavailable. */
  readonly baseLatencyMs: number | null;
  /** AudioContext.outputLatency in ms, or null if unavailable. */
  readonly outputLatencyMs: number | null;
  /** User-supplied round-trip offset from calibration, in ms. */
  readonly calibrationOffsetMs: number;
}

export function readLatencyInfo(
  context: AudioContext,
  calibrationOffsetMs: number,
): LatencyInfo {
  const base = typeof context.baseLatency === 'number' ? context.baseLatency * 1000 : null;
  const output =
    typeof context.outputLatency === 'number' ? context.outputLatency * 1000 : null;
  return { baseLatencyMs: base, outputLatencyMs: output, calibrationOffsetMs };
}

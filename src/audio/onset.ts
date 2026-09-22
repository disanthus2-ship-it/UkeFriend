/**
 * Spectral-flux onset detection.
 *
 * Used to find the instant a strum begins, which is what makes the two halves
 * of the latency metric separable: time from prompt to strum (reaction) versus
 * time from strum to a clean-sounding chord (settle).
 */
export class OnsetDetector {
  private previous: Float32Array | null = null;
  private readonly history: number[] = [];
  private framesSinceOnset = Infinity;

  constructor(
    /** Frames of flux history used for the adaptive threshold. */
    private readonly historySize = 16,
    /** How far above the running median flux must rise to count as an onset. */
    private readonly thresholdRatio = 1.8,
    /** Minimum frames between onsets, to avoid double-triggering on one strum. */
    private readonly minFrameGap = 3,
  ) {}

  /**
   * Positive spectral flux for this frame, and whether it counts as an onset.
   * Only increases in magnitude are summed: a note dying away is not an attack.
   */
  process(magnitudes: Float32Array): { flux: number; onset: boolean } {
    let flux = 0;
    if (this.previous) {
      for (let i = 0; i < magnitudes.length; i++) {
        const diff = magnitudes[i] - this.previous[i];
        if (diff > 0) flux += diff;
      }
    }
    this.previous = Float32Array.from(magnitudes);
    this.framesSinceOnset++;

    const threshold = this.currentThreshold();
    this.history.push(flux);
    if (this.history.length > this.historySize) this.history.shift();

    // Need enough history for the threshold to mean anything.
    const ready = this.history.length >= Math.min(4, this.historySize);
    const onset =
      ready && flux > threshold && flux > 0 && this.framesSinceOnset >= this.minFrameGap;
    if (onset) this.framesSinceOnset = 0;

    return { flux, onset };
  }

  private currentThreshold(): number {
    if (this.history.length === 0) return Infinity;
    const sorted = [...this.history].sort((a, b) => a - b);
    const median = sorted[Math.floor(sorted.length / 2)];
    return median * this.thresholdRatio;
  }

  reset(): void {
    this.previous = null;
    this.history.length = 0;
    this.framesSinceOnset = Infinity;
  }
}

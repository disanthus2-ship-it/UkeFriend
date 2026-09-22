import { cosineSimilarity, rms } from '../lib/vector';
import { CHORD_TEMPLATES } from '../music/templates';
import { ChromaMapper } from './chroma';
import { FFT, applyWindow, hannWindow } from './fft';
import { OnsetDetector } from './onset';

export interface DetectorConfig {
  readonly sampleRate: number;
  /**
   * 8192 samples is ~170 ms at 48 kHz, giving ~5.9 Hz bins. That matters: the
   * lowest note a standard ukulele can sound is C4 (261.6 Hz), where adjacent
   * semitones are only ~15 Hz apart. A 4096 window (11.7 Hz bins) leaves barely
   * one bin per semitone down there and smears neighbouring notes together.
   */
  readonly fftSize: number;
  /** 2048 samples is ~43 ms at 48 kHz, so ~23 analysis frames per second. */
  readonly hopSize: number;
  /** Minimum cosine similarity for a match to count. */
  readonly minConfidence: number;
  /** How far the best match must beat the runner-up. */
  readonly minMargin: number;
  /** Consecutive frames the same chord must win before it is confirmed. */
  readonly stabilityFrames: number;
  /** Below this RMS the input is treated as silence. */
  readonly noiseFloorRms: number;
}

export const DEFAULT_DETECTOR_CONFIG: DetectorConfig = {
  sampleRate: 48000,
  fftSize: 8192,
  hopSize: 2048,
  // Measured against synthesized voicings across a range of timbres: a dark,
  // heavy-strung instrument (spectral rolloff 1/h^2) still scores 0.86 on the
  // right chord, so 0.85 left no headroom. The margin check below, not this
  // absolute floor, is what actually discriminates between similar chords.
  minConfidence: 0.8,
  minMargin: 0.025,
  stabilityFrames: 2,
  noiseFloorRms: 0.005,
};

/**
 * Onset detection runs on its own short window.
 *
 * The 8192-sample chord window is 170 ms long, which is fatal for timing an
 * attack: the first window that *contains* a strum is timestamped at its own
 * centre, up to 85 ms before the strum actually happened. Measured against
 * synthesized strums, that bias was a consistent -59 ms. A 1024-sample window
 * over the most recent audio locates the attack to within about a hop instead,
 * at the cost of one extra small FFT per frame.
 */
export const ONSET_FFT_SIZE = 1024;

export interface ChordMatch {
  readonly chordId: string;
  readonly score: number;
}

export interface FrameAnalysis {
  readonly frameIndex: number;
  /** Sample index at the centre of the chord-analysis window. */
  readonly centerSample: number;
  /** Sample index at the centre of the (much shorter) onset window. */
  readonly onsetCenterSample: number;
  readonly rms: number;
  readonly flux: number;
  readonly onset: boolean;
  readonly silent: boolean;
  readonly chroma: Float32Array;
  /** All chords, best first. */
  readonly matches: readonly ChordMatch[];
}

/**
 * Score a chroma vector against every chord in the library.
 * A chord with several voicings scores as its best-fitting one.
 */
export function matchChroma(chroma: Float32Array): ChordMatch[] {
  const matches: ChordMatch[] = CHORD_TEMPLATES.map((template) => {
    let best = 0;
    for (const variant of template.variants) {
      const score = cosineSimilarity(chroma, variant);
      if (score > best) best = score;
    }
    return { chordId: template.chordId, score: best };
  });
  return matches.sort((a, b) => b.score - a.score);
}

/**
 * Frame-by-frame chord analysis. Holds only DSP state — no AudioContext, no
 * DOM — so the same code path runs in the browser and in the test suite.
 */
export class ChordDetector {
  readonly config: DetectorConfig;
  private readonly fft: FFT;
  private readonly window: Float32Array;
  private readonly mapper: ChromaMapper;
  private readonly onsetDetector: OnsetDetector;
  private readonly windowed: Float32Array;
  private readonly magnitudes: Float32Array;
  private readonly onsetFft: FFT;
  private readonly onsetWindow: Float32Array;
  private readonly onsetWindowed: Float32Array;
  private readonly onsetMagnitudes: Float32Array;

  constructor(config: Partial<DetectorConfig> = {}) {
    this.config = { ...DEFAULT_DETECTOR_CONFIG, ...config };
    this.fft = new FFT(this.config.fftSize);
    this.window = hannWindow(this.config.fftSize);
    this.mapper = new ChromaMapper(this.config.sampleRate, this.config.fftSize);
    this.onsetDetector = new OnsetDetector();
    this.windowed = new Float32Array(this.config.fftSize);
    this.magnitudes = new Float32Array(this.config.fftSize / 2 + 1);

    this.onsetFft = new FFT(ONSET_FFT_SIZE);
    this.onsetWindow = hannWindow(ONSET_FFT_SIZE);
    this.onsetWindowed = new Float32Array(ONSET_FFT_SIZE);
    this.onsetMagnitudes = new Float32Array(ONSET_FFT_SIZE / 2 + 1);
  }

  /** Analyse one window of exactly `fftSize` raw samples. */
  processFrame(block: Float32Array, frameIndex: number): FrameAnalysis {
    const level = rms(block);
    const silent = level < this.config.noiseFloorRms;

    applyWindow(block, this.window, this.windowed);
    this.fft.magnitudes(this.windowed, this.magnitudes);

    // Onset runs on the most recent slice only, for time resolution.
    const recent = block.subarray(block.length - ONSET_FFT_SIZE);
    applyWindow(recent, this.onsetWindow, this.onsetWindowed);
    this.onsetFft.magnitudes(this.onsetWindowed, this.onsetMagnitudes);

    const { flux, onset } = this.onsetDetector.process(this.onsetMagnitudes);
    const chroma = this.mapper.compute(this.magnitudes);
    const matches = silent ? [] : matchChroma(chroma);

    return {
      frameIndex,
      centerSample: frameIndex * this.config.hopSize + this.config.fftSize / 2,
      onsetCenterSample:
        frameIndex * this.config.hopSize + this.config.fftSize - ONSET_FFT_SIZE / 2,
      rms: level,
      flux,
      onset: onset && !silent,
      silent,
      chroma,
      matches,
    };
  }

  reset(): void {
    this.onsetDetector.reset();
  }
}

export interface Confirmation {
  readonly chordId: string;
  /** Frame at which the chord met the criteria for the required run of frames. */
  readonly frameIndex: number;
  readonly centerSample: number;
  readonly score: number;
}

/**
 * Turns a stream of per-frame guesses into a single confident answer.
 *
 * A raw argmax flickers between neighbouring chords while a strum decays, so a
 * chord only counts once it has won clearly — by score, by margin over the
 * runner-up, and for several frames running.
 */
export class ConfirmationTracker {
  private currentId: string | null = null;
  private runLength = 0;

  constructor(private readonly config: DetectorConfig = DEFAULT_DETECTOR_CONFIG) {}

  /**
   * Feed one frame. Returns a confirmation on the frame where the run first
   * reaches the required length, and null otherwise.
   *
   * When `expected` is supplied the tracker is in verification mode: only that
   * chord can be confirmed. This is far more reliable than open-set naming,
   * because the app already knows which chord it asked the player for.
   */
  push(frame: FrameAnalysis, expected?: string): Confirmation | null {
    const best = frame.matches[0];
    const runnerUp = frame.matches[1];

    const qualifies =
      !frame.silent &&
      best !== undefined &&
      best.score >= this.config.minConfidence &&
      best.score - (runnerUp?.score ?? 0) >= this.config.minMargin &&
      (expected === undefined || best.chordId === expected);

    if (!qualifies || !best) {
      this.currentId = null;
      this.runLength = 0;
      return null;
    }

    if (best.chordId === this.currentId) {
      this.runLength++;
    } else {
      this.currentId = best.chordId;
      this.runLength = 1;
    }

    if (this.runLength === this.config.stabilityFrames) {
      return {
        chordId: best.chordId,
        frameIndex: frame.frameIndex,
        centerSample: frame.centerSample,
        score: best.score,
      };
    }
    return null;
  }

  reset(): void {
    this.currentId = null;
    this.runLength = 0;
  }
}

/**
 * Run the detector over a whole buffer offline, one frame per hop.
 * This is the entry point the test suite uses to check detection against
 * synthesized chords without a browser or a microphone.
 */
export function analyzeBuffer(
  samples: Float32Array,
  config: Partial<DetectorConfig> = {},
): FrameAnalysis[] {
  const detector = new ChordDetector(config);
  const { fftSize, hopSize } = detector.config;
  const frames: FrameAnalysis[] = [];

  for (let start = 0, i = 0; start + fftSize <= samples.length; start += hopSize, i++) {
    frames.push(detector.processFrame(samples.subarray(start, start + fftSize), i));
  }
  return frames;
}

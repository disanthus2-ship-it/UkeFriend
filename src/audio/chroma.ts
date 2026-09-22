import { l2Normalize } from '../lib/vector';
import { freqToMidi, mod12, PITCH_CLASS_COUNT } from '../music/notes';
import { BAND_MIN_HZ, BAND_MAX_HZ } from '../music/templates';

/**
 * How tightly a spectral bin must sit on a semitone centre to count, in
 * semitones. Energy exactly between two semitones is almost always noise or
 * an artefact rather than a played note, so it is attenuated.
 */
const SEMITONE_SIGMA = 0.35;

interface BinMapping {
  readonly bin: number;
  readonly pitchClass: number;
  readonly weight: number;
}

/**
 * Precomputed FFT-bin -> pitch-class mapping for one sample rate and FFT size.
 * Built once and reused for every frame; per-frame work is a single pass over
 * the in-band bins.
 */
export class ChromaMapper {
  readonly sampleRate: number;
  readonly fftSize: number;
  private readonly mappings: readonly BinMapping[];

  constructor(sampleRate: number, fftSize: number) {
    this.sampleRate = sampleRate;
    this.fftSize = fftSize;

    const binCount = fftSize / 2 + 1;
    const hzPerBin = sampleRate / fftSize;
    const mappings: BinMapping[] = [];

    for (let bin = 1; bin < binCount; bin++) {
      const freq = bin * hzPerBin;
      if (freq < BAND_MIN_HZ || freq > BAND_MAX_HZ) continue;

      const midi = freqToMidi(freq);
      const nearest = Math.round(midi);
      const delta = midi - nearest; // in semitones, -0.5..0.5
      const weight = Math.exp(-0.5 * (delta / SEMITONE_SIGMA) ** 2);

      mappings.push({ bin, pitchClass: mod12(nearest), weight });
    }

    this.mappings = mappings;
  }

  /** Number of FFT bins that fall inside the analysis band. */
  get binsInBand(): number {
    return this.mappings.length;
  }

  /**
   * Fold a magnitude spectrum into a unit-length 12-bin pitch-class profile.
   *
   * Magnitudes are used linearly rather than log-compressed, because the
   * chord templates model harmonic amplitudes linearly (1/h). Comparing a
   * log-compressed observation against a linear template would systematically
   * flatten the very harmonic structure the templates rely on.
   */
  compute(magnitudes: Float32Array, out?: Float32Array): Float32Array {
    const chroma = out ?? new Float32Array(PITCH_CLASS_COUNT);
    chroma.fill(0);
    for (const m of this.mappings) {
      chroma[m.pitchClass] += magnitudes[m.bin] * m.weight;
    }
    return l2Normalize(chroma);
  }
}

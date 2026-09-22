import { midiToFreq } from '../../src/music/notes';
import { voicingToMidi, type FretArray } from '../../src/music/tuning';

export interface SynthOptions {
  sampleRate: number;
  /** Total length in seconds. */
  duration: number;
  /** Harmonics per string. */
  harmonics: number;
  /** Seconds between consecutive strings being struck (a strum, not a block chord). */
  strumSpread: number;
  /** Random detune per string, in cents. */
  detuneCents: number;
  /** Peak amplitude before normalisation. */
  amplitude: number;
  /**
   * Spectral rolloff exponent: harmonic h has amplitude 1/h**rolloff.
   * The chord templates assume 1.0, so setting this away from 1.0 tests that
   * the detector tolerates instruments whose timbre differs from the model.
   */
  rolloff: number;
  seed: number;
}

export const DEFAULT_SYNTH: SynthOptions = {
  sampleRate: 48000,
  duration: 1.5,
  harmonics: 8,
  strumSpread: 0.018,
  detuneCents: 4,
  amplitude: 0.3,
  rolloff: 1,
  seed: 1,
};

/** Deterministic PRNG so test failures are reproducible. */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * A crude but honest plucked-string model: a harmonic series whose upper
 * partials decay faster than the fundamental, struck one string at a time.
 *
 * It is not meant to sound like a ukulele. It is meant to have the property
 * that actually matters to the detector — real harmonic spread, so a chord's
 * observed chroma is smeared across pitch classes the way a microphone would
 * hear it rather than being three clean spikes.
 */
export function synthesizeNotes(
  midiNotes: readonly number[],
  options: Partial<SynthOptions> = {},
): Float32Array {
  const opts = { ...DEFAULT_SYNTH, ...options };
  const rand = mulberry32(opts.seed);
  const length = Math.floor(opts.sampleRate * opts.duration);
  const out = new Float32Array(length);

  midiNotes.forEach((midi, stringIndex) => {
    const detune = (rand() * 2 - 1) * opts.detuneCents;
    const fundamental = midiToFreq(midi) * Math.pow(2, detune / 1200);
    const startSample = Math.floor(stringIndex * opts.strumSpread * opts.sampleRate);
    const phase = rand() * Math.PI * 2;

    for (let h = 1; h <= opts.harmonics; h++) {
      const freq = fundamental * h;
      if (freq >= opts.sampleRate / 2) break;
      const amp = opts.amplitude / Math.pow(h, opts.rolloff);
      // Higher partials die away sooner, as on a real string.
      const decay = 2.0 + 0.9 * h;
      const omega = (2 * Math.PI * freq) / opts.sampleRate;

      for (let i = startSample; i < length; i++) {
        const t = (i - startSample) / opts.sampleRate;
        // 4 ms attack, then exponential decay.
        const attack = Math.min(1, t / 0.004);
        out[i] += amp * attack * Math.exp(-decay * t) * Math.sin(omega * (i - startSample) + phase);
      }
    }
  });

  return out;
}

/** Synthesize a fretted voicing in standard tuning. */
export function synthesizeVoicing(
  frets: FretArray,
  options: Partial<SynthOptions> = {},
): Float32Array {
  return synthesizeNotes(voicingToMidi(frets), options);
}

/** White noise at a given RMS level. */
export function noise(length: number, level: number, seed = 7): Float32Array {
  const rand = mulberry32(seed);
  const out = new Float32Array(length);
  for (let i = 0; i < length; i++) out[i] = (rand() * 2 - 1) * level * Math.sqrt(3);
  return out;
}

/** Mix `b` into a copy of `a`. */
export function mix(a: Float32Array, b: Float32Array): Float32Array {
  const out = Float32Array.from(a);
  for (let i = 0; i < Math.min(out.length, b.length); i++) out[i] += b[i];
  return out;
}

/** Prepend `seconds` of silence, so onset detection has a baseline. */
export function withLeadIn(signal: Float32Array, seconds: number, sampleRate = 48000): Float32Array {
  const pad = Math.floor(seconds * sampleRate);
  const out = new Float32Array(pad + signal.length);
  out.set(signal, pad);
  return out;
}

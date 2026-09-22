import { describe, it, expect } from 'vitest';
import { FFT, hannWindow, applyWindow } from '../src/audio/fft';
import { ChromaMapper } from '../src/audio/chroma';
import { OnsetDetector } from '../src/audio/onset';
import {
  analyzeBuffer,
  matchChroma,
  ChordDetector,
  ConfirmationTracker,
  DEFAULT_DETECTOR_CONFIG,
  type FrameAnalysis,
} from '../src/audio/detector';
import { CHORDS, getChord } from '../src/music/chords';
import { midiToFreq } from '../src/music/notes';
import { cosineSimilarity } from '../src/lib/vector';
import { synthesizeVoicing, noise, mix, withLeadIn } from './helpers/synth';

const SR = DEFAULT_DETECTOR_CONFIG.sampleRate;

function sine(freq: number, length: number, sampleRate = SR, amp = 0.5): Float32Array {
  const out = new Float32Array(length);
  for (let i = 0; i < length; i++) out[i] = amp * Math.sin((2 * Math.PI * freq * i) / sampleRate);
  return out;
}

/** Winner by majority vote across the sustained part of a buffer. */
function majorityChord(audio: Float32Array): string | undefined {
  const frames = analyzeBuffer(audio).filter((f) => !f.silent).slice(1);
  const votes = new Map<string, number>();
  for (const f of frames) {
    const top = f.matches[0];
    if (top) votes.set(top.chordId, (votes.get(top.chordId) ?? 0) + 1);
  }
  return [...votes.entries()].sort((a, b) => b[1] - a[1])[0]?.[0];
}

describe('FFT', () => {
  it('rejects non-power-of-two sizes', () => {
    expect(() => new FFT(1000)).toThrow();
  });

  it('puts a pure tone in the right bin', () => {
    const size = 4096;
    const fft = new FFT(size);
    const win = hannWindow(size);
    const freq = (SR / size) * 100; // exactly bin 100
    const mags = fft.magnitudes(applyWindow(sine(freq, size), win));

    let peak = 0;
    for (let i = 1; i < mags.length; i++) if (mags[i] > mags[peak]) peak = i;
    expect(peak).toBe(100);
  });

  it('resolves two adjacent semitones at the ukulele\'s lowest note', () => {
    // This is the constraint that sets the window size: C4 and C#4 are only
    // ~15 Hz apart, and the detector must not merge them.
    const size = DEFAULT_DETECTOR_CONFIG.fftSize;
    const fft = new FFT(size);
    const win = hannWindow(size);
    const both = mix(sine(midiToFreq(60), size), sine(midiToFreq(61), size));
    const mags = fft.magnitudes(applyWindow(both, win));

    const binOf = (f: number) => Math.round(f / (SR / size));
    const c4 = binOf(midiToFreq(60));
    const cs4 = binOf(midiToFreq(61));
    expect(cs4 - c4).toBeGreaterThanOrEqual(2); // genuinely separate bins

    // There must be a dip between the two peaks, not one merged blob.
    const between = Math.floor((c4 + cs4) / 2);
    expect(mags[between]).toBeLessThan(Math.min(mags[c4], mags[cs4]) * 0.8);
  });

  it('is linear in amplitude', () => {
    const size = 1024;
    const fft = new FFT(size);
    const quiet = fft.magnitudes(sine(1000, size, SR, 0.1));
    const loud = fft.magnitudes(sine(1000, size, SR, 0.2));
    let q = 0, l = 0;
    for (let i = 0; i < quiet.length; i++) { q = Math.max(q, quiet[i]); l = Math.max(l, loud[i]); }
    expect(l / q).toBeCloseTo(2, 1);
  });
});

describe('chroma mapper', () => {
  const mapper = new ChromaMapper(SR, DEFAULT_DETECTOR_CONFIG.fftSize);

  it('only maps bins inside the analysis band', () => {
    expect(mapper.binsInBand).toBeGreaterThan(100);
    expect(mapper.binsInBand).toBeLessThan(DEFAULT_DETECTOR_CONFIG.fftSize / 2);
  });

  it('puts a pure A440 on the A pitch class', () => {
    const size = DEFAULT_DETECTOR_CONFIG.fftSize;
    const fft = new FFT(size);
    const mags = fft.magnitudes(applyWindow(sine(440, size), hannWindow(size)));
    const chroma = mapper.compute(mags);
    let best = 0;
    for (let i = 1; i < 12; i++) if (chroma[i] > chroma[best]) best = i;
    expect(best).toBe(9); // A
  });

  it('returns unit-length vectors', () => {
    const size = DEFAULT_DETECTOR_CONFIG.fftSize;
    const fft = new FFT(size);
    const mags = fft.magnitudes(applyWindow(sine(330, size), hannWindow(size)));
    const chroma = mapper.compute(mags);
    let sum = 0;
    for (const x of chroma) sum += x * x;
    expect(Math.sqrt(sum)).toBeCloseTo(1, 5);
  });

  it('is unmoved by low-frequency rumble', () => {
    // Mains hum and handling noise sit below the band. Adding a lot of it must
    // not change what the detector hears. (Checking a rumble-only chroma would
    // prove nothing: compute() normalises, so even pure noise comes back unit
    // length — what matters is whether rumble perturbs a real note.)
    const size = DEFAULT_DETECTOR_CONFIG.fftSize;
    const fft = new FFT(size);
    const win = hannWindow(size);

    const note = sine(440, size, SR, 0.3);
    const rumble = mix(
      mix(sine(50, size, SR, 0.5), sine(100, size, SR, 0.4)),
      sine(150, size, SR, 0.3),
    );

    const clean = mapper.compute(fft.magnitudes(applyWindow(note, win)));
    const dirty = mapper.compute(fft.magnitudes(applyWindow(mix(note, rumble), win)));
    expect(cosineSimilarity(clean, dirty)).toBeGreaterThan(0.99);
  });
});

describe('onset detection', () => {
  it('fires at the strum, not during the silence before it', () => {
    const audio = withLeadIn(synthesizeVoicing([0, 0, 0, 3], { duration: 1.0 }), 0.5, SR);
    const frames = analyzeBuffer(audio);
    const onsets = frames.filter((f) => f.onset);
    expect(onsets.length).toBeGreaterThan(0);

    const firstOnsetSec = onsets[0].centerSample / SR;
    // The strum starts at 0.5s; the window is centred, so the first onset frame
    // should land within roughly one window of it.
    expect(firstOnsetSec).toBeGreaterThan(0.4);
    expect(firstOnsetSec).toBeLessThan(0.85);
  });

  it('does not fire on steady silence', () => {
    const detector = new OnsetDetector();
    const quiet = new Float32Array(2048);
    let fired = 0;
    for (let i = 0; i < 40; i++) if (detector.process(quiet).onset) fired++;
    expect(fired).toBe(0);
  });

  it('resets cleanly', () => {
    const detector = new OnsetDetector();
    const mags = new Float32Array(64).fill(1);
    detector.process(mags);
    detector.reset();
    expect(detector.process(mags).flux).toBe(0); // no previous frame to diff against
  });
});

describe('chord detection against synthesized audio', () => {
  // The headline test: every chord in the library, played as a strummed,
  // slightly detuned, harmonically rich signal, must be identified correctly.
  it.each(CHORDS.map((c) => [c.id, c] as const))(
    'identifies %s from a synthesized strum',
    (id, chord) => {
      expect(majorityChord(synthesizeVoicing(chord.frets, { duration: 1.2 }))).toBe(id);
    },
  );

  it('identifies chords from a dark-timbred instrument', () => {
    // Heavier strings roll off faster than the 1/h the templates assume.
    for (const chord of CHORDS) {
      const audio = synthesizeVoicing(chord.frets, { duration: 1.2, rolloff: 1.8 });
      expect(majorityChord(audio)).toBe(chord.id);
    }
  });

  it('identifies chords from a bright-timbred instrument', () => {
    for (const chord of CHORDS) {
      const audio = synthesizeVoicing(chord.frets, { duration: 1.2, rolloff: 0.7 });
      expect(majorityChord(audio)).toBe(chord.id);
    }
  });

  it('tolerates a badly out-of-tune instrument', () => {
    for (const chord of CHORDS) {
      const audio = synthesizeVoicing(chord.frets, { duration: 1.2, detuneCents: 18 });
      expect(majorityChord(audio)).toBe(chord.id);
    }
  });

  it('tolerates a slow strum', () => {
    for (const chord of CHORDS) {
      const audio = synthesizeVoicing(chord.frets, { duration: 1.2, strumSpread: 0.05 });
      expect(majorityChord(audio)).toBe(chord.id);
    }
  });

  it('survives a noisy room at 12 dB SNR', () => {
    CHORDS.forEach((chord, i) => {
      const sig = synthesizeVoicing(chord.frets, { duration: 1.2 });
      let power = 0;
      for (const x of sig) power += x * x;
      const level = Math.sqrt(power / sig.length) / Math.pow(10, 12 / 20);
      expect(majorityChord(mix(sig, noise(sig.length, level, i + 1)))).toBe(chord.id);
    });
  });

  it('treats silence as silence', () => {
    const frames = analyzeBuffer(new Float32Array(SR));
    expect(frames.every((f) => f.silent)).toBe(true);
    expect(frames.every((f) => f.matches.length === 0)).toBe(true);
  });

  it('ranks matches best-first and scores every chord', () => {
    const frames = analyzeBuffer(synthesizeVoicing([0, 0, 0, 3], { duration: 0.6 }));
    const frame = frames.find((f) => !f.silent)!;
    expect(frame.matches).toHaveLength(CHORDS.length);
    for (let i = 1; i < frame.matches.length; i++) {
      expect(frame.matches[i - 1].score).toBeGreaterThanOrEqual(frame.matches[i].score);
    }
  });

  it('recognises an alternate voicing of the same chord', () => {
    const e = getChord('E')!;
    const barre = e.alternates![0];
    expect(majorityChord(synthesizeVoicing(barre.frets, { duration: 1.2 }))).toBe('E');
  });

  it('matchChroma returns zeros for an empty chroma vector', () => {
    for (const m of matchChroma(new Float32Array(12))) expect(m.score).toBe(0);
  });
});

describe('confirmation tracker', () => {
  function framesFor(audio: Float32Array): FrameAnalysis[] {
    return analyzeBuffer(audio);
  }

  it('confirms the expected chord when it is played', () => {
    const tracker = new ConfirmationTracker();
    let confirmed: string | null = null;
    for (const frame of framesFor(synthesizeVoicing([0, 0, 0, 3], { duration: 1.2 }))) {
      const result = tracker.push(frame, 'C');
      if (result) { confirmed = result.chordId; break; }
    }
    expect(confirmed).toBe('C');
  });

  it('never confirms the expected chord when a different one is played', () => {
    // Prompt says C, player plays G. This is the false-positive case that would
    // make the app worthless, so it is checked for every pair of chords below too.
    const tracker = new ConfirmationTracker();
    for (const frame of framesFor(synthesizeVoicing([0, 2, 3, 2], { duration: 1.2 }))) {
      expect(tracker.push(frame, 'C')).toBeNull();
    }
  });

  it('never confirms a wrong chord for any chord pair in the library', () => {
    for (const played of CHORDS) {
      const frames = framesFor(synthesizeVoicing(played.frets, { duration: 0.8 }));
      for (const expectedChord of CHORDS) {
        if (expectedChord.id === played.id) continue;
        const tracker = new ConfirmationTracker();
        let falsePositive: string | null = null;
        for (const frame of frames) {
          const r = tracker.push(frame, expectedChord.id);
          if (r) { falsePositive = r.chordId; break; }
        }
        expect(
          falsePositive,
          `played ${played.id} but confirmed it as ${expectedChord.id}`,
        ).toBeNull();
      }
    }
  }, 60000);

  it('does not confirm anything from silence', () => {
    const tracker = new ConfirmationTracker();
    for (const frame of framesFor(new Float32Array(SR))) {
      expect(tracker.push(frame)).toBeNull();
    }
  });

  it('does not confirm anything from noise alone', () => {
    const tracker = new ConfirmationTracker();
    for (const frame of framesFor(noise(SR, 0.05, 3))) {
      expect(tracker.push(frame, 'C')).toBeNull();
    }
  });

  it('requires a sustained run, not a single lucky frame', () => {
    const detector = new ChordDetector();
    const audio = synthesizeVoicing([0, 0, 0, 3], { duration: 1.2 });
    const { fftSize, hopSize, stabilityFrames } = DEFAULT_DETECTOR_CONFIG;
    const tracker = new ConfirmationTracker();

    let firstQualifyingFrame = -1;
    let confirmedFrame = -1;
    for (let start = 0, i = 0; start + fftSize <= audio.length; start += hopSize, i++) {
      const frame = detector.processFrame(audio.subarray(start, start + fftSize), i);
      const top = frame.matches[0];
      const qualifies =
        !frame.silent &&
        top?.chordId === 'C' &&
        top.score >= DEFAULT_DETECTOR_CONFIG.minConfidence &&
        top.score - (frame.matches[1]?.score ?? 0) >= DEFAULT_DETECTOR_CONFIG.minMargin;
      if (qualifies && firstQualifyingFrame < 0) firstQualifyingFrame = i;
      const result = tracker.push(frame, 'C');
      if (result && confirmedFrame < 0) confirmedFrame = result.frameIndex;
    }

    expect(confirmedFrame).toBe(firstQualifyingFrame + stabilityFrames - 1);
  });

  it('resets its run state', () => {
    const tracker = new ConfirmationTracker();
    const frames = framesFor(synthesizeVoicing([0, 0, 0, 3], { duration: 1.2 }));
    const playable = frames.filter((f) => !f.silent);
    tracker.push(playable[2], 'C');
    tracker.reset();
    // After a reset the very next frame can only be run length 1, never a confirm.
    expect(tracker.push(playable[3], 'C')).toBeNull();
  });
});

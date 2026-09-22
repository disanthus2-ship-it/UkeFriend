import { l2Normalize } from '../lib/vector';
import { midiToFreq, mod12, PITCH_CLASS_COUNT } from './notes';
import { voicingToMidi, type FretArray } from './tuning';
import { CHORDS, type Chord } from './chords';

/**
 * Frequency band the detector analyses, and therefore the band the templates
 * must model. The bottom is just under C4 (261.6 Hz), the lowest note standard
 * re-entrant tuning can sound; the top is above the 6th harmonic of the
 * highest fretted note, while still excluding most cymbal-ish room noise.
 */
export const BAND_MIN_HZ = 200;
export const BAND_MAX_HZ = 2000;

/** How many harmonics of each string we model. */
export const HARMONIC_COUNT = 6;

/**
 * Amplitude of harmonic `h` relative to the fundamental. A plucked string rolls
 * off roughly as 1/h, which is close enough for template matching and much more
 * honest than pretending only fundamentals exist.
 */
function harmonicAmplitude(h: number): number {
  return 1 / h;
}

/**
 * Expected chroma for a set of sounding MIDI notes.
 *
 * This is the heart of the detector's accuracy. A naive binary template says
 * "C major = {C, E, G}", but a real plucked C string also radiates energy at its
 * 3rd harmonic (a G) and 5th harmonic (an E). So a microphone hearing a clean C
 * major already sees energy spread well beyond those three pitch classes — and a
 * binary template scores it poorly.
 *
 * By summing the harmonic series of each sounded string we build a template that
 * *expects* the same spread, so the comparison is like-for-like.
 */
export function chromaFromMidiNotes(notes: readonly number[]): Float32Array {
  const chroma = new Float32Array(PITCH_CLASS_COUNT);
  for (const midi of notes) {
    const fundamental = midiToFreq(midi);
    for (let h = 1; h <= HARMONIC_COUNT; h++) {
      const freq = fundamental * h;
      // Only count partials the detector can actually see.
      if (freq < BAND_MIN_HZ || freq > BAND_MAX_HZ) continue;
      // Harmonic h sits log2(h) octaves up; fold that to a pitch class.
      const semitonesUp = 12 * Math.log2(h);
      const pc = mod12(Math.round(midi + semitonesUp));
      chroma[pc] += harmonicAmplitude(h);
    }
  }
  return l2Normalize(chroma);
}

/** Expected chroma for a fretted voicing. */
export function chromaFromVoicing(frets: FretArray): Float32Array {
  return chromaFromMidiNotes(voicingToMidi(frets));
}

export interface ChordTemplate {
  readonly chordId: string;
  /** One entry per playable voicing of this chord (default first, then alternates). */
  readonly variants: readonly Float32Array[];
}

/** Templates for every voicing of a chord, default voicing first. */
export function templatesForChord(chord: Chord): ChordTemplate {
  const variants = [chromaFromVoicing(chord.frets)];
  for (const alt of chord.alternates ?? []) variants.push(chromaFromVoicing(alt.frets));
  return { chordId: chord.id, variants };
}

/** The full template bank, built once at module load. */
export const CHORD_TEMPLATES: readonly ChordTemplate[] = CHORDS.map(templatesForChord);

const TEMPLATES_BY_ID = new Map(CHORD_TEMPLATES.map((t) => [t.chordId, t]));

export function templateFor(chordId: string): ChordTemplate | undefined {
  return TEMPLATES_BY_ID.get(chordId);
}

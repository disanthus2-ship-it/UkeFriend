import { midiToFreq, midiToName, type PitchClass, mod12 } from './notes';

export interface UkuleleString {
  /** Display label, e.g. "G". */
  readonly label: string;
  /** MIDI note of the open string. */
  readonly openMidi: number;
}

export interface Tuning {
  readonly id: string;
  readonly name: string;
  /**
   * Strings in chord-box reading order (left to right as you look at the
   * fretboard from the front): G C E A for standard ukulele.
   */
  readonly strings: readonly UkuleleString[];
}

/**
 * Standard re-entrant ukulele tuning. "Re-entrant" means the 4th string is NOT
 * the lowest — the G sits a fifth *above* the C, which is why a ukulele's
 * lowest sounding note is C4 (261.6 Hz) rather than G3. The detector relies on
 * that: it never has to resolve pitches below ~260 Hz.
 */
export const STANDARD_GCEA: Tuning = {
  id: 'gcea',
  name: 'Standard (high G)',
  strings: [
    { label: 'G', openMidi: 67 }, // G4
    { label: 'C', openMidi: 60 }, // C4
    { label: 'E', openMidi: 64 }, // E4
    { label: 'A', openMidi: 69 }, // A4
  ],
};

export const STRING_COUNT = STANDARD_GCEA.strings.length;

/** Lowest note any standard-tuning voicing can sound. Sets the FFT resolution we need. */
export const LOWEST_MIDI = 60; // C4
export const LOWEST_FREQ = midiToFreq(LOWEST_MIDI); // ~261.6 Hz

/**
 * A fretted voicing: one entry per string in `tuning.strings` order.
 * `null` means the string is not sounded (muted/not strummed).
 */
export type FretArray = readonly (number | null)[];

/** Sounding MIDI notes of a voicing, in string order, skipping muted strings. */
export function voicingToMidi(frets: FretArray, tuning: Tuning = STANDARD_GCEA): number[] {
  const notes: number[] = [];
  frets.forEach((fret, i) => {
    const string = tuning.strings[i];
    if (fret === null || fret === undefined || !string) return;
    notes.push(string.openMidi + fret);
  });
  return notes;
}

/** Distinct pitch classes a voicing sounds, ascending. */
export function voicingToPitchClasses(
  frets: FretArray,
  tuning: Tuning = STANDARD_GCEA,
): PitchClass[] {
  const set = new Set<PitchClass>();
  for (const midi of voicingToMidi(frets, tuning)) set.add(mod12(midi));
  return [...set].sort((a, b) => a - b);
}

/** Note names a voicing sounds, in string order, e.g. ["G4","C4","E4","C5"]. */
export function voicingToNoteNames(
  frets: FretArray,
  tuning: Tuning = STANDARD_GCEA,
  flat = false,
): string[] {
  return voicingToMidi(frets, tuning).map((m) => midiToName(m, flat));
}

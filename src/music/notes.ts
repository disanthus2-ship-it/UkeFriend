/**
 * Pitch-class and MIDI helpers. Everything downstream (chord voicings, chroma
 * templates, the detector) speaks in pitch classes 0..11 where 0 = C.
 */

export type PitchClass = number; // 0..11, 0 = C

export const PITCH_CLASS_COUNT = 12;

/** Sharp spellings, used as the default display form. */
export const SHARP_NAMES = [
  'C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B',
] as const;

/** Flat spellings, preferred in flat keys (F, Bb, Eb...). */
export const FLAT_NAMES = [
  'C', 'Db', 'D', 'Eb', 'E', 'F', 'Gb', 'G', 'Ab', 'A', 'Bb', 'B',
] as const;

/** Wrap any integer into 0..11. Works for negative inputs. */
export function mod12(n: number): PitchClass {
  return ((n % 12) + 12) % 12;
}

/** Name a pitch class. `flat` picks the flat spelling (Bb rather than A#). */
export function pitchClassName(pc: PitchClass, flat = false): string {
  const names = flat ? FLAT_NAMES : SHARP_NAMES;
  return names[mod12(pc)];
}

/** Parse a note name ("C", "F#", "Bb") into a pitch class, or null if unparseable. */
export function parsePitchClass(name: string): PitchClass | null {
  const trimmed = name.trim();
  const letters = 'C_D_EF_G_A_B';
  const letter = trimmed[0]?.toUpperCase();
  if (!letter) return null;
  const base = letters.indexOf(letter);
  if (base < 0) return null;

  let pc = base;
  for (const accidental of trimmed.slice(1)) {
    if (accidental === '#') pc += 1;
    else if (accidental === 'b') pc -= 1;
    else break; // quality suffix such as the "m" in "Cm" — stop here
  }
  return mod12(pc);
}

/** MIDI note number -> frequency in Hz (A4 = MIDI 69 = 440 Hz). */
export function midiToFreq(midi: number): number {
  return 440 * Math.pow(2, (midi - 69) / 12);
}

/** Frequency in Hz -> fractional MIDI note number. */
export function freqToMidi(freq: number): number {
  return 69 + 12 * Math.log2(freq / 440);
}

/** MIDI note number -> pitch class. */
export function midiToPitchClass(midi: number): PitchClass {
  return mod12(Math.round(midi));
}

/** Name a MIDI note with its octave, e.g. 60 -> "C4". */
export function midiToName(midi: number, flat = false): string {
  const rounded = Math.round(midi);
  const octave = Math.floor(rounded / 12) - 1;
  return `${pitchClassName(rounded, flat)}${octave}`;
}

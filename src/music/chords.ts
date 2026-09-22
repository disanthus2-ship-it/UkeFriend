import { mod12, parsePitchClass, pitchClassName, type PitchClass } from './notes';
import { voicingToPitchClasses, type FretArray } from './tuning';

/** Chord qualities the library covers, with intervals in semitones from the root. */
export const QUALITIES = {
  major: { suffix: '', intervals: [0, 4, 7], label: 'major' },
  minor: { suffix: 'm', intervals: [0, 3, 7], label: 'minor' },
  dom7: { suffix: '7', intervals: [0, 4, 7, 10], label: 'dominant 7th' },
  maj7: { suffix: 'maj7', intervals: [0, 4, 7, 11], label: 'major 7th' },
  min7: { suffix: 'm7', intervals: [0, 3, 7, 10], label: 'minor 7th' },
  dim: { suffix: 'dim', intervals: [0, 3, 6], label: 'diminished' },
  sus4: { suffix: 'sus4', intervals: [0, 5, 7], label: 'suspended 4th' },
  sus2: { suffix: 'sus2', intervals: [0, 2, 7], label: 'suspended 2nd' },
} as const;

export type Quality = keyof typeof QUALITIES;

export interface Chord {
  /** Display name and stable identifier, e.g. "Cmaj7". */
  readonly id: string;
  readonly root: PitchClass;
  readonly quality: Quality;
  /** Fret per string in G-C-E-A order; null = not sounded. */
  readonly frets: FretArray;
  /** Fretting hand finger per string: 0 = open, 1-4 = index..pinky. */
  readonly fingers: readonly number[];
  /** Rough ordering for the beginner-friendly sort. 1 = easiest. */
  readonly difficulty: 1 | 2 | 3;
  /** Alternative voicings, same chord. */
  readonly alternates?: readonly { frets: FretArray; fingers: readonly number[]; note: string }[];
}

function chord(
  id: string,
  quality: Quality,
  frets: FretArray,
  fingers: readonly number[],
  difficulty: 1 | 2 | 3,
  alternates?: Chord['alternates'],
): Chord {
  const root = parsePitchClass(id);
  if (root === null) throw new Error(`Unparseable chord root in "${id}"`);
  return { id, root, quality, frets, fingers, difficulty, alternates };
}

/**
 * Standard-tuning (GCEA) voicings. Frets read G, C, E, A.
 * Every entry is checked against its quality's interval formula in the test
 * suite, so a typo here fails the build rather than silently teaching a wrong shape.
 */
export const CHORDS: readonly Chord[] = [
  chord('C', 'major', [0, 0, 0, 3], [0, 0, 0, 3], 1),
  chord('C7', 'dom7', [0, 0, 0, 1], [0, 0, 0, 1], 1),
  chord('Cmaj7', 'maj7', [0, 0, 0, 2], [0, 0, 0, 2], 1),
  chord('Cm', 'minor', [0, 3, 3, 3], [0, 1, 1, 1], 2),
  chord('Csus4', 'sus4', [0, 0, 1, 3], [0, 0, 1, 3], 1),
  chord('D', 'major', [2, 2, 2, 0], [1, 2, 3, 0], 2),
  chord('D7', 'dom7', [2, 2, 2, 3], [1, 2, 3, 4], 3),
  chord('Dm', 'minor', [2, 2, 1, 0], [2, 3, 1, 0], 2),
  chord('Dm7', 'min7', [2, 2, 1, 3], [2, 3, 1, 4], 3),
  chord('Dsus4', 'sus4', [2, 2, 3, 0], [1, 2, 3, 0], 2),
  chord('E', 'major', [1, 4, 0, 2], [1, 4, 0, 2], 3, [
    { frets: [4, 4, 4, 2], fingers: [3, 3, 3, 1], note: 'Barre shape at fret 4' },
  ]),
  chord('E7', 'dom7', [1, 2, 0, 2], [1, 3, 0, 2], 2),
  chord('Em', 'minor', [0, 4, 3, 2], [0, 3, 2, 1], 2),
  chord('F', 'major', [2, 0, 1, 0], [2, 0, 1, 0], 1),
  chord('F7', 'dom7', [2, 3, 1, 3], [2, 3, 1, 4], 3),
  chord('Fmaj7', 'maj7', [2, 4, 1, 3], [2, 4, 1, 3], 3),
  chord('G', 'major', [0, 2, 3, 2], [0, 1, 3, 2], 2),
  chord('G7', 'dom7', [0, 2, 1, 2], [0, 2, 1, 3], 2),
  chord('Gm', 'minor', [0, 2, 3, 1], [0, 2, 3, 1], 2),
  chord('A', 'major', [2, 1, 0, 0], [2, 1, 0, 0], 1),
  chord('A7', 'dom7', [0, 1, 0, 0], [0, 1, 0, 0], 1),
  chord('Am', 'minor', [2, 0, 0, 0], [2, 0, 0, 0], 1),
  chord('Am7', 'min7', [0, 0, 0, 0], [0, 0, 0, 0], 1),
  chord('Bb', 'major', [3, 2, 1, 1], [3, 2, 1, 1], 3),
  chord('Bm', 'minor', [4, 2, 2, 2], [3, 1, 1, 1], 3),
  chord('B7', 'dom7', [2, 3, 2, 2], [2, 3, 1, 1], 2),
];

const BY_ID = new Map(CHORDS.map((c) => [c.id, c]));

export function getChord(id: string): Chord | undefined {
  return BY_ID.get(id);
}

/** All chord ids, in library order. */
export const CHORD_IDS: readonly string[] = CHORDS.map((c) => c.id);

/** Pitch classes the chord's *formula* specifies (not the voicing). */
export function chordPitchClasses(chord: Chord): PitchClass[] {
  return QUALITIES[chord.quality].intervals.map((i) => mod12(chord.root + i));
}

/** Pitch classes the chord's default voicing actually sounds. */
export function voicedPitchClasses(chord: Chord): PitchClass[] {
  return voicingToPitchClasses(chord.frets);
}

/** Human-readable name of the chord's quality, e.g. "minor 7th". */
export function qualityLabel(chord: Chord): string {
  return QUALITIES[chord.quality].label;
}

/** Root name honouring flat spelling where the chord id uses one. */
export function rootName(chord: Chord): string {
  return pitchClassName(chord.root, chord.id.includes('b'));
}

/** Highest fretted fret in a voicing (0 when fully open). */
export function maxFret(frets: FretArray): number {
  return frets.reduce<number>((max, f) => (f === null ? max : Math.max(max, f)), 0);
}

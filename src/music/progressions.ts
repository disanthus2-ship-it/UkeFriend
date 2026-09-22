import { mod12, pitchClassName, type PitchClass } from './notes';
import { CHORDS, getChord, type Chord, type Quality } from './chords';

export type Mode = 'major' | 'minor';

export interface Key {
  readonly tonic: PitchClass;
  readonly mode: Mode;
}

export interface Degree {
  /** 0-based scale degree: 0 = I/i, 4 = V/v. */
  readonly index: number;
  readonly pitchClass: PitchClass;
  /** Chord qualities that count as diatonic at this degree. */
  readonly qualities: readonly Quality[];
  readonly roman: string;
}

/**
 * Diatonic degrees of a key.
 *
 * Minor is deliberately a blend of natural and harmonic minor: real songs in a
 * minor key almost always borrow the major V (or V7) for its pull back to the
 * tonic, so treating only the natural-minor v as in-key would reject ordinary
 * progressions like Am - Dm - E7 - Am.
 */
export function degreesOf(key: Key): Degree[] {
  const spec: { offset: number; qualities: Quality[]; roman: string }[] =
    key.mode === 'major'
      ? [
          { offset: 0, qualities: ['major', 'maj7', 'sus4', 'sus2'], roman: 'I' },
          { offset: 2, qualities: ['minor', 'min7'], roman: 'ii' },
          { offset: 4, qualities: ['minor', 'min7'], roman: 'iii' },
          { offset: 5, qualities: ['major', 'maj7', 'sus4'], roman: 'IV' },
          { offset: 7, qualities: ['major', 'dom7', 'sus4'], roman: 'V' },
          { offset: 9, qualities: ['minor', 'min7'], roman: 'vi' },
          { offset: 11, qualities: ['dim'], roman: 'vii°' },
        ]
      : [
          { offset: 0, qualities: ['minor', 'min7'], roman: 'i' },
          { offset: 2, qualities: ['dim'], roman: 'ii°' },
          { offset: 3, qualities: ['major', 'maj7'], roman: 'III' },
          { offset: 5, qualities: ['minor', 'min7'], roman: 'iv' },
          { offset: 7, qualities: ['minor', 'min7', 'major', 'dom7'], roman: 'V' },
          { offset: 8, qualities: ['major', 'maj7'], roman: 'VI' },
          { offset: 10, qualities: ['major', 'dom7'], roman: 'VII' },
        ];

  return spec.map((s, index) => ({
    index,
    pitchClass: mod12(key.tonic + s.offset),
    qualities: s.qualities,
    roman: s.roman,
  }));
}

/** The degree a chord occupies in a key, or null if it is not diatonic there. */
export function degreeOfChord(chord: Chord, key: Key): Degree | null {
  for (const degree of degreesOf(key)) {
    if (degree.pitchClass === chord.root && degree.qualities.includes(chord.quality)) {
      return degree;
    }
  }
  return null;
}

/** Display name of a key, e.g. "C major" or "A minor". */
export function keyName(key: Key): string {
  const flatKeys = [10, 3, 8, 1, 5]; // Bb Eb Ab Db F read better as flats
  return `${pitchClassName(key.tonic, flatKeys.includes(key.tonic))} ${key.mode}`;
}

export function keyId(key: Key): string {
  return `${key.tonic}:${key.mode}`;
}

/**
 * Degrees weighted by how strongly they pin down a key. Hearing the tonic or the
 * dominant tells you far more than hearing the mediant, so a key that explains
 * those wins ties against one that only explains colour chords.
 */
const DEGREE_WEIGHT = [1.6, 1.1, 0.9, 1.25, 1.4, 1.1, 0.8];

/** Ukulele-friendly keys, used only to break otherwise-equal scores. */
const FRIENDLY_TONICS = new Set<PitchClass>([0, 5, 7, 2, 9, 4]); // C F G D A E

export interface KeyCandidate {
  readonly key: Key;
  /** 0..1, share of the weighted maximum this key explains. */
  readonly confidence: number;
  /** Chord ids from the input that are diatonic in this key. */
  readonly matched: readonly string[];
  /** Chord ids from the input that are not. */
  readonly outside: readonly string[];
}

/**
 * Rank all 24 keys by how well they explain a set of chords.
 *
 * Returns every key that explains at least one chord, best first. Callers
 * generally want the first two or three — a short chord set is genuinely
 * ambiguous (C-F-G fits C major, and C-Am-F-G fits both C major and A minor),
 * and presenting one answer would overstate what the input supports.
 */
export function inferKeys(chordIds: readonly string[]): KeyCandidate[] {
  const chords = chordIds.map(getChord).filter((c): c is Chord => c !== undefined);
  if (chords.length === 0) return [];

  const candidates: KeyCandidate[] = [];

  for (let tonic = 0; tonic < 12; tonic++) {
    for (const mode of ['major', 'minor'] as const) {
      const key: Key = { tonic, mode };
      let score = 0;
      const matched: string[] = [];
      const outside: string[] = [];

      for (const chord of chords) {
        const degree = degreeOfChord(chord, key);
        if (degree) {
          score += DEGREE_WEIGHT[degree.index];
          matched.push(chord.id);
        } else {
          // An out-of-key chord is real evidence against the key, not just a
          // missing point — otherwise keys with more accidentals always tie.
          score -= 0.8;
          outside.push(chord.id);
        }
      }

      if (matched.length === 0) continue;
      if (FRIENDLY_TONICS.has(tonic)) score += 0.05; // tie-break only

      const maxPossible = chords.length * Math.max(...DEGREE_WEIGHT);
      // Scale by how much evidence there is. One chord cannot determine a key —
      // a lone C sits in C major, F major, G major and several minors — so
      // reporting it as a 100% match would be a confident-looking lie.
      const evidence = Math.min(1, 0.5 + chords.length * 0.17);
      candidates.push({
        key,
        confidence: Math.max(0, Math.min(1, (score / maxPossible) * evidence)),
        matched,
        outside,
      });
    }
  }

  return candidates.sort((a, b) => b.confidence - a.confidence);
}

/** The easiest library voicing of an exact root+quality, ignoring any key. */
export function findChord(pitchClass: PitchClass, quality: Quality): Chord | undefined {
  return CHORDS.filter((c) => c.root === pitchClass && c.quality === quality).sort(
    (a, b) => a.difficulty - b.difficulty,
  )[0];
}

/**
 * Pick the library chord that best realises a degree: prefer the plainest
 * quality (a triad over a seventh) and the easiest shape.
 */
export function chordForDegree(degree: Degree, preferQuality?: Quality): Chord | undefined {
  const matches = CHORDS.filter(
    (c) => c.root === degree.pitchClass && degree.qualities.includes(c.quality),
  );
  if (matches.length === 0) return undefined;

  if (preferQuality) {
    const exact = matches.find((c) => c.quality === preferQuality);
    if (exact) return exact;
  }

  const plainness: Record<string, number> = {
    major: 0, minor: 0, dom7: 1, min7: 1, maj7: 2, sus4: 3, sus2: 3, dim: 3,
  };
  return matches.sort(
    (a, b) => plainness[a.quality] - plainness[b.quality] || a.difficulty - b.difficulty,
  )[0];
}

interface ProgressionTemplate {
  readonly name: string;
  readonly description: string;
  readonly mode: Mode;
  /** Scale degrees, 0-based. */
  readonly degrees: readonly number[];
  /**
   * Voice these degrees as a specific quality, even a non-diatonic one. The
   * 12-bar blues needs this: its I7 and IV7 are dominant sevenths that do not
   * belong to the major scale at all, and looking them up through the key's
   * diatonic qualities could never find them.
   */
  readonly voiceAs?: Readonly<Record<number, Quality>>;
}

const TEMPLATES: readonly ProgressionTemplate[] = [
  {
    name: 'I–V–vi–IV',
    description: 'The four-chord pop progression. Hundreds of songs, one shape.',
    mode: 'major',
    degrees: [0, 4, 5, 3],
  },
  {
    name: 'I–vi–IV–V',
    description: "Doo-wop. Think 'Stand By Me'.",
    mode: 'major',
    degrees: [0, 5, 3, 4],
  },
  {
    name: 'I–IV–V',
    description: 'The three-chord trick behind most folk and early rock.',
    mode: 'major',
    degrees: [0, 3, 4],
  },
  {
    name: 'ii–V–I',
    description: 'The jazz turnaround. Strongest resolution in tonal music.',
    mode: 'major',
    degrees: [1, 4, 0],
    voiceAs: { 1: 'min7', 4: 'dom7' },
  },
  {
    name: 'vi–IV–I–V',
    description: 'Same four chords as the pop loop, started on the minor.',
    mode: 'major',
    degrees: [5, 3, 0, 4],
  },
  {
    name: 'I–iii–IV–V',
    description: 'A gentler climb; the iii softens the step to IV.',
    mode: 'major',
    degrees: [0, 2, 3, 4],
  },
  {
    name: '12-bar blues',
    description: 'I–I–I–I–IV–IV–I–I–V–IV–I–V, all sevenths.',
    mode: 'major',
    degrees: [0, 0, 0, 0, 3, 3, 0, 0, 4, 3, 0, 4],
    voiceAs: { 0: 'dom7', 3: 'dom7', 4: 'dom7' },
  },
  {
    name: 'i–VII–VI–V',
    description: 'The Andalusian cadence — a descending minor walk.',
    mode: 'minor',
    degrees: [0, 6, 5, 4],
    voiceAs: { 4: 'dom7' },
  },
  {
    name: 'i–iv–V–i',
    description: 'Minor with a borrowed major V for a strong pull home.',
    mode: 'minor',
    degrees: [0, 3, 4, 0],
    voiceAs: { 4: 'dom7' },
  },
  {
    name: 'i–VI–III–VII',
    description: 'Bright minor loop; lifts without ever resolving.',
    mode: 'minor',
    degrees: [0, 5, 2, 6],
  },
];

export interface Progression {
  readonly name: string;
  readonly description: string;
  readonly key: Key;
  readonly chords: readonly Chord[];
  readonly romans: readonly string[];
  /** How many of the user's selected chords this progression uses. */
  readonly usesSelected: number;
  /** Mean difficulty of the chords involved, 1 (easy) to 3. */
  readonly difficulty: number;
}

/**
 * Progressions playable in `key` using only chords the library can voice.
 * Ranked by how much of the user's own selection they reuse, then by how easy
 * the shapes are.
 */
export function suggestProgressions(
  key: Key,
  selected: readonly string[] = [],
): Progression[] {
  const degrees = degreesOf(key);
  const selectedSet = new Set(selected);
  const out: Progression[] = [];

  for (const template of TEMPLATES) {
    if (template.mode !== key.mode) continue;

    const chords: Chord[] = [];
    const romans: string[] = [];
    let renderable = true;

    for (const degreeIndex of template.degrees) {
      const degree = degrees[degreeIndex];
      const forced = template.voiceAs?.[degreeIndex];
      // A forced quality may be outside the key, so look it up directly and
      // only fall back to the diatonic choice if the library cannot voice it.
      const chord =
        (forced ? findChord(degree.pitchClass, forced) : undefined) ?? chordForDegree(degree);
      if (!chord) {
        renderable = false;
        break;
      }
      chords.push(chord);
      romans.push(degree.roman);
    }
    if (!renderable) continue;

    const distinct = [...new Set(chords.map((c) => c.id))];
    out.push({
      name: template.name,
      description: template.description,
      key,
      chords,
      romans,
      usesSelected: distinct.filter((id) => selectedSet.has(id)).length,
      difficulty: distinct.reduce((s, id) => s + (getChord(id)?.difficulty ?? 2), 0) / distinct.length,
    });
  }

  return out.sort(
    (a, b) => b.usesSelected - a.usesSelected || a.difficulty - b.difficulty,
  );
}

/** Where each degree most often goes next, in descending order of likelihood. */
const NEXT_DEGREES: Record<number, { to: number; reason: string }[]> = {
  0: [
    { to: 4, reason: 'tonic to dominant — sets up the strongest return home' },
    { to: 3, reason: 'tonic to subdominant — the plainest move in the key' },
    { to: 5, reason: 'to the relative minor for a darker turn' },
    { to: 1, reason: 'starts a ii–V–I turnaround' },
  ],
  1: [
    { to: 4, reason: 'ii to V — half of the strongest cadence there is' },
    { to: 0, reason: 'falls straight back to the tonic' },
  ],
  2: [
    { to: 5, reason: 'iii to vi keeps the descent going' },
    { to: 3, reason: 'steps up to the subdominant' },
  ],
  3: [
    { to: 0, reason: 'plagal cadence — the "amen" ending' },
    { to: 4, reason: 'builds tension before resolving' },
    { to: 1, reason: 'sidesteps into a turnaround' },
  ],
  4: [
    { to: 0, reason: 'perfect cadence — the dominant resolves home' },
    { to: 5, reason: 'deceptive cadence — lands on the minor instead' },
  ],
  5: [
    { to: 3, reason: 'the pop loop continues' },
    { to: 1, reason: 'sets up a turnaround' },
    { to: 4, reason: 'pushes toward the dominant' },
  ],
  6: [{ to: 0, reason: 'the leading tone pulls up to the tonic' }],
};

export interface NextChordSuggestion {
  readonly chord: Chord;
  readonly roman: string;
  readonly reason: string;
}

/** Chords that commonly follow `chordId` within `key`. */
export function suggestNextChords(chordId: string, key: Key): NextChordSuggestion[] {
  const chord = getChord(chordId);
  if (!chord) return [];
  const current = degreeOfChord(chord, key);
  if (!current) return [];

  const degrees = degreesOf(key);
  const out: NextChordSuggestion[] = [];

  for (const { to, reason } of NEXT_DEGREES[current.index] ?? []) {
    const degree = degrees[to];
    const next = chordForDegree(degree);
    if (next) out.push({ chord: next, roman: degree.roman, reason });
  }
  return out;
}

/** Every library chord that is diatonic in a key, in degree order. */
export function diatonicChordsIn(key: Key): { degree: Degree; chords: Chord[] }[] {
  return degreesOf(key).map((degree) => ({
    degree,
    chords: CHORDS.filter(
      (c) => c.root === degree.pitchClass && degree.qualities.includes(c.quality),
    ),
  }));
}

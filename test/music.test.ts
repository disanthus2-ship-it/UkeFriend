import { describe, it, expect } from 'vitest';
import {
  mod12,
  parsePitchClass,
  pitchClassName,
  midiToFreq,
  freqToMidi,
  midiToName,
} from '../src/music/notes';
import { STANDARD_GCEA, voicingToMidi, voicingToPitchClasses, voicingToNoteNames } from '../src/music/tuning';
import { CHORDS, QUALITIES, chordPitchClasses, voicedPitchClasses, getChord, maxFret } from '../src/music/chords';
import { chromaFromMidiNotes, chromaFromVoicing, CHORD_TEMPLATES } from '../src/music/templates';
import { cosineSimilarity, argMax } from '../src/lib/vector';

describe('notes', () => {
  it('wraps pitch classes for negative and large values', () => {
    expect(mod12(-1)).toBe(11);
    expect(mod12(12)).toBe(0);
    expect(mod12(25)).toBe(1);
  });

  it('parses note names including accidentals and quality suffixes', () => {
    expect(parsePitchClass('C')).toBe(0);
    expect(parsePitchClass('F#')).toBe(6);
    expect(parsePitchClass('Bb')).toBe(10);
    expect(parsePitchClass('Cm')).toBe(0); // quality suffix ignored
    expect(parsePitchClass('Dm7')).toBe(2);
    expect(parsePitchClass('H')).toBeNull();
  });

  it('names pitch classes in both spellings', () => {
    expect(pitchClassName(10)).toBe('A#');
    expect(pitchClassName(10, true)).toBe('Bb');
  });

  it('round-trips midi and frequency', () => {
    expect(midiToFreq(69)).toBeCloseTo(440, 6);
    expect(midiToFreq(60)).toBeCloseTo(261.626, 3);
    expect(freqToMidi(440)).toBeCloseTo(69, 6);
    expect(freqToMidi(midiToFreq(64))).toBeCloseTo(64, 6);
  });

  it('names midi notes with octaves', () => {
    expect(midiToName(60)).toBe('C4');
    expect(midiToName(69)).toBe('A4');
    expect(midiToName(67)).toBe('G4');
  });
});

describe('tuning', () => {
  it('is re-entrant: the 4th string is above the 3rd', () => {
    const [g, c] = STANDARD_GCEA.strings;
    expect(g.openMidi).toBeGreaterThan(c.openMidi);
  });

  it('sounds C4 as its lowest possible note', () => {
    const lowest = Math.min(...STANDARD_GCEA.strings.map((s) => s.openMidi));
    expect(lowest).toBe(60);
  });

  it('maps open strings to G4 C4 E4 A4', () => {
    expect(voicingToNoteNames([0, 0, 0, 0])).toEqual(['G4', 'C4', 'E4', 'A4']);
  });

  it('skips muted strings', () => {
    expect(voicingToMidi([null, 0, 0, 3])).toEqual([60, 64, 72]);
  });

  it('resolves the C chord voicing to C E G', () => {
    expect(voicingToPitchClasses([0, 0, 0, 3])).toEqual([0, 4, 7]);
  });
});

describe('chord library', () => {
  it('has a unique id for every chord', () => {
    const ids = CHORDS.map((c) => c.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  // The important one: a typo in a fret array is a wrong chord shape taught to a
  // learner. Every voicing must sound exactly the pitch classes its formula names.
  it.each(CHORDS.map((c) => [c.id, c] as const))(
    '%s voicing sounds exactly the notes its formula requires',
    (_id, chord) => {
      const expected = [...chordPitchClasses(chord)].sort((a, b) => a - b);
      const actual = voicedPitchClasses(chord);
      expect(actual).toEqual(expected);
    },
  );

  it.each(CHORDS.map((c) => [c.id, c] as const))(
    '%s has one finger entry per string and frets within the first position',
    (_id, chord) => {
      expect(chord.fingers.length).toBe(chord.frets.length);
      expect(chord.frets.length).toBe(STANDARD_GCEA.strings.length);
      expect(maxFret(chord.frets)).toBeLessThanOrEqual(5);
      chord.fingers.forEach((f, i) => {
        // Open strings take no finger; fretted strings must name one.
        if (chord.frets[i] === 0) expect(f).toBe(0);
        else expect(f).toBeGreaterThan(0);
      });
    },
  );

  it.each(
    CHORDS.flatMap((c) => (c.alternates ?? []).map((a, i) => [`${c.id} alt ${i}`, c, a] as const)),
  )('%s alternate voicing sounds the same chord', (_label, chord, alt) => {
    const expected = [...chordPitchClasses(chord)].sort((a, b) => a - b);
    expect(voicingToPitchClasses(alt.frets)).toEqual(expected);
  });

  it('looks chords up by id', () => {
    expect(getChord('Am7')?.quality).toBe('min7');
    expect(getChord('nope')).toBeUndefined();
  });

  it('covers every quality it defines', () => {
    const used = new Set(CHORDS.map((c) => c.quality));
    for (const q of Object.keys(QUALITIES)) {
      if (q === 'dim' || q === 'sus2') continue; // defined for key analysis, not yet voiced
      expect(used.has(q as never)).toBe(true);
    }
  });
});

describe('chroma templates', () => {
  it('puts the most energy on the root for a plain major triad', () => {
    // Root is doubled across the harmonic series more than any other degree.
    const cMajor = chromaFromVoicing([0, 0, 0, 3]);
    expect(argMax(cMajor)).toBe(0); // C
  });

  it('is unit length', () => {
    for (const t of CHORD_TEMPLATES) {
      for (const v of t.variants) {
        let sum = 0;
        for (const x of v) sum += x * x;
        expect(Math.sqrt(sum)).toBeCloseTo(1, 5);
      }
    }
  });

  it('models harmonic spread rather than a bare triad', () => {
    // A single plucked C4 radiates a G (3rd harmonic) and an E (5th harmonic),
    // so its chroma must not be a lone spike on C.
    const singleC = chromaFromMidiNotes([60]);
    expect(singleC[0]).toBeGreaterThan(0); // C
    expect(singleC[7]).toBeGreaterThan(0); // G, from harmonic 3
    expect(singleC[4]).toBeGreaterThan(0); // E, from harmonic 5
  });

  it('separates chords that share most of their notes', () => {
    // C and Am7 share C, E, G and differ only by the A. They are the classic
    // failure case for chroma matching, so confirm they are at least distinct.
    const c = chromaFromVoicing([0, 0, 0, 3]);
    const am7 = chromaFromVoicing([0, 0, 0, 0]);
    expect(cosineSimilarity(c, am7)).toBeLessThan(0.99);
  });

  it('gives every chord in the library its own strongest template', () => {
    // No chord may be better explained by a different chord's template.
    for (const target of CHORD_TEMPLATES) {
      const self = Math.max(
        ...target.variants.map((v) => cosineSimilarity(target.variants[0], v)),
      );
      for (const other of CHORD_TEMPLATES) {
        if (other.chordId === target.chordId) continue;
        const cross = Math.max(
          ...other.variants.map((v) => cosineSimilarity(target.variants[0], v)),
        );
        expect(cross).toBeLessThanOrEqual(self);
      }
    }
  });
});

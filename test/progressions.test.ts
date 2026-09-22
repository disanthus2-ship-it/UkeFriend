import { describe, it, expect } from 'vitest';
import {
  inferKeys,
  suggestProgressions,
  suggestNextChords,
  degreesOf,
  degreeOfChord,
  keyName,
  diatonicChordsIn,
  type Key,
} from '../src/music/progressions';
import { getChord } from '../src/music/chords';

const C_MAJOR: Key = { tonic: 0, mode: 'major' };
const A_MINOR: Key = { tonic: 9, mode: 'minor' };

describe('degrees', () => {
  it('builds the C major scale degrees', () => {
    const pcs = degreesOf(C_MAJOR).map((d) => d.pitchClass);
    expect(pcs).toEqual([0, 2, 4, 5, 7, 9, 11]); // C D E F G A B
  });

  it('accepts a major V in a minor key (harmonic minor)', () => {
    // Am - Dm - E7 - Am is ordinary; rejecting E7 would be wrong.
    const e7 = getChord('E7')!;
    expect(degreeOfChord(e7, A_MINOR)?.roman).toBe('V');
  });

  it('still accepts the natural-minor v', () => {
    const em = getChord('Em')!;
    expect(degreeOfChord(em, A_MINOR)?.roman).toBe('V');
  });

  it('rejects a chord outside the key', () => {
    expect(degreeOfChord(getChord('Bb')!, C_MAJOR)).toBeNull();
  });

  it('names keys readably', () => {
    expect(keyName(C_MAJOR)).toBe('C major');
    expect(keyName(A_MINOR)).toBe('A minor');
    expect(keyName({ tonic: 10, mode: 'major' })).toBe('Bb major');
  });
});

describe('key inference', () => {
  it('infers C major from C, F and G', () => {
    expect(keyName(inferKeys(['C', 'F', 'G'])[0].key)).toBe('C major');
  });

  it('infers A minor from Am, Dm and E7', () => {
    expect(keyName(inferKeys(['Am', 'Dm', 'E7'])[0].key)).toBe('A minor');
  });

  it('infers G major from G, C, D and Em', () => {
    expect(keyName(inferKeys(['G', 'C', 'D', 'Em'])[0].key)).toBe('G major');
  });

  it('infers F major from F, Bb and C7', () => {
    expect(keyName(inferKeys(['F', 'Bb', 'C7'])[0].key)).toBe('F major');
  });

  it('reports the genuine ambiguity of a relative major/minor pair', () => {
    // C-Am-F-G fits C major and A minor. Both should surface near the top
    // rather than the app pretending to be certain.
    const top = inferKeys(['C', 'Am', 'F', 'G']).slice(0, 2).map((c) => keyName(c.key));
    expect(top).toContain('C major');
    expect(top).toContain('A minor');
  });

  it('lists chords that fall outside the winning key', () => {
    const best = inferKeys(['C', 'F', 'G', 'Bb'])[0];
    expect(best.outside).toContain('Bb');
  });

  it('returns nothing for an empty or unknown selection', () => {
    expect(inferKeys([])).toEqual([]);
    expect(inferKeys(['Zz'])).toEqual([]);
  });

  it('gives confidence in 0..1', () => {
    for (const c of inferKeys(['C', 'Am', 'F', 'G'])) {
      expect(c.confidence).toBeGreaterThanOrEqual(0);
      expect(c.confidence).toBeLessThanOrEqual(1);
    }
  });
});

describe('progression suggestions', () => {
  it('offers the four-chord pop loop in C major as C G Am F', () => {
    const found = suggestProgressions(C_MAJOR).find((p) => p.name === 'I–V–vi–IV');
    expect(found?.chords.map((c) => c.id)).toEqual(['C', 'G', 'Am', 'F']);
  });

  it('offers ii-V-I in C major with sevenths', () => {
    const found = suggestProgressions(C_MAJOR).find((p) => p.name === 'ii–V–I');
    expect(found?.chords.map((c) => c.id)).toEqual(['Dm7', 'G7', 'C']);
  });

  it('offers only minor-mode progressions for a minor key', () => {
    for (const p of suggestProgressions(A_MINOR)) {
      expect(['i–VII–VI–V', 'i–iv–V–i', 'i–VI–III–VII']).toContain(p.name);
    }
  });

  it('ranks progressions that reuse the selected chords first', () => {
    const ranked = suggestProgressions(C_MAJOR, ['C', 'G', 'Am', 'F']);
    expect(ranked[0].name).toBe('I–V–vi–IV');
    expect(ranked[0].usesSelected).toBe(4);
  });

  it('only ever uses chords the library can actually voice', () => {
    for (const key of [C_MAJOR, A_MINOR, { tonic: 7, mode: 'major' } as Key]) {
      for (const p of suggestProgressions(key)) {
        for (const chord of p.chords) expect(getChord(chord.id)).toBeDefined();
      }
    }
  });

  it('renders the 12-bar blues as twelve bars of sevenths', () => {
    const blues = suggestProgressions(C_MAJOR).find((p) => p.name === '12-bar blues');
    expect(blues?.chords).toHaveLength(12);
    expect(blues?.chords[0].id).toBe('C7');
  });
});

describe('next-chord suggestions', () => {
  it('sends the dominant home to the tonic first', () => {
    const next = suggestNextChords('G', C_MAJOR);
    expect(next[0].chord.id).toBe('C');
    expect(next[0].reason).toMatch(/resolves home/);
  });

  it('suggests the dominant after the tonic', () => {
    expect(suggestNextChords('C', C_MAJOR).map((n) => n.chord.id)).toContain('G');
  });

  it('returns nothing for a chord outside the key', () => {
    expect(suggestNextChords('Bb', C_MAJOR)).toEqual([]);
  });

  it('returns nothing for an unknown chord', () => {
    expect(suggestNextChords('Zz', C_MAJOR)).toEqual([]);
  });

  it('labels every suggestion with a reason', () => {
    for (const n of suggestNextChords('Am', C_MAJOR)) {
      expect(n.reason.length).toBeGreaterThan(5);
    }
  });
});

describe('diatonic chord listing', () => {
  it('lists C major triads on I, IV and V', () => {
    const byRoman = new Map(diatonicChordsIn(C_MAJOR).map((d) => [d.degree.roman, d.chords]));
    expect(byRoman.get('I')!.map((c) => c.id)).toContain('C');
    expect(byRoman.get('IV')!.map((c) => c.id)).toContain('F');
    expect(byRoman.get('V')!.map((c) => c.id)).toContain('G');
  });
});

describe('confidence reflects how much evidence there is', () => {
  it('does not claim certainty from a single chord', () => {
    // A lone C sits in C major, F major, G major and several minor keys.
    const single = inferKeys(['C'])[0];
    expect(single.confidence).toBeLessThan(0.75);
  });

  it('grows as more chords narrow the key down', () => {
    const one = inferKeys(['C'])[0].confidence;
    const three = inferKeys(['C', 'F', 'G'])[0].confidence;
    expect(three).toBeGreaterThan(one);
  });

  it('still ranks the right key first regardless of scaling', () => {
    expect(keyName(inferKeys(['C'])[0].key)).toBe('C major');
  });
})

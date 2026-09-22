import { STANDARD_GCEA, voicingToNoteNames } from '../music/tuning';
import { maxFret, type Chord } from '../music/chords';

interface Props {
  chord: Chord;
  /** Use an alternate voicing instead of the default. */
  variant?: number;
  showNoteNames?: boolean;
  size?: number;
}

const FRET_COUNT = 5;

interface Barre {
  fret: number;
  finger: number;
  from: number;
  to: number;
}

/**
 * Find fingers that hold down several strings at one fret, so they can be drawn
 * as a bar rather than as separate dots. Without this a B7 looks like four
 * unrelated fingertips instead of one index finger laid across two strings.
 */
function findBarres(frets: readonly (number | null)[], fingers: readonly number[]): Barre[] {
  const groups = new Map<string, number[]>();
  frets.forEach((fret, i) => {
    const finger = fingers[i];
    if (fret === null || fret === 0 || !finger) return;
    const key = `${fret}:${finger}`;
    groups.set(key, [...(groups.get(key) ?? []), i]);
  });

  const barres: Barre[] = [];
  for (const [key, strings] of groups) {
    if (strings.length < 2) continue;
    const [fret, finger] = key.split(':').map(Number);
    barres.push({ fret, finger, from: Math.min(...strings), to: Math.max(...strings) });
  }
  return barres;
}

export function ChordDiagram({ chord, variant, showNoteNames = false, size = 1 }: Props) {
  const voicing =
    variant !== undefined && chord.alternates?.[variant]
      ? chord.alternates[variant]
      : { frets: chord.frets, fingers: chord.fingers };

  const { frets, fingers } = voicing;
  const strings = STANDARD_GCEA.strings;
  const stringCount = strings.length;
  const noteNames = voicingToNoteNames(frets, STANDARD_GCEA, chord.id.includes('b'));

  const width = 168 * size;
  const padX = 26 * size;
  const topPad = 34 * size;
  const bottomPad = (showNoteNames ? 40 : 18) * size;
  const gridHeight = 130 * size;
  const height = topPad + gridHeight + bottomPad;

  const stringGap = (width - padX * 2) / (stringCount - 1);
  const fretGap = gridHeight / FRET_COUNT;
  const dotRadius = 10 * size;

  const x = (stringIndex: number) => padX + stringIndex * stringGap;
  const fretY = (fret: number) => topPad + (fret - 0.5) * fretGap;

  const highest = maxFret(frets);
  // Every chord in the library fits the first position, but keep the diagram
  // honest if a higher voicing is ever added.
  const baseFret = highest > FRET_COUNT ? highest - FRET_COUNT + 1 : 1;
  const atNut = baseFret === 1;
  const barres = findBarres(frets, fingers);

  const label = `${chord.id}: ${frets
    .map((f, i) => `${strings[i].label} string ${f === null ? 'muted' : f === 0 ? 'open' : `fret ${f}`}`)
    .join(', ')}`;

  return (
    <svg
      width={width}
      height={height}
      viewBox={`0 0 ${width} ${height}`}
      role="img"
      aria-label={label}
      style={{ overflow: 'visible' }}
    >
      {/* Nut, or the fret number when the shape sits higher up the neck. */}
      {atNut ? (
        <rect
          x={padX - 2}
          y={topPad - 5 * size}
          width={width - padX * 2 + 4}
          height={5 * size}
          rx={1.5}
          fill="var(--text)"
        />
      ) : (
        <text
          x={padX - 10 * size}
          y={topPad + fretGap * 0.6}
          textAnchor="end"
          fontSize={11 * size}
          fill="var(--muted)"
        >
          {baseFret}fr
        </text>
      )}

      {/* Frets */}
      {Array.from({ length: FRET_COUNT }, (_, i) => (
        <line
          key={`fret-${i}`}
          x1={padX}
          x2={width - padX}
          y1={topPad + (i + 1) * fretGap}
          y2={topPad + (i + 1) * fretGap}
          stroke="var(--border)"
          strokeWidth={1.5}
        />
      ))}

      {/* Strings */}
      {strings.map((_, i) => (
        <line
          key={`string-${i}`}
          x1={x(i)}
          x2={x(i)}
          y1={topPad}
          y2={topPad + gridHeight}
          stroke="var(--border)"
          strokeWidth={1.5}
        />
      ))}

      {/* Open and muted markers above the nut */}
      {frets.map((fret, i) =>
        fret === null ? (
          <g key={`mark-${i}`} stroke="var(--muted-dim)" strokeWidth={2} strokeLinecap="round">
            <line x1={x(i) - 5} y1={topPad - 18 * size} x2={x(i) + 5} y2={topPad - 8 * size} />
            <line x1={x(i) - 5} y1={topPad - 8 * size} x2={x(i) + 5} y2={topPad - 18 * size} />
          </g>
        ) : fret === 0 ? (
          <circle
            key={`mark-${i}`}
            cx={x(i)}
            cy={topPad - 13 * size}
            r={5 * size}
            fill="none"
            stroke="var(--muted)"
            strokeWidth={1.8}
          />
        ) : null,
      )}

      {/* Barres, drawn under the finger dots */}
      {barres.map((barre) => (
        <rect
          key={`barre-${barre.fret}-${barre.finger}`}
          x={x(barre.from) - dotRadius}
          y={fretY(barre.fret - baseFret + 1) - dotRadius}
          width={x(barre.to) - x(barre.from) + dotRadius * 2}
          height={dotRadius * 2}
          rx={dotRadius}
          fill="var(--accent)"
        />
      ))}

      {/* Fingered notes */}
      {frets.map((fret, i) => {
        if (fret === null || fret === 0) return null;
        const cy = fretY(fret - baseFret + 1);
        return (
          <g key={`dot-${i}`}>
            <circle cx={x(i)} cy={cy} r={dotRadius} fill="var(--accent)" />
            {fingers[i] > 0 && (
              <text
                x={x(i)}
                y={cy + 4 * size}
                textAnchor="middle"
                fontSize={12 * size}
                fontWeight={700}
                fill="var(--accent-ink)"
              >
                {fingers[i]}
              </text>
            )}
          </g>
        );
      })}

      {/* String labels, and the sounding note of each string when asked for */}
      {strings.map((string, i) => (
        <text
          key={`label-${i}`}
          x={x(i)}
          y={topPad + gridHeight + 15 * size}
          textAnchor="middle"
          fontSize={11 * size}
          fill="var(--muted-dim)"
        >
          {string.label}
        </text>
      ))}
      {showNoteNames &&
        frets.map((fret, i) => {
          if (fret === null) return null;
          // Muted strings shift the note list, so index by sounded strings only.
          const soundedBefore = frets.slice(0, i).filter((f) => f !== null).length;
          return (
            <text
              key={`note-${i}`}
              x={x(i)}
              y={topPad + gridHeight + 31 * size}
              textAnchor="middle"
              fontSize={11 * size}
              fontWeight={600}
              fill="var(--teal)"
            >
              {noteNames[soundedBefore]}
            </text>
          );
        })}
    </svg>
  );
}

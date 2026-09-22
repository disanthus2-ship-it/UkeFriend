import { STANDARD_GCEA, voicingToNoteNames } from '../music/tuning';
import type { Chord } from '../music/chords';

interface Props {
  chord: Chord;
  variant?: number;
  showNoteNames?: boolean;
  size?: number;
}

/**
 * Four-line tablature for a single chord.
 *
 * Tab is written with the highest-pitched string on the top line, so the
 * display order is the reverse of the G-C-E-A fret array. Because standard
 * ukulele tuning is re-entrant the G string is *not* the lowest note, but tab
 * convention still puts it on the bottom line — it is a diagram of the
 * instrument, not of pitch.
 */
export function TabView({ chord, variant, showNoteNames = false, size = 1 }: Props) {
  const voicing =
    variant !== undefined && chord.alternates?.[variant]
      ? chord.alternates[variant]
      : { frets: chord.frets, fingers: chord.fingers };

  const { frets } = voicing;
  const strings = STANDARD_GCEA.strings;
  const noteNames = voicingToNoteNames(frets, STANDARD_GCEA, chord.id.includes('b'));

  const lineCount = strings.length;
  const lineGap = 22 * size;
  const padTop = 16 * size;
  const padLeft = 22 * size;
  const width = (showNoteNames ? 184 : 144) * size;
  const height = padTop * 2 + lineGap * (lineCount - 1);

  const strumX = padLeft + 36 * size;
  const noteX = strumX + 46 * size;

  // Display order: string index 3 (A) on top, index 0 (G) on the bottom.
  const displayOrder = [...strings.keys()].reverse();

  const spoken = displayOrder
    .map((i) => `${strings[i].label} ${frets[i] === null ? 'muted' : frets[i]}`)
    .join(', ');

  return (
    <svg
      width={width}
      height={height}
      viewBox={`0 0 ${width} ${height}`}
      role="img"
      aria-label={`${chord.id} tab, top to bottom: ${spoken}`}
    >
      {displayOrder.map((stringIndex, row) => {
        const y = padTop + row * lineGap;
        const fret = frets[stringIndex];
        const soundedBefore = frets.slice(0, stringIndex).filter((f) => f !== null).length;
        return (
          <g key={stringIndex}>
            <line x1={padLeft} x2={width - 8} y1={y} y2={y} stroke="var(--border)" strokeWidth={1.5} />
            <text
              x={padLeft - 6 * size}
              y={y + 4 * size}
              textAnchor="end"
              fontSize={11 * size}
              fill="var(--muted-dim)"
            >
              {strings[stringIndex].label}
            </text>

            {/* A small notch of background behind each number keeps the line
                from striking through it. */}
            <rect
              x={strumX - 9 * size}
              y={y - 9 * size}
              width={18 * size}
              height={18 * size}
              fill="var(--surface)"
            />
            <text
              x={strumX}
              y={y + 5 * size}
              textAnchor="middle"
              fontSize={14 * size}
              fontWeight={650}
              fill={fret === null ? 'var(--muted-dim)' : 'var(--accent)'}
              fontFamily="ui-monospace, SFMono-Regular, Menlo, monospace"
            >
              {fret === null ? 'x' : fret}
            </text>

            {showNoteNames && fret !== null && (
              <text
                x={noteX}
                y={y + 5 * size}
                textAnchor="middle"
                fontSize={12 * size}
                fontWeight={600}
                fill="var(--teal)"
              >
                {noteNames[soundedBefore]}
              </text>
            )}
          </g>
        );
      })}
    </svg>
  );
}

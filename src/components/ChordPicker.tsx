import { CHORDS, qualityLabel } from '../music/chords';
import { useAppStore } from '../state/store';

const PRESETS: { label: string; chords: string[] }[] = [
  { label: 'First four', chords: ['C', 'F', 'G', 'Am'] },
  { label: 'Key of C', chords: ['C', 'Dm', 'Em', 'F', 'G', 'Am'] },
  { label: 'Key of G', chords: ['G', 'Am', 'Bm', 'C', 'D', 'Em'] },
  { label: 'Sevenths', chords: ['C7', 'D7', 'E7', 'G7', 'A7', 'B7'] },
  { label: 'Everything', chords: CHORDS.map((c) => c.id) },
];

export function ChordPicker() {
  const selected = useAppStore((s) => s.selected);
  const focused = useAppStore((s) => s.focused);
  const toggleSelected = useAppStore((s) => s.toggleSelected);
  const setSelection = useAppStore((s) => s.setSelection);
  const focus = useAppStore((s) => s.focus);

  return (
    <section className="panel">
      <h2>Chords</h2>
      <p className="hint">
        Tap to add a chord to your practice set. Tap its name again to remove it.
      </p>

      <div className="row" style={{ marginBottom: 14 }}>
        {PRESETS.map((preset) => (
          <button
            key={preset.label}
            className="ghost"
            style={{ minHeight: 36, padding: '6px 12px', fontSize: '0.85rem' }}
            onClick={() => setSelection(preset.chords)}
          >
            {preset.label}
          </button>
        ))}
        <button
          className="ghost"
          style={{ minHeight: 36, padding: '6px 12px', fontSize: '0.85rem' }}
          onClick={() => setSelection([])}
        >
          Clear
        </button>
      </div>

      <div className="chord-grid">
        {CHORDS.map((chord) => {
          const isSelected = selected.includes(chord.id);
          return (
            <button
              key={chord.id}
              className={`chord-chip${chord.id === focused ? ' focused' : ''}`}
              aria-pressed={isSelected}
              title={`${chord.id} — ${qualityLabel(chord)}`}
              onClick={() => {
                focus(chord.id);
                toggleSelected(chord.id);
              }}
            >
              <span className="id">{chord.id}</span>
              <span className="sub">{'•'.repeat(chord.difficulty)}</span>
            </button>
          );
        })}
      </div>
      <p className="hint" style={{ marginTop: 12, marginBottom: 0 }}>
        {selected.length} selected · dots show how tricky the shape is
      </p>
    </section>
  );
}

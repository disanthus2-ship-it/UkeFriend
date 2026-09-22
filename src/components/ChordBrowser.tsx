import { getChord, qualityLabel, rootName, CHORDS } from '../music/chords';
import { voicingToNoteNames } from '../music/tuning';
import { useAppStore } from '../state/store';
import { ChordDiagram } from './ChordDiagram';
import { TabView } from './TabView';

export function ChordBrowser() {
  const focused = useAppStore((s) => s.focused);
  const showNoteNames = useAppStore((s) => s.showNoteNames);
  const setShowNoteNames = useAppStore((s) => s.setShowNoteNames);
  const selected = useAppStore((s) => s.selected);
  const toggleSelected = useAppStore((s) => s.toggleSelected);
  const focus = useAppStore((s) => s.focus);

  const chord = getChord(focused) ?? CHORDS[0];
  const isSelected = selected.includes(chord.id);
  const notes = voicingToNoteNames(chord.frets, undefined, chord.id.includes('b'));
  const index = CHORDS.findIndex((c) => c.id === chord.id);

  const step = (delta: number) => {
    const next = CHORDS[(index + delta + CHORDS.length) % CHORDS.length];
    focus(next.id);
  };

  return (
    <section className="panel">
      <div className="row" style={{ justifyContent: 'space-between', marginBottom: 10 }}>
        <h2 style={{ margin: 0 }}>Chord</h2>
        <label className="toggle">
          <input
            type="checkbox"
            checked={showNoteNames}
            onChange={(e) => setShowNoteNames(e.target.checked)}
          />
          Show notes
        </label>
      </div>

      <div className="chord-views">
        <div className="chord-card">
          <div className="chord-name">{chord.id}</div>
          <div className="chord-quality">
            {rootName(chord)} {qualityLabel(chord)}
          </div>
          <ChordDiagram chord={chord} showNoteNames={showNoteNames} size={1.15} />
        </div>

        <div className="chord-card">
          <TabView chord={chord} showNoteNames={showNoteNames} size={1.15} />
          <div className="chord-quality" style={{ marginTop: 6 }}>
            sounds {notes.join(' · ')}
          </div>
        </div>
      </div>

      {chord.alternates?.length ? (
        <div style={{ marginTop: 18 }}>
          <h2>Another way to play it</h2>
          <div className="chord-views" style={{ justifyContent: 'flex-start' }}>
            {chord.alternates.map((alt, i) => (
              <div className="chord-card" key={i}>
                <ChordDiagram
                  chord={chord}
                  variant={i}
                  showNoteNames={showNoteNames}
                  size={0.82}
                />
                <div className="chord-quality">{alt.note}</div>
              </div>
            ))}
          </div>
        </div>
      ) : null}

      <div className="row" style={{ marginTop: 18, justifyContent: 'center' }}>
        <button className="ghost" onClick={() => step(-1)} aria-label="Previous chord">
          ←
        </button>
        <button
          className={isSelected ? 'ghost' : 'primary'}
          onClick={() => toggleSelected(chord.id)}
        >
          {isSelected ? 'Remove from practice set' : 'Add to practice set'}
        </button>
        <button className="ghost" onClick={() => step(1)} aria-label="Next chord">
          →
        </button>
      </div>
    </section>
  );
}

import { useMemo } from 'react';
import {
  inferKeys,
  keyId,
  keyName,
  suggestNextChords,
  suggestProgressions,
  type Key,
} from '../music/progressions';
import { useAppStore } from '../state/store';

/** Turn a stored key id back into a Key, or null if it no longer parses. */
function parseKeyId(id: string | null): Key | null {
  if (!id) return null;
  const [tonic, mode] = id.split(':');
  const pc = Number(tonic);
  if (!Number.isInteger(pc) || (mode !== 'major' && mode !== 'minor')) return null;
  return { tonic: pc, mode };
}

export function Suggestions() {
  const selected = useAppStore((s) => s.selected);
  const focused = useAppStore((s) => s.focused);
  const pinnedKeyId = useAppStore((s) => s.pinnedKeyId);
  const pinKey = useAppStore((s) => s.pinKey);
  const setSelection = useAppStore((s) => s.setSelection);
  const focus = useAppStore((s) => s.focus);

  const candidates = useMemo(() => inferKeys(selected).slice(0, 4), [selected]);
  const activeKey = parseKeyId(pinnedKeyId) ?? candidates[0]?.key ?? null;
  const progressions = useMemo(
    () => (activeKey ? suggestProgressions(activeKey, selected).slice(0, 4) : []),
    [activeKey, selected],
  );
  const nextChords = useMemo(
    () => (activeKey ? suggestNextChords(focused, activeKey) : []),
    [focused, activeKey],
  );

  if (selected.length === 0) {
    return (
      <section className="panel">
        <h2>Harmony</h2>
        <p className="hint" style={{ marginBottom: 0 }}>
          Pick a few chords and this will work out what key they are in, then suggest
          progressions that fit.
        </p>
      </section>
    );
  }

  return (
    <section className="panel stack">
      <div>
        <h2>Key</h2>
        <p className="hint">
          {candidates.length > 1
            ? 'A short chord set can fit more than one key. Pick the one you mean.'
            : 'The key your chords point to.'}
        </p>
        <div className="key-list">
          {candidates.map((candidate) => {
            const id = keyId(candidate.key);
            const isActive = activeKey ? keyId(activeKey) === id : false;
            return (
              <button
                key={id}
                className="key-row"
                aria-pressed={isActive}
                onClick={() => pinKey(isActive ? null : id)}
              >
                <span className="key-name">{keyName(candidate.key)}</span>
                <span className="meter">
                  <span style={{ width: `${Math.round(candidate.confidence * 100)}%` }} />
                </span>
                <span className="pct">{Math.round(candidate.confidence * 100)}%</span>
              </button>
            );
          })}
        </div>
        {activeKey &&
          candidates.find((c) => keyId(c.key) === keyId(activeKey))?.outside.length ? (
          <p className="hint" style={{ marginTop: 10, marginBottom: 0 }}>
            Outside this key:{' '}
            {candidates.find((c) => keyId(c.key) === keyId(activeKey))!.outside.join(', ')}
          </p>
        ) : null}
      </div>

      {progressions.length > 0 && (
        <div>
          <h2>Progressions that fit</h2>
          <p className="hint">
            Tap one to load it as your practice set. Chords you already picked are outlined.
          </p>
          {progressions.map((progression) => (
            <article className="progression" key={progression.name}>
              <h3>{progression.name}</h3>
              <p>{progression.description}</p>
              <div className="progression-chords">
                {progression.chords.map((chord, i) => (
                  <button
                    key={`${chord.id}-${i}`}
                    className={`prog-chord${selected.includes(chord.id) ? ' in-selection' : ''}`}
                    onClick={() => focus(chord.id)}
                  >
                    <span className="roman">{progression.romans[i]}</span>
                    <span className="name">{chord.id}</span>
                  </button>
                ))}
              </div>
              <button
                className="ghost"
                style={{ marginTop: 10, minHeight: 36, padding: '6px 12px', fontSize: '0.85rem' }}
                onClick={() =>
                  setSelection([...new Set(progression.chords.map((c) => c.id))])
                }
              >
                Practise these
              </button>
            </article>
          ))}
        </div>
      )}

      {nextChords.length > 0 && (
        <div>
          <h2>After {focused}</h2>
          <p className="hint">Where this chord usually goes next in {keyName(activeKey!)}.</p>
          <div className="next-list">
            {nextChords.map((suggestion) => (
              <button
                key={suggestion.chord.id}
                className="next-item"
                onClick={() => focus(suggestion.chord.id)}
              >
                <span className="name">{suggestion.chord.id}</span>
                <span className="roman">{suggestion.roman}</span>
                <span className="reason">{suggestion.reason}</span>
              </button>
            ))}
          </div>
        </div>
      )}
    </section>
  );
}

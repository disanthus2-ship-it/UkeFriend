import { useEffect, useState } from 'react';
import { ChordBrowser } from './components/ChordBrowser';
import { ChordPicker } from './components/ChordPicker';
import { DebugPanel } from './components/DebugPanel';
import { PracticePanel } from './components/PracticePanel';
import { ProgressPanel } from './components/ProgressPanel';
import { Suggestions } from './components/Suggestions';
import { useAppStore, type View } from './state/store';

const TABS: { id: View; label: string }[] = [
  { id: 'browse', label: 'Chords' },
  { id: 'practice', label: 'Practice' },
  { id: 'progress', label: 'Progress' },
];

export default function App() {
  const view = useAppStore((s) => s.view);
  const setView = useAppStore((s) => s.setView);
  const [debug, setDebug] = useState(false);

  useEffect(() => {
    setDebug(new URLSearchParams(window.location.search).get('debug') === '1');
  }, []);

  return (
    <div className="app">
      <header className="masthead">
        <div>
          <h1>
            Uke<span>Friend</span>
          </h1>
          <p className="tagline">Chord shapes, harmony that fits, and a stopwatch on your fingers.</p>
        </div>
      </header>

      <nav className="tabs" role="tablist" aria-label="Sections">
        {TABS.map((tab) => (
          <button
            key={tab.id}
            role="tab"
            aria-selected={view === tab.id}
            onClick={() => setView(tab.id)}
          >
            {tab.label}
          </button>
        ))}
      </nav>

      <main>
        {view === 'browse' && (
          <div className="stack">
            <ChordBrowser />
            <div className="split">
              <ChordPicker />
              <Suggestions />
            </div>
          </div>
        )}

        {view === 'practice' && (
          <div className="stack">
            <PracticePanel />
            {debug && <DebugPanel />}
          </div>
        )}

        {view === 'progress' && <ProgressPanel />}
      </main>

      <footer style={{ color: 'var(--muted-dim)', fontSize: '0.78rem', textAlign: 'center' }}>
        Standard ukulele tuning (G C E A). Audio is analysed on your device and never sent
        anywhere.
      </footer>
    </div>
  );
}

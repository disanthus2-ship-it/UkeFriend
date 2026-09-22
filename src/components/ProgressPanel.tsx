import { useState } from 'react';
import { CHORD_IDS } from '../music/chords';
import { averageTotalMs, accuracy } from '../practice/stats';
import { algorithmicDelayMs, formatMs } from '../practice/timing';
import { useAppStore } from '../state/store';
import { useEngine } from '../hooks/useEngine';

export function ProgressPanel() {
  const stats = useAppStore((s) => s.stats);
  const resetStats = useAppStore((s) => s.resetStats);
  const calibrationOffsetMs = useAppStore((s) => s.calibrationOffsetMs);
  const setCalibration = useAppStore((s) => s.setCalibration);
  const { engine, state: engineState } = useEngine();

  const [calibrating, setCalibrating] = useState(false);
  const [calibrationError, setCalibrationError] = useState<string | null>(null);

  const rows = CHORD_IDS.map((id) => stats[id]).filter((s) => s && s.attempts > 0);
  const latencyInfo = engine.latencyInfo;

  const runCalibration = async () => {
    setCalibrating(true);
    setCalibrationError(null);
    try {
      const roundTrip = await engine.calibrate();
      setCalibration(Math.round(roundTrip));
    } catch (error) {
      setCalibrationError(error instanceof Error ? error.message : String(error));
    } finally {
      setCalibrating(false);
    }
  };

  return (
    <div className="stack">
      <section className="panel">
        <h2>Your times</h2>
        <p className="hint">
          Best and recent average per chord. Times are measured from the moment the chord
          appears to the moment it sounds cleanly.
        </p>

        {rows.length === 0 ? (
          <p className="hint" style={{ marginBottom: 0 }}>
            Nothing recorded yet. Run a practice session and your times will appear here.
          </p>
        ) : (
          <>
            <table className="stats">
              <thead>
                <tr>
                  <th>Chord</th>
                  <th>Tries</th>
                  <th>Hit rate</th>
                  <th>Best</th>
                  <th>Recent avg</th>
                  <th>Best settle</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((stat) => {
                  const rate = accuracy(stat);
                  return (
                    <tr key={stat.chordId}>
                      <td style={{ fontWeight: 640 }}>{stat.chordId}</td>
                      <td>{stat.attempts}</td>
                      <td>{rate === null ? '—' : `${Math.round(rate * 100)}%`}</td>
                      <td>{formatMs(stat.bestTotalMs)}</td>
                      <td>{formatMs(averageTotalMs(stat))}</td>
                      <td>{formatMs(stat.bestSettleMs)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
            <button
              className="ghost"
              style={{ marginTop: 14, minHeight: 36, padding: '6px 12px', fontSize: '0.85rem' }}
              onClick={resetStats}
            >
              Clear history
            </button>
          </>
        )}
      </section>

      <section className="panel">
        <h2>What the numbers mean</h2>
        <p className="hint">Three figures, because “how fast” is really two questions.</p>
        <div className="stack" style={{ gap: 10 }}>
          <div>
            <strong>Reaction</strong>
            <p className="hint" style={{ margin: 0 }}>
              From the chord appearing to your first strum. How quickly you recognised it.
            </p>
          </div>
          <div>
            <strong>Settle</strong>
            <p className="hint" style={{ margin: 0 }}>
              From that strum to a clean-sounding chord. This is where a fumbled finger shows
              up — a shape that buzzes before it seats costs you here and nowhere else.
            </p>
          </div>
          <div>
            <strong>Total</strong>
            <p className="hint" style={{ margin: 0 }}>
              The two added together.
            </p>
          </div>
        </div>
      </section>

      <section className="panel">
        <h2>Latency &amp; calibration</h2>
        <p className="hint">
          {formatMs(algorithmicDelayMs(engine.config))} of analysis delay is measured and
          subtracted from every result automatically.
        </p>

        <div className="notice warn">
          <p>
            <strong>Your device adds latency that no browser will report.</strong>
          </p>
          <p>
            There is no web API for microphone input latency — Chrome exposes one, but it
            returns a fixed 10&nbsp;ms whatever hardware is attached. Real delay is typically
            20&ndash;60&nbsp;ms wired, and can exceed 150&nbsp;ms over Bluetooth.
          </p>
          <p style={{ marginTop: 8 }}>
            Two consequences worth knowing: <strong>Settle time is unaffected</strong>, because
            the delay hits the strum and the chord equally and cancels out. And even
            uncalibrated, your times stay comparable to each other — so improvement is real
            even when the absolute number is not exact.
          </p>
        </div>

        <div className="row" style={{ marginTop: 14 }}>
          <button onClick={runCalibration} disabled={engineState !== 'running' || calibrating}>
            {calibrating ? 'Listening for the click…' : 'Calibrate with a click'}
          </button>
          {calibrationOffsetMs > 0 && (
            <button className="ghost" onClick={() => setCalibration(0)}>
              Clear calibration
            </button>
          )}
        </div>
        <p className="hint" style={{ marginTop: 8 }}>
          {engineState !== 'running'
            ? 'Start the microphone on the Practice tab first.'
            : 'Plays a short click through your speakers and listens for it. Use speakers, not headphones.'}
        </p>

        {calibrationError && (
          <div className="notice error" style={{ marginTop: 10 }}>
            <p>{calibrationError}</p>
          </div>
        )}

        <table className="stats" style={{ marginTop: 14 }}>
          <tbody>
            <tr>
              <td>Measured round-trip</td>
              <td>{calibrationOffsetMs > 0 ? `${calibrationOffsetMs} ms` : 'not calibrated'}</td>
            </tr>
            <tr>
              <td>Analysis delay (subtracted)</td>
              <td>{formatMs(algorithmicDelayMs(engine.config))}</td>
            </tr>
            <tr>
              <td>Output latency (reported)</td>
              <td>{formatMs(latencyInfo?.outputLatencyMs ?? null)}</td>
            </tr>
            <tr>
              <td>Base latency (reported)</td>
              <td>{formatMs(latencyInfo?.baseLatencyMs ?? null)}</td>
            </tr>
            <tr>
              <td>Sample rate</td>
              <td>{engineState === 'running' ? `${engine.sampleRate} Hz` : '—'}</td>
            </tr>
          </tbody>
        </table>
      </section>
    </div>
  );
}

import { MicError } from '../audio/micStream';
import type { EngineState } from '../audio/engine';

interface Props {
  state: EngineState;
  error: Error | null;
  onStart: () => void;
}

/**
 * Microphone permission is a first-class screen, not an afterthought.
 * Each failure mode gets a different remedy, because "allow microphone access"
 * is useless advice to someone whose page is not on HTTPS.
 */
export function MicGate({ state, error, onStart }: Props) {
  const micStatus = error instanceof MicError ? error.status : null;

  if (micStatus === 'insecure') {
    return (
      <div className="notice error">
        <p>
          <strong>This page needs HTTPS to use the microphone.</strong>
        </p>
        <p>
          Browsers only allow microphone access on a secure origin. Open the app over
          https://, or on localhost during development.
        </p>
      </div>
    );
  }

  if (micStatus === 'denied') {
    return (
      <div className="notice error">
        <p>
          <strong>Microphone permission was denied.</strong>
        </p>
        <ul>
          <li>Chrome / Edge: click the icon at the left of the address bar, then allow the microphone.</li>
          <li>Safari: Settings &rarr; Websites &rarr; Microphone, then reload.</li>
          <li>iOS: Settings &rarr; Safari &rarr; Microphone.</li>
        </ul>
        <p style={{ marginTop: 10 }}>
          <button onClick={onStart}>Try again</button>
        </p>
      </div>
    );
  }

  if (micStatus === 'unavailable') {
    return (
      <div className="notice error">
        <p>
          <strong>No microphone available.</strong> {error?.message}
        </p>
        <p style={{ marginTop: 10 }}>
          <button onClick={onStart}>Try again</button>
        </p>
      </div>
    );
  }

  if (state === 'error') {
    return (
      <div className="notice error">
        <p>
          <strong>Could not start listening.</strong> {error?.message}
        </p>
        <p style={{ marginTop: 10 }}>
          <button onClick={onStart}>Try again</button>
        </p>
      </div>
    );
  }

  return (
    <div className="practice-stage">
      <p style={{ maxWidth: 440, textAlign: 'center', color: 'var(--muted)' }}>
        UkeFriend listens through your microphone to check the chord you play and time how
        long it takes you. Nothing is recorded, and no audio leaves your device.
      </p>
      <button className="primary" onClick={onStart} disabled={state === 'starting'}>
        {state === 'starting' ? 'Starting…' : 'Enable microphone'}
      </button>
      <p className="hint" style={{ textAlign: 'center' }}>
        Your browser will ask for permission.
      </p>
    </div>
  );
}

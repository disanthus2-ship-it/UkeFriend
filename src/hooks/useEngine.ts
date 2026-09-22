import { useCallback, useEffect, useRef, useState } from 'react';
import { AudioEngine, type EngineState } from '../audio/engine';
import { MicError } from '../audio/micStream';

let singleton: AudioEngine | null = null;

/** One engine per page: a second AudioContext on the same mic wastes CPU. */
export function getEngine(): AudioEngine {
  if (!singleton) singleton = new AudioEngine();
  return singleton;
}

export function useEngine() {
  const engine = getEngine();
  const [state, setState] = useState<EngineState>(engine.state);
  const [error, setError] = useState<Error | null>(engine.error);
  const startingRef = useRef(false);

  useEffect(() => engine.onStateChange((next, err) => {
    setState(next);
    setError(err ?? null);
  }), [engine]);

  const start = useCallback(async () => {
    if (startingRef.current) return;
    startingRef.current = true;
    try {
      await engine.start();
    } catch {
      // The engine already published the error through onStateChange.
    } finally {
      startingRef.current = false;
    }
  }, [engine]);

  const stop = useCallback(() => void engine.stop(), [engine]);

  // Browsers suspend an AudioContext when the tab is hidden, and the audio and
  // performance clocks can drift apart while it is parked. Resyncing on return
  // keeps the latency figures honest.
  useEffect(() => {
    const onVisibility = () => {
      if (document.visibilityState === 'visible') engine.resyncClock();
    };
    document.addEventListener('visibilitychange', onVisibility);
    return () => document.removeEventListener('visibilitychange', onVisibility);
  }, [engine]);

  return { engine, state, error, start, stop, isMicError: error instanceof MicError };
}

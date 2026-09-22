export type MicStatus =
  | 'idle'
  | 'requesting'
  | 'granted'
  | 'denied'
  | 'unavailable'
  | 'insecure';

export class MicError extends Error {
  constructor(readonly status: MicStatus, message: string) {
    super(message);
    this.name = 'MicError';
  }
}

/**
 * getUserMedia needs a secure context. localhost is exempt, which is why `npm
 * run dev` works but testing on a phone over the LAN needs HTTPS.
 */
export function isSecureEnough(): boolean {
  if (typeof window === 'undefined') return false;
  return window.isSecureContext === true;
}

export function hasMediaDevices(): boolean {
  return typeof navigator !== 'undefined' && !!navigator.mediaDevices?.getUserMedia;
}

/**
 * Constraints tuned for music rather than speech.
 *
 * The three "helpful" defaults are all actively harmful here. Echo cancellation
 * and noise suppression are built to isolate a single voice and will happily
 * carve holes in a strummed chord; automatic gain control pumps the level
 * between frames, which corrupts both the chroma and the onset detector. All
 * three default to on, so they must be explicitly refused.
 */
export const MUSIC_AUDIO_CONSTRAINTS: MediaTrackConstraints = {
  echoCancellation: false,
  noiseSuppression: false,
  autoGainControl: false,
  channelCount: 1,
};

export async function requestMicrophone(): Promise<MediaStream> {
  if (!isSecureEnough()) {
    throw new MicError(
      'insecure',
      'Microphone access needs a secure context. Open this page over HTTPS, or on localhost.',
    );
  }
  if (!hasMediaDevices()) {
    throw new MicError('unavailable', 'This browser does not support microphone capture.');
  }

  try {
    return await navigator.mediaDevices.getUserMedia({
      audio: MUSIC_AUDIO_CONSTRAINTS,
      video: false,
    });
  } catch (error) {
    const name = error instanceof Error ? error.name : '';
    if (name === 'NotAllowedError' || name === 'SecurityError') {
      throw new MicError('denied', 'Microphone permission was denied.');
    }
    if (name === 'NotFoundError' || name === 'OverconstrainedError') {
      throw new MicError('unavailable', 'No microphone was found on this device.');
    }
    throw new MicError('unavailable', `Could not open the microphone: ${String(error)}`);
  }
}

/** Which of the requested constraints the browser actually honoured. */
export function describeTrackSettings(stream: MediaStream): Record<string, unknown> {
  const track = stream.getAudioTracks()[0];
  return track ? { label: track.label, ...track.getSettings() } : {};
}

export function stopStream(stream: MediaStream | null): void {
  stream?.getTracks().forEach((track) => track.stop());
}

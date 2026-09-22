/**
 * Source for the capture AudioWorkletProcessor.
 *
 * Kept as a string and loaded from a Blob URL rather than as a separate file.
 * An AudioWorklet module is fetched by URL at runtime, so a real file would
 * have to survive bundling, the configured base path (GitHub Pages serves from
 * a subdirectory) and the service worker's cache. A Blob URL has none of those
 * failure modes and works identically offline.
 *
 * The processor does as little as possible: it batches the 128-sample render
 * quanta into hop-sized blocks and posts them. All analysis happens on the main
 * thread, where it can be tested without an AudioContext.
 */
export const CAPTURE_PROCESSOR_NAME = 'ukefriend-capture';

export function captureWorkletSource(hopSize: number): string {
  return `
class CaptureProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this.hopSize = ${hopSize};
    this.buffer = new Float32Array(this.hopSize);
    this.filled = 0;
    // Samples seen since the processor started, counted at the START of the
    // block currently being filled. The main thread turns this into a time.
    this.blockStartSample = 0;
    this.running = true;
    this.port.onmessage = (event) => {
      if (event.data === 'stop') this.running = false;
    };
  }

  process(inputs) {
    if (!this.running) return false;
    const channel = inputs[0] && inputs[0][0];
    // No input yet (or the track ended); keep the processor alive.
    if (!channel) return true;

    for (let i = 0; i < channel.length; i++) {
      this.buffer[this.filled++] = channel[i];
      if (this.filled === this.hopSize) {
        const copy = new Float32Array(this.buffer);
        this.port.postMessage(
          {
            samples: copy,
            startSample: this.blockStartSample,
            // Audio-clock time at the end of this render quantum.
            contextTime: currentTime,
          },
          [copy.buffer],
        );
        this.blockStartSample += this.hopSize;
        this.filled = 0;
      }
    }
    return true;
  }
}

registerProcessor('${CAPTURE_PROCESSOR_NAME}', CaptureProcessor);
`;
}

/** Build an object URL for the worklet module. Caller should revoke it. */
export function createWorkletUrl(hopSize: number): string {
  const blob = new Blob([captureWorkletSource(hopSize)], { type: 'application/javascript' });
  return URL.createObjectURL(blob);
}

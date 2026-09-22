import { AudioClock, readLatencyInfo, type LatencyInfo } from './clock';
import {
  ChordDetector,
  DEFAULT_DETECTOR_CONFIG,
  type DetectorConfig,
  type FrameAnalysis,
} from './detector';
import { MicError, requestMicrophone, stopStream } from './micStream';
import { CAPTURE_PROCESSOR_NAME, createWorkletUrl } from './workletSource';

export type EngineState = 'idle' | 'starting' | 'running' | 'suspended' | 'error';

export interface EngineFrame extends FrameAnalysis {
  /** performance.now() time corresponding to the chord window's centre. */
  readonly performanceTime: number;
  /** performance.now() time corresponding to the onset window's centre. */
  readonly onsetPerformanceTime: number;
}

export type FrameListener = (frame: EngineFrame) => void;
export type StateListener = (state: EngineState, error?: Error) => void;

interface HopMessage {
  samples: Float32Array;
  startSample: number;
  contextTime: number;
}

/**
 * Owns the microphone, the AudioContext and the worklet, and turns the incoming
 * audio into timestamped analysis frames.
 *
 * Frames are delivered through listeners rather than React state on purpose:
 * at ~23 frames per second, routing every frame through a store would rerender
 * the whole tree several times a second for data that only a meter needs.
 * Components that want live values subscribe directly and draw imperatively;
 * only discrete events (a chord confirmed, a session step) reach React.
 */
export class AudioEngine {
  private context: AudioContext | null = null;
  private stream: MediaStream | null = null;
  private node: AudioWorkletNode | null = null;
  private sink: GainNode | null = null;
  private workletUrl: string | null = null;
  private clock: AudioClock | null = null;
  private detector: ChordDetector | null = null;

  private buffer: Float32Array | null = null;
  private samplesBuffered = 0;
  private lastHop: { startSample: number; contextTime: number } | null = null;

  private readonly frameListeners = new Set<FrameListener>();
  private readonly stateListeners = new Set<StateListener>();

  private _state: EngineState = 'idle';
  private _error: Error | null = null;
  /** User-measured round-trip offset in ms, applied to reported latencies. */
  calibrationOffsetMs = 0;

  get state(): EngineState {
    return this._state;
  }

  get error(): Error | null {
    return this._error;
  }

  get config(): DetectorConfig {
    return this.detector?.config ?? DEFAULT_DETECTOR_CONFIG;
  }

  get sampleRate(): number {
    return this.context?.sampleRate ?? DEFAULT_DETECTOR_CONFIG.sampleRate;
  }

  get latencyInfo(): LatencyInfo | null {
    return this.context ? readLatencyInfo(this.context, this.calibrationOffsetMs) : null;
  }

  onFrame(listener: FrameListener): () => void {
    this.frameListeners.add(listener);
    return () => this.frameListeners.delete(listener);
  }

  onStateChange(listener: StateListener): () => void {
    this.stateListeners.add(listener);
    return () => this.stateListeners.delete(listener);
  }

  private setState(state: EngineState, error?: Error): void {
    this._state = state;
    this._error = error ?? null;
    for (const listener of this.stateListeners) listener(state, error);
  }

  /**
   * Open the microphone and begin analysis.
   *
   * Must be called from a user gesture: iOS Safari refuses to start an
   * AudioContext otherwise, and leaves it suspended with no error.
   */
  async start(): Promise<void> {
    if (this._state === 'running' || this._state === 'starting') return;
    this.setState('starting');

    try {
      this.stream = await requestMicrophone();

      const context = new AudioContext({ latencyHint: 'interactive' });
      this.context = context;
      // Safari hands back a suspended context even from a gesture.
      if (context.state === 'suspended') await context.resume();

      const hopSize = DEFAULT_DETECTOR_CONFIG.hopSize;
      const fftSize = DEFAULT_DETECTOR_CONFIG.fftSize;
      if (fftSize % hopSize !== 0) {
        throw new Error('fftSize must be a whole number of hops');
      }

      this.workletUrl = createWorkletUrl(hopSize);
      await context.audioWorklet.addModule(this.workletUrl);

      this.detector = new ChordDetector({ sampleRate: context.sampleRate });
      this.clock = new AudioClock(context);
      this.buffer = new Float32Array(fftSize);
      this.samplesBuffered = 0;
      this.lastHop = null;

      const source = context.createMediaStreamSource(this.stream);
      const node = new AudioWorkletNode(context, CAPTURE_PROCESSOR_NAME);
      node.port.onmessage = (event: MessageEvent<HopMessage>) => this.handleHop(event.data);

      // The node needs a path to the destination to keep being pulled, but the
      // player must not hear themselves. A zero gain gives both.
      const sink = context.createGain();
      sink.gain.value = 0;
      source.connect(node);
      node.connect(sink);
      sink.connect(context.destination);

      this.node = node;
      this.sink = sink;
      this.setState('running');
    } catch (error) {
      const err = error instanceof Error ? error : new Error(String(error));
      await this.teardown();
      this.setState('error', err);
      throw err;
    }
  }

  private handleHop(message: HopMessage): void {
    const detector = this.detector;
    const buffer = this.buffer;
    const clock = this.clock;
    if (!detector || !buffer || !clock) return;

    const { fftSize, hopSize, sampleRate } = detector.config;
    this.lastHop = { startSample: message.startSample, contextTime: message.contextTime };

    // Slide the window along by one hop.
    buffer.copyWithin(0, hopSize);
    buffer.set(message.samples, fftSize - hopSize);
    this.samplesBuffered += hopSize;
    if (this.samplesBuffered < fftSize) return;

    const frameIndex = (this.samplesBuffered - fftSize) / hopSize;
    const frame = detector.processFrame(buffer, frameIndex);

    // The hop we just received ends at absolute sample startSample + hopSize,
    // and message.contextTime is the audio clock at that moment. Everything
    // else is derived from that one anchor, so frames never drift apart.
    const anchorSample = message.startSample + hopSize;
    const toPerformance = (sample: number) =>
      clock.toPerformanceTime(message.contextTime + (sample - anchorSample) / sampleRate);

    const enriched: EngineFrame = {
      ...frame,
      performanceTime: toPerformance(frame.centerSample),
      onsetPerformanceTime: toPerformance(frame.onsetCenterSample),
    };
    for (const listener of this.frameListeners) listener(enriched);
  }

  /** Re-align the audio and performance clocks. Cheap; call when resuming. */
  resyncClock(): void {
    this.clock?.resync();
  }

  async suspend(): Promise<void> {
    if (this.context && this.context.state === 'running') {
      await this.context.suspend();
      this.setState('suspended');
    }
  }

  async resume(): Promise<void> {
    if (this.context && this.context.state === 'suspended') {
      await this.context.resume();
      this.detector?.reset();
      this.samplesBuffered = 0;
      this.resyncClock();
      this.setState('running');
    }
  }

  async stop(): Promise<void> {
    await this.teardown();
    this.setState('idle');
  }

  private async teardown(): Promise<void> {
    try {
      this.node?.port.postMessage('stop');
      this.node?.port.close();
      this.node?.disconnect();
      this.sink?.disconnect();
    } catch {
      // Already torn down; nothing to recover.
    }
    stopStream(this.stream);
    if (this.workletUrl) URL.revokeObjectURL(this.workletUrl);
    if (this.context && this.context.state !== 'closed') {
      await this.context.close().catch(() => undefined);
    }
    this.node = null;
    this.sink = null;
    this.stream = null;
    this.context = null;
    this.clock = null;
    this.detector = null;
    this.buffer = null;
    this.workletUrl = null;
    this.lastHop = null;
    this.samplesBuffered = 0;
  }

  /** Absolute sample index of the most recently received hop, for diagnostics. */
  get lastSampleIndex(): number {
    return this.lastHop ? this.lastHop.startSample + DEFAULT_DETECTOR_CONFIG.hopSize : 0;
  }

  /**
   * Measure the device's audio round-trip by playing a click and listening for
   * it. The result includes speaker and microphone latency together, which is
   * an over-estimate of capture latency alone but the only figure a browser can
   * actually obtain — no standard API reports input latency.
   *
   * Requires the speakers to be audible to the microphone, so it is offered as
   * an explicit action rather than run automatically.
   */
  async calibrate(timeoutMs = 3000): Promise<number> {
    const context = this.context;
    if (!context || this._state !== 'running') {
      throw new MicError('unavailable', 'Start the microphone before calibrating.');
    }
    const clock = this.clock;
    if (!clock) throw new Error('Audio clock unavailable');

    return new Promise<number>((resolve, reject) => {
      const startAt = context.currentTime + 0.15;
      const playedAtPerformance = clock.toPerformanceTime(startAt);
      let settled = false;

      const finish = (fn: () => void) => {
        if (settled) return;
        settled = true;
        unsubscribe();
        clearTimeout(timer);
        fn();
      };

      const unsubscribe = this.onFrame((frame) => {
        // Ignore anything before the click could possibly have been heard.
        if (frame.onsetPerformanceTime < playedAtPerformance) return;
        if (!frame.onset) return;
        const roundTrip = frame.onsetPerformanceTime - playedAtPerformance;
        finish(() => resolve(Math.max(0, roundTrip)));
      });

      const timer = setTimeout(() => {
        finish(() =>
          reject(
            new Error(
              'Did not hear the calibration click. Turn the volume up, use speakers rather than headphones, and try again.',
            ),
          ),
        );
      }, timeoutMs);

      // A short burst of filtered noise: broadband enough for the onset
      // detector, brief enough not to be unpleasant.
      const duration = 0.04;
      const frames = Math.floor(context.sampleRate * duration);
      const clickBuffer = context.createBuffer(1, frames, context.sampleRate);
      const data = clickBuffer.getChannelData(0);
      for (let i = 0; i < frames; i++) {
        data[i] = (Math.random() * 2 - 1) * Math.exp(-12 * (i / context.sampleRate));
      }
      const source = context.createBufferSource();
      source.buffer = clickBuffer;
      const gain = context.createGain();
      gain.gain.value = 0.6;
      source.connect(gain);
      gain.connect(context.destination);
      source.start(startAt);
    });
  }
}

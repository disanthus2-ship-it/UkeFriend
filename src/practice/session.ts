import {
  ConfirmationTracker,
  DEFAULT_DETECTOR_CONFIG,
  type DetectorConfig,
} from '../audio/detector';
import type { EngineFrame } from '../audio/engine';
import { computeLatency, type LatencyBreakdown } from './timing';

export type SessionPhase =
  | 'idle'
  /** A chord is on screen but we have not yet recorded when it was painted. */
  | 'prompting'
  /** Waiting for the player. */
  | 'listening'
  /** The attempt resolved; showing the result. */
  | 'result'
  | 'finished';

export type AttemptOutcome = 'hit' | 'miss' | 'skipped';

export interface Attempt {
  readonly chordId: string;
  readonly outcome: AttemptOutcome;
  readonly latency: LatencyBreakdown | null;
  /** performance.now() when the attempt resolved. */
  readonly at: number;
}

export interface SessionOptions {
  /** Chords to draw prompts from. */
  chordIds: readonly string[];
  /** How long to wait before calling an attempt a miss. */
  timeoutMs?: number;
  detectorConfig?: DetectorConfig;
  calibrationOffsetMs?: number;
  /** Number of prompts in the session; 0 means run until stopped. */
  length?: number;
  /** Injectable for deterministic tests. */
  random?: () => number;
}

export interface SessionState {
  readonly phase: SessionPhase;
  readonly currentChordId: string | null;
  readonly attempts: readonly Attempt[];
  readonly lastAttempt: Attempt | null;
  readonly promptIndex: number;
  readonly total: number;
}

type Listener = (state: SessionState) => void;

/**
 * If the player strums so softly that no attack is detected, we still want the
 * attempt to count — just without the reaction/settle split, which needs an
 * onset to measure from. After this long we stop insisting on one.
 */
const ONSET_GRACE_MS = 400;

/**
 * Drives one practice run: prompt a chord, listen, time the response, repeat.
 *
 * Deliberately free of React and of the audio stack — it consumes analysis
 * frames and emits state — so the whole loop, including its timing, can be
 * tested by replaying synthesized audio through it.
 */
export class PracticeSession {
  private readonly tracker: ConfirmationTracker;
  private readonly config: DetectorConfig;
  private readonly calibrationOffsetMs: number;
  private readonly timeoutMs: number;
  private readonly length: number;
  private readonly random: () => number;
  private readonly chordIds: string[];

  private phase: SessionPhase = 'idle';
  private currentChordId: string | null = null;
  private promptAt: number | null = null;
  private onsetAt: number | null = null;
  private attempts: Attempt[] = [];
  private promptIndex = 0;
  private lastPromptedId: string | null = null;
  private readonly listeners = new Set<Listener>();

  constructor(options: SessionOptions) {
    this.chordIds = [...options.chordIds];
    this.config = options.detectorConfig ?? DEFAULT_DETECTOR_CONFIG;
    this.calibrationOffsetMs = options.calibrationOffsetMs ?? 0;
    this.timeoutMs = options.timeoutMs ?? 10000;
    this.length = options.length ?? 0;
    this.random = options.random ?? Math.random;
    this.tracker = new ConfirmationTracker(this.config);
  }

  subscribe(listener: Listener): () => void {
    this.listeners.add(listener);
    listener(this.snapshot());
    return () => this.listeners.delete(listener);
  }

  snapshot(): SessionState {
    return {
      phase: this.phase,
      currentChordId: this.currentChordId,
      attempts: this.attempts,
      lastAttempt: this.attempts[this.attempts.length - 1] ?? null,
      promptIndex: this.promptIndex,
      total: this.length,
    };
  }

  private emit(): void {
    const state = this.snapshot();
    for (const listener of this.listeners) listener(state);
  }

  /** Begin the session and show the first chord. */
  start(): void {
    this.attempts = [];
    this.promptIndex = 0;
    this.lastPromptedId = null;
    this.nextPrompt();
  }

  private nextPrompt(): void {
    if (this.chordIds.length === 0) {
      this.phase = 'finished';
      this.currentChordId = null;
      this.emit();
      return;
    }
    if (this.length > 0 && this.promptIndex >= this.length) {
      this.phase = 'finished';
      this.currentChordId = null;
      this.emit();
      return;
    }

    this.currentChordId = this.pickChord();
    this.lastPromptedId = this.currentChordId;
    this.promptIndex++;
    this.promptAt = null;
    this.onsetAt = null;
    this.tracker.reset();
    this.phase = 'prompting';
    this.emit();
  }

  /** Avoid prompting the same chord twice running when there is a choice. */
  private pickChord(): string {
    if (this.chordIds.length === 1) return this.chordIds[0];
    const options = this.chordIds.filter((id) => id !== this.lastPromptedId);
    return options[Math.floor(this.random() * options.length)] ?? this.chordIds[0];
  }

  /**
   * Record when the prompt actually reached the screen.
   *
   * The caller passes a timestamp taken inside a requestAnimationFrame
   * callback, not when state was set: measuring from a state update would
   * charge the player for a frame of React's rendering.
   */
  markPrompted(paintedAt: number): void {
    if (this.phase !== 'prompting') return;
    this.promptAt = paintedAt;
    this.phase = 'listening';
    this.emit();
  }

  /** Feed one analysis frame. Returns the attempt if this frame resolved one. */
  handleFrame(frame: EngineFrame): Attempt | null {
    if (this.phase !== 'listening' || this.promptAt === null || !this.currentChordId) {
      return null;
    }

    if (frame.onset && this.onsetAt === null && frame.onsetPerformanceTime >= this.promptAt) {
      this.onsetAt = frame.onsetPerformanceTime;
    }

    const confirmation = this.tracker.push(frame, this.currentChordId);
    if (confirmation) {
      const sincePrompt = frame.performanceTime - this.promptAt;
      // Require evidence the player actually struck the strings, so a chord
      // still ringing from the previous prompt cannot score a hit.
      if (this.onsetAt !== null || sincePrompt > ONSET_GRACE_MS) {
        return this.resolve('hit', frame.performanceTime);
      }
    }

    if (frame.performanceTime - this.promptAt > this.timeoutMs) {
      return this.resolve('miss', frame.performanceTime);
    }
    return null;
  }

  /** Give up on the current chord and move on. */
  skip(now: number = performance.now()): Attempt | null {
    if (this.phase !== 'listening' && this.phase !== 'prompting') return null;
    return this.resolve('skipped', now);
  }

  private resolve(outcome: AttemptOutcome, at: number): Attempt {
    const latency =
      outcome === 'hit' && this.promptAt !== null
        ? computeLatency(
            { promptAt: this.promptAt, onsetAt: this.onsetAt, confirmedAt: at },
            this.config,
            this.calibrationOffsetMs,
          )
        : null;

    const attempt: Attempt = {
      chordId: this.currentChordId ?? '',
      outcome,
      latency,
      at,
    };
    this.attempts = [...this.attempts, attempt];
    this.phase = 'result';
    this.emit();
    return attempt;
  }

  /** Move to the next prompt after a result. */
  next(): void {
    if (this.phase !== 'result') return;
    this.nextPrompt();
  }

  stop(): void {
    this.phase = 'idle';
    this.currentChordId = null;
    this.promptAt = null;
    this.onsetAt = null;
    this.tracker.reset();
    this.emit();
  }
}

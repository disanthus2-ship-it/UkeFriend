# UkeFriend

A browser-based ukulele chord trainer. It shows a chord as a diagram and as tab,
suggests progressions that actually fit the chords you picked, then listens
through your microphone to check you played it and times how long you took.

Runs anywhere a modern browser does — desktop, Android, iOS — as an installable,
offline-capable PWA. Nothing is recorded and no audio leaves the device.

## What it does

- **Chord views.** SVG chord box with finger numbers and barres, plus four-line
  tab, both with an optional overlay of the notes each string actually sounds.
  26 chords in standard re-entrant GCEA tuning.
- **Harmony that fits.** Pick some chords and it ranks the keys they could be
  in, then offers progressions drawn from those keys (I–V–vi–IV, ii–V–I, the
  12-bar blues, the Andalusian cadence, and others) plus where any given chord
  usually goes next, with the reason in plain English.
- **Listening practice.** A chord appears, you strum it, and the app confirms
  whether you played the right one.
- **Timing.** Every attempt is split into *reaction* (prompt to strum) and
  *settle* (strum to a clean-sounding chord), because those are two different
  skills and a single number hides the more useful one.

## Running it

```bash
npm install
npm run dev          # http://localhost:5173
```

`localhost` is a secure context, so the microphone works there without HTTPS.

To try it on a phone on the same network you need a real secure origin:

```bash
HTTPS=1 npm run dev:lan
```

Then open the printed `https://<your-ip>:5173` on the phone and accept the
self-signed certificate.

```bash
npm test             # unit and integration tests
npm run lint
npm run build        # production build
npm run preview
```

### Deploying to GitHub Pages

`.github/workflows/deploy.yml` lints, typechecks, tests and builds on every push
to `main`, then publishes `dist/` to Pages. It derives the base path from the
repository name, so a rename or a fork keeps working without editing the file.

**One-time setup:** Settings -> Pages -> Source -> *GitHub Actions*. Until that
is set, the workflow runs but has nowhere to publish.

The site then lives at `https://<owner>.github.io/<repo>/`. Pages serves HTTPS,
which the microphone requires.

To build for a subpath by hand:

```bash
BASE_PATH=/UkeFriend/ npm run build
```

Everything in `dist/` is static, so any static host works.

## How chord detection works

Audio is captured through an `AudioWorklet`, batched into hops and analysed on
the main thread: FFT → 12-bin chroma (pitch-class profile) → cosine similarity
against a chord template bank. No model download, no network, ~23 analysis
frames per second.

Two decisions carry most of the accuracy:

**Templates are generated from the voicing, not hardcoded.** The textbook
template for C major is `{C, E, G}`, but a real plucked C string radiates energy
at its 3rd harmonic (a G) and 5th (an E), so a microphone hearing a clean C
major sees energy well outside those three pitch classes. Each template is
instead synthesized from the actual fretted voicing by summing six harmonics per
string at `1/h` amplitude and folding them into pitch classes, so it expects the
same spread the microphone hears.

**It verifies rather than identifies.** Naming an arbitrary chord from chroma
alone is genuinely unreliable — C and Am7 differ by a single pitch class. But
the app always knows which chord it asked for, so the practice path scores that
chord and requires it to be the clear winner. The free-play readout still shows
a best guess, as a ranked list with confidences rather than one confident-
looking answer.

A chord is confirmed when it beats every other chord in the library by a margin,
scores above threshold, and holds for two consecutive frames.

### Why the window is 8192 samples

The lowest note standard re-entrant tuning can sound is C4 (261.6 Hz), where
adjacent semitones are only ~15 Hz apart. At 48 kHz an 8192-sample window gives
5.9 Hz bins — about 2.7 bins per semitone down there. A 4096 window leaves
barely one, and smears neighbouring notes together.

Onset detection runs on its own 1024-sample window. A 170 ms window is fine for
identifying a chord but fatal for timing an attack: measured against synthesized
strums, timestamping onsets from the long window put them a consistent 59 ms
*before* the strum actually happened.

## About the latency figures

Two parts of the delay are known exactly and are subtracted from every result:
the analysis window occupancy and the stability run, ~69 ms together at the
default configuration. Those constants were measured against synthesized strums
with a known ground truth, not assumed — the obvious theoretical value
over-compensated by about 60 ms and drove most reported times to zero.
`test/timing.test.ts` fails if that drifts.

What is *not* known is your device's microphone latency. **There is no web API
that reports it.** Chrome exposes `MediaTrackSettings.latency`, but it returns a
hardcoded 10 ms regardless of the hardware attached — including on a fake device.
`AudioContext.outputLatency` is honest but describes playback, the wrong
direction. Real capture latency is typically 20–60 ms wired and can exceed
150 ms over Bluetooth.

So the app does three things rather than pretend:

1. Labels the figures as including device latency.
2. Offers a loopback calibration on the Progress tab — it plays a click through
   the speakers and listens for it, which measures the round trip.
3. Reports **settle time** separately, which is unaffected either way: device
   latency delays the strum and the confirmation equally, so it cancels out of
   that subtraction. It is the most trustworthy number here and the one worth
   training against.

Even uncalibrated, the figures stay comparable *to each other*, so improvement
over time is real even when the absolute value is not exact.

## Layout

```
src/
  audio/      capture, FFT, chroma, onset, detector, clock, engine
  music/      notes, tuning, chord library, chroma templates, progressions
  practice/   session state machine, latency maths, stats
  components/ React views
  lib/        shared vector helpers
test/         unit and integration tests, plus the audio synthesizer
scripts/      WAV fixture generator and browser smoke test
```

The DSP layer never imports React and never touches `AudioContext`: it is pure
functions over `Float32Array`. That is what lets the detector be tested offline
against synthesized audio instead of needing a browser and a person with a
ukulele. Analysis frames are delivered to components through listeners rather
than React state, so 23 frames per second of meter data never enters the render
path.

## Testing

```bash
npm test
```

192 tests. The substantial ones:

- Every voicing in the library is checked against its chord formula, so a typo
  in a fret array fails the build instead of teaching a wrong shape.
- Every chord is synthesized as a strummed, detuned, harmonically rich signal
  and fed through the real detector — across bright and dark timbres, slow
  strums, an out-of-tune instrument and a noisy room at 12 dB SNR.
- All 650 wrong-chord pairs are checked for false positives.
- End-to-end timing accuracy against a known ground truth.

### Browser smoke test

The unit tests cover everything except the browser audio stack itself. That is
covered separately by driving the built app in Chromium with a synthesized strum
injected as the microphone:

```bash
npm run fixture -- C /tmp/chord-C.wav 90
npm run build && npm run preview &
npm run smoke -- /tmp/shots /tmp/chord-C.wav http://localhost:4173
```

This exercises the AudioWorklet, the clock mapping and detection in a real
browser, takes screenshots, and checks for console errors and mobile overflow.
It needs Chromium; set `CHROME_PATH` if yours is not at the default location.

## Known limits

- Standard re-entrant GCEA only. Low-G and baritone tuning would need their own
  voicings and templates.
- One canonical voicing per chord (E also carries a barre alternative). Play a
  chord much higher up the neck and it may not be recognised.
- Detection degrades below roughly 10 dB SNR — a noisy room with a quietly
  played ukulele is genuinely hard.
- iOS Safari needs a user gesture to start audio, hence the explicit
  "Enable microphone" button. AudioWorklet requires iOS 14.5+.
- `npm audit` reports advisories in Vite, esbuild and Vitest. All of them
  concern the local dev server and the Vitest UI, neither of which is used in
  CI or shipped: the deployed artifact is static HTML, CSS and JS, and the
  runtime dependencies (react, react-dom, zustand) are unaffected. Clearing
  them needs a major Vite upgrade, so CI deliberately does not gate on audit.

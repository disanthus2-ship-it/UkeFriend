/**
 * Render a synthesized ukulele performance to a WAV file, for feeding into
 * Chromium's fake audio capture device (--use-file-for-fake-audio-capture).
 * That lets the browser-level smoke test exercise the real microphone path.
 *
 * Usage: node scripts/make-fixture-wav.mjs <chordId> <out.wav>
 */
import { writeFileSync } from 'node:fs';
import { register } from 'node:module';

register('data:text/javascript,export async function resolve(s,c,n){return n(s,c)}', import.meta.url);

const SAMPLE_RATE = 48000;

// Standard GCEA open-string MIDI notes, and the voicings we need.
const OPEN = [67, 60, 64, 69];
const VOICINGS = {
  C: [0, 0, 0, 3],
  F: [2, 0, 1, 0],
  G: [0, 2, 3, 2],
  Am: [2, 0, 0, 0],
};

function midiToFreq(m) {
  return 440 * Math.pow(2, (m - 69) / 12);
}

function synth(frets, durationSec, startOffsetSec, out) {
  const notes = frets.map((f, i) => OPEN[i] + f);
  notes.forEach((midi, stringIndex) => {
    const f0 = midiToFreq(midi) * Math.pow(2, ((stringIndex % 3) - 1) * 3 / 1200);
    const start = Math.floor((startOffsetSec + stringIndex * 0.018) * SAMPLE_RATE);
    for (let h = 1; h <= 8; h++) {
      const freq = f0 * h;
      if (freq >= SAMPLE_RATE / 2) break;
      const amp = 0.3 / h;
      const decay = 2.0 + 0.9 * h;
      const omega = (2 * Math.PI * freq) / SAMPLE_RATE;
      const end = Math.min(out.length, start + Math.floor(durationSec * SAMPLE_RATE));
      for (let i = start; i < end; i++) {
        const t = (i - start) / SAMPLE_RATE;
        out[i] += amp * Math.min(1, t / 0.004) * Math.exp(-decay * t) * Math.sin(omega * (i - start));
      }
    }
  });
}

function writeWav(path, samples) {
  const bytesPerSample = 2;
  const dataSize = samples.length * bytesPerSample;
  const buffer = Buffer.alloc(44 + dataSize);
  buffer.write('RIFF', 0);
  buffer.writeUInt32LE(36 + dataSize, 4);
  buffer.write('WAVE', 8);
  buffer.write('fmt ', 12);
  buffer.writeUInt32LE(16, 16);
  buffer.writeUInt16LE(1, 20);              // PCM
  buffer.writeUInt16LE(1, 22);              // mono
  buffer.writeUInt32LE(SAMPLE_RATE, 24);
  buffer.writeUInt32LE(SAMPLE_RATE * bytesPerSample, 28);
  buffer.writeUInt16LE(bytesPerSample, 32);
  buffer.writeUInt16LE(16, 34);
  buffer.write('data', 36);
  buffer.writeUInt32LE(dataSize, 40);
  for (let i = 0; i < samples.length; i++) {
    const clamped = Math.max(-1, Math.min(1, samples[i]));
    buffer.writeInt16LE(Math.round(clamped * 32767), 44 + i * bytesPerSample);
  }
  writeFileSync(path, buffer);
}

const [, , chordArg = 'C', outPath = 'fixture.wav', durationArg] = process.argv;

// Chromium plays the fake capture file exactly once and then feeds silence, so
// the fixture must be long enough to cover the whole test run rather than
// relying on it looping.
const totalSec = Number(durationArg ?? 90);
const out = new Float32Array(SAMPLE_RATE * totalSec);
const frets = VOICINGS[chordArg];
if (!frets) throw new Error(`No voicing for ${chordArg}. Known: ${Object.keys(VOICINGS).join(', ')}`);
for (let t = 0.3; t < totalSec - 1.5; t += 1.6) {
  synth(frets, 1.5, t, out);
}
writeWav(outPath, out);
console.log(`wrote ${outPath}: ${chordArg} strummed every 1.6s for ${totalSec}s`);

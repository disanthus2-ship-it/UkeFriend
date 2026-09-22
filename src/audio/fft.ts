/**
 * Minimal radix-2 Cooley-Tukey FFT.
 *
 * Deliberately dependency-free and free of any Web Audio types, so the whole
 * detection chain can run under Node in the test suite against synthesized
 * audio. `AnalyserNode.getFloatFrequencyData` would have been less code but it
 * is only available inside a live AudioContext, which would make the detector
 * untestable without a browser and a microphone.
 */
export class FFT {
  readonly size: number;
  private readonly cosTable: Float64Array;
  private readonly sinTable: Float64Array;
  private readonly reverse: Uint32Array;
  private readonly re: Float64Array;
  private readonly im: Float64Array;

  constructor(size: number) {
    if (size < 2 || (size & (size - 1)) !== 0) {
      throw new Error(`FFT size must be a power of two, got ${size}`);
    }
    this.size = size;
    this.re = new Float64Array(size);
    this.im = new Float64Array(size);

    const half = size / 2;
    this.cosTable = new Float64Array(half);
    this.sinTable = new Float64Array(half);
    for (let i = 0; i < half; i++) {
      this.cosTable[i] = Math.cos((2 * Math.PI * i) / size);
      this.sinTable[i] = Math.sin((2 * Math.PI * i) / size);
    }

    // Bit-reversal permutation table.
    const bits = Math.log2(size);
    this.reverse = new Uint32Array(size);
    for (let i = 0; i < size; i++) {
      let r = 0;
      for (let b = 0; b < bits; b++) r |= ((i >> b) & 1) << (bits - 1 - b);
      this.reverse[i] = r;
    }
  }

  /**
   * Magnitude spectrum of a real-valued block, length `size / 2 + 1`.
   * The input is consumed as-is; apply a window first.
   */
  magnitudes(input: Float32Array, out?: Float32Array): Float32Array {
    const { size, re, im, reverse, cosTable, sinTable } = this;
    if (input.length !== size) {
      throw new Error(`Expected ${size} samples, got ${input.length}`);
    }

    for (let i = 0; i < size; i++) {
      re[reverse[i]] = input[i];
      im[reverse[i]] = 0;
    }

    for (let len = 2; len <= size; len <<= 1) {
      const step = size / len;
      const half = len >> 1;
      for (let i = 0; i < size; i += len) {
        for (let j = 0, k = 0; j < half; j++, k += step) {
          const c = cosTable[k];
          const s = sinTable[k];
          const a = i + j;
          const b = a + half;
          const tre = re[b] * c + im[b] * s;
          const tim = im[b] * c - re[b] * s;
          re[b] = re[a] - tre;
          im[b] = im[a] - tim;
          re[a] += tre;
          im[a] += tim;
        }
      }
    }

    const bins = size / 2 + 1;
    const mags = out ?? new Float32Array(bins);
    for (let i = 0; i < bins; i++) {
      mags[i] = Math.sqrt(re[i] * re[i] + im[i] * im[i]);
    }
    return mags;
  }
}

/** Periodic Hann window of the given length. */
export function hannWindow(size: number): Float32Array {
  const w = new Float32Array(size);
  for (let i = 0; i < size; i++) {
    w[i] = 0.5 * (1 - Math.cos((2 * Math.PI * i) / size));
  }
  return w;
}

/** Multiply a block by a window, writing into `out` (or a fresh array). */
export function applyWindow(
  block: Float32Array,
  window: Float32Array,
  out?: Float32Array,
): Float32Array {
  const dst = out ?? new Float32Array(block.length);
  for (let i = 0; i < block.length; i++) dst[i] = block[i] * window[i];
  return dst;
}

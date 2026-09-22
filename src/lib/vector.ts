/** Small vector helpers shared by the chroma templates and the detector. */

/** Scale a vector to unit L2 length. Returns a zero vector unchanged. */
export function l2Normalize(v: Float32Array): Float32Array {
  let sum = 0;
  for (let i = 0; i < v.length; i++) sum += v[i] * v[i];
  const norm = Math.sqrt(sum);
  if (norm === 0) return v;
  const out = new Float32Array(v.length);
  for (let i = 0; i < v.length; i++) out[i] = v[i] / norm;
  return out;
}

/**
 * Cosine similarity in 0..1 for non-negative vectors (which chroma always is).
 * Returns 0 when either vector is all zeros.
 */
export function cosineSimilarity(a: Float32Array, b: Float32Array): number {
  let dot = 0;
  let na = 0;
  let nb = 0;
  const n = Math.min(a.length, b.length);
  for (let i = 0; i < n; i++) {
    dot += a[i] * b[i];
    na += a[i] * a[i];
    nb += b[i] * b[i];
  }
  if (na === 0 || nb === 0) return 0;
  return dot / (Math.sqrt(na) * Math.sqrt(nb));
}

/** Index of the largest element. Returns -1 for an empty vector. */
export function argMax(v: Float32Array | number[]): number {
  let best = -1;
  let bestVal = -Infinity;
  for (let i = 0; i < v.length; i++) {
    if (v[i] > bestVal) {
      bestVal = v[i];
      best = i;
    }
  }
  return best;
}

/** Root-mean-square level of a signal block. */
export function rms(samples: Float32Array): number {
  let sum = 0;
  for (let i = 0; i < samples.length; i++) sum += samples[i] * samples[i];
  return Math.sqrt(sum / samples.length);
}

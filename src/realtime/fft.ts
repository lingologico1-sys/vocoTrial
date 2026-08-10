/**
 * A radix-2 Cooley-Tukey FFT.
 *
 * Here because the scheduled mouth driver has to measure audio an AnalyserNode
 * cannot reach: PCM that has arrived but has not been played yet. The analyser
 * only ever reports on sound that has already gone past, which is precisely the
 * limitation that driver exists to remove — so its spectrum has to be computed
 * by hand.
 *
 * Small and unoptimised on purpose. It runs a few hundred times a second at
 * most, on windows of 512 samples, in the same task that was already copying
 * the audio into a buffer.
 */
export class Fft {
  private readonly cos: Float32Array;
  private readonly sin: Float32Array;
  /** Bit-reversal permutation, precomputed once per size. */
  private readonly reversed: Uint32Array;

  constructor(readonly size: number) {
    if (size < 2 || (size & (size - 1)) !== 0) {
      throw new Error(`FFT size must be a power of two, not ${size}`);
    }

    const half = size / 2;
    this.cos = new Float32Array(half);
    this.sin = new Float32Array(half);
    for (let i = 0; i < half; i++) {
      this.cos[i] = Math.cos((2 * Math.PI * i) / size);
      this.sin[i] = Math.sin((2 * Math.PI * i) / size);
    }

    const bits = Math.log2(size);
    this.reversed = new Uint32Array(size);
    for (let i = 0; i < size; i++) {
      let r = 0;
      for (let b = 0; b < bits; b++) if (i & (1 << b)) r |= 1 << (bits - 1 - b);
      this.reversed[i] = r;
    }
  }

  /** In place. Both arrays must be `size` long; `im` is zeroed for real input. */
  transform(re: Float32Array, im: Float32Array): void {
    const n = this.size;

    for (let i = 0; i < n; i++) {
      const j = this.reversed[i];
      if (i < j) {
        let swap = re[i];
        re[i] = re[j];
        re[j] = swap;
        swap = im[i];
        im[i] = im[j];
        im[j] = swap;
      }
    }

    for (let len = 2; len <= n; len <<= 1) {
      const half = len >> 1;
      const step = n / len;
      for (let start = 0; start < n; start += len) {
        for (let j = 0; j < half; j++) {
          const k = j * step;
          const wr = this.cos[k];
          // Negated: the forward transform uses e^(-2πi k/n).
          const wi = -this.sin[k];
          const a = start + j;
          const b = a + half;
          const tr = re[b] * wr - im[b] * wi;
          const ti = re[b] * wi + im[b] * wr;
          re[b] = re[a] - tr;
          im[b] = im[a] - ti;
          re[a] += tr;
          im[a] += ti;
        }
      }
    }
  }
}

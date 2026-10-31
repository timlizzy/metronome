// Overlap-Add time-stretch AudioWorklet processor.
// Reads from a shared Float32Array (transferred via SharedArrayBuffer or passed at construction),
// produces output at a rate controlled by stretchFactor.
// stretchFactor < 1 = slower (spread out), > 1 = faster (compressed), pitch unchanged.

const FRAME   = 2048   // analysis window
const HOP_OUT = 512    // output hop (fixed)

class OLAProcessor extends AudioWorkletProcessor {
  constructor(options) {
    super()
    const d = options.processorOptions
    // Reconstruct Float32Array from transferred ArrayBuffer
    this._samples    = new Float32Array(d.buffer)
    this._sampleRate = d.sampleRate
    this._stretch    = d.stretch   // initial stretch factor
    this._readPos    = 0           // fractional read position in source
    this._outBuf     = new Float32Array(FRAME * 2)
    this._outPos     = 0
    this._outFilled  = 0
    this._done       = false
    this._window     = new Float32Array(FRAME)

    // Hann window
    for (let i = 0; i < FRAME; i++) {
      this._window[i] = 0.5 * (1 - Math.cos(2 * Math.PI * i / (FRAME - 1)))
    }

    this.port.onmessage = (e) => {
      if (e.data.type === 'stretch') this._stretch = e.data.value
      if (e.data.type === 'stop')    this._done = true
    }
  }

  process(_inputs, outputs) {
    if (this._done) return false

    const out = outputs[0][0]
    const src = this._samples
    const len = src.length
    const hopIn = HOP_OUT * this._stretch  // source hop — stretch by reading further ahead

    for (let i = 0; i < out.length; i++) {
      // Refill OLA output buffer when we've consumed a hop
      if (this._outPos >= HOP_OUT) {
        // Shift buffer left by HOP_OUT
        this._outBuf.copyWithin(0, HOP_OUT)
        this._outBuf.fill(0, this._outBuf.length - HOP_OUT)
        this._outPos -= HOP_OUT

        // Add next windowed grain at _outPos
        const srcStart = Math.round(this._readPos)
        for (let j = 0; j < FRAME; j++) {
          const srcIdx = srcStart + j - FRAME / 2
          if (srcIdx >= 0 && srcIdx < len) {
            this._outBuf[this._outPos + j] = (this._outBuf[this._outPos + j] || 0)
              + src[srcIdx] * this._window[j]
          }
        }

        this._readPos += hopIn

        if (this._readPos >= len) {
          this._done = true
          this.port.postMessage({ type: 'ended' })
        }
      }

      out[i] = this._outBuf[this._outPos++]
    }

    return !this._done
  }
}

registerProcessor('ola-processor', OLAProcessor)

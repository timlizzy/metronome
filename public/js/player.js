const BYPASS_THRESHOLD = 0.02  // use direct playback within ±2% of 1×

export class Player {
  constructor(getAudioCtx) {
    this._getCtx = getAudioCtx
    this._workletReady = false
    this._node = null      // AudioWorkletNode when stretching
    this._source = null    // AudioBufferSourceNode when bypassed
    this._lastSamples = null
    this._lastSampleRate = null
    this.onEnded = null
  }

  get _audioCtx() { return this._getCtx() }

  async _ensureWorklet() {
    if (this._workletReady) return
    await this._audioCtx.audioWorklet.addModule('/js/ola-worklet.js')
    this._workletReady = true
  }

  _isBypass(factor) {
    return Math.abs(factor - 1.0) < BYPASS_THRESHOLD
  }

  async play(samples, sampleRate, stretchFactor = 1.0) {
    const ctx = this._audioCtx
    await ctx.resume()
    this.stop()

    this._lastSamples = samples
    this._lastSampleRate = sampleRate

    if (this._isBypass(stretchFactor)) {
      await this._playDirect(ctx, samples, sampleRate)
    } else {
      await this._playOLA(ctx, samples, sampleRate, stretchFactor)
    }
  }

  async _playDirect(ctx, samples, sampleRate) {
    const buf = ctx.createBuffer(1, samples.length, sampleRate)
    buf.copyToChannel(samples, 0)

    const src = ctx.createBufferSource()
    src.buffer = buf
    src.connect(ctx.destination)
    src.onended = () => {
      this._source = null
      this.onEnded?.()
    }
    src.start()
    this._source = src
  }

  async _playOLA(ctx, samples, sampleRate, stretchFactor) {
    await this._ensureWorklet()

    const copy = samples.buffer.slice(0)
    const node = new AudioWorkletNode(ctx, 'ola-processor', {
      numberOfInputs:  0,
      numberOfOutputs: 1,
      outputChannelCount: [1],
      processorOptions: { buffer: copy, sampleRate, stretch: stretchFactor },
    })

    node.port.onmessage = (e) => {
      if (e.data.type === 'ended') {
        this._node = null
        this.onEnded?.()
      }
    }

    node.connect(ctx.destination)
    this._node = node
  }

  setStretch(factor) {
    if (!this.isPlaying()) return

    const wasOLA    = this._node !== null
    const willOLA   = !this._isBypass(factor)

    if (wasOLA && willOLA) {
      // Already in OLA — just update the rate
      this._node.port.postMessage({ type: 'stretch', value: factor })
    } else if (wasOLA !== willOLA) {
      // Crossing the bypass boundary — restart with correct path
      const samples    = this._lastSamples
      const sampleRate = this._lastSampleRate
      if (samples) this.play(samples, sampleRate, factor)
    }
    // bypass→bypass: nothing to do, AudioBufferSourceNode plays at 1× always
  }

  stop() {
    if (this._node) {
      this._node.port.postMessage({ type: 'stop' })
      try { this._node.disconnect() } catch {}
      this._node = null
    }
    if (this._source) {
      try { this._source.stop() } catch {}
      try { this._source.disconnect() } catch {}
      this._source = null
    }
  }

  isPlaying() {
    return this._node !== null || this._source !== null
  }
}

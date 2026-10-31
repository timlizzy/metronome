import { findAttack } from './onset.js'

export class Recorder {
  constructor(audioCtx) {
    this.audioCtx = audioCtx
    this.stream = null
    this.sourceNode = null
    this.processor = null
    this.silentGain = null
    this.chunks = []
    this.recording = false
    this.startAudioTime = 0
    this.sampleRate = 0
    this.ready = false
    this._rollingBuf = null
    this._rollingWrite = 0
    this._rollingSize = 0
    // Instead of counting samples, track the audioCtx time of each buffer
    this._latestBufferEndTime = 0
    this._latestBufferEndSample = 0
  }

  async enable(bufferSize = 4096) {
    this.stream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false })
    this.sampleRate = this.audioCtx.sampleRate
    this._rollingSize = Math.ceil(this.sampleRate * 2)
    this._rollingBuf = new Float32Array(this._rollingSize)

    this.sourceNode = this.audioCtx.createMediaStreamSource(this.stream)

    this.processor = this.audioCtx.createScriptProcessor(bufferSize, 1, 1)
    this.processor.onaudioprocess = (e) => {
      const data = e.inputBuffer.getChannelData(0)
      const bufLen = data.length
      this._writeRolling(data)

      // playbackTime = audioCtx time of the first sample in this buffer
      const playbackTime = e.playbackTime
      this._latestBufferEndTime = playbackTime + bufLen / this.sampleRate
      this._latestBufferEndSample = this._rollingWrite

      if (!this.recording) return

      // On the very first chunk, record exact audio time of buffer start
      if (this.chunks.length === 0) {
        this._firstChunkAudioTime = playbackTime
      }
      this.chunks.push(new Float32Array(data))
    }

    this.silentGain = this.audioCtx.createGain()
    this.silentGain.gain.value = 0

    this.sourceNode.connect(this.processor)
    this.processor.connect(this.silentGain)
    this.silentGain.connect(this.audioCtx.destination)

    this.ready = true
  }

  _writeRolling(data) {
    for (let i = 0; i < data.length; i++) {
      this._rollingBuf[this._rollingWrite % this._rollingSize] = data[i]
      this._rollingWrite++
    }
  }

  // Convert an audioCtx time to a rolling-buffer sample position using the
  // most recent buffer's known time anchor — avoids clock drift between
  // sample-counting and audioCtx.currentTime.
  _audioTimeToSamplePos(audioTime) {
    return this._latestBufferEndSample -
      Math.round((this._latestBufferEndTime - audioTime) * this.sampleRate)
  }

  findOnsetOffsetNearBeat(beatAudioTime, windowSecs = 0.25) {
    if (!this._rollingBuf || this._rollingWrite === 0) return null
    if (this._latestBufferEndTime === 0) return null

    const sr = this.sampleRate
    const beatSamplePos = this._audioTimeToSamplePos(beatAudioTime)
    const windowSamples = Math.round(windowSecs * sr)
    const searchStart = beatSamplePos - windowSamples
    const searchEnd = beatSamplePos + windowSamples

    const len = searchEnd - searchStart
    if (len <= 0 || len > this._rollingSize) return null
    const region = new Float32Array(len)
    for (let i = 0; i < len; i++) {
      const pos = searchStart + i
      if (pos < 0 || pos >= this._rollingWrite) continue
      region[i] = this._rollingBuf[pos % this._rollingSize]
    }

    const attackIdx = findAttack(region)
    if (attackIdx < 0) return null

    const offsetSamples = (searchStart + attackIdx) - beatSamplePos
    return offsetSamples / sr
  }

  startRecording(startAudioTime) {
    if (!this.ready) return
    this.chunks = []
    this.startAudioTime = startAudioTime
    this._firstChunkAudioTime = null
    this.recording = true
  }

  stopRecording() {
    this.recording = false
    if (this.chunks.length === 0) return null

    const total = this.chunks.reduce((s, c) => s + c.length, 0)
    const buffer = new Float32Array(total)
    let offset = 0
    for (const chunk of this.chunks) {
      buffer.set(chunk, offset)
      offset += chunk.length
    }

    // Use the exact playbackTime of the first captured chunk as the audio time
    // of sample 0. This is more accurate than startAudioTime because it accounts
    // for ScriptProcessorNode buffer alignment — no guessing needed.
    const bufferStartTime = this._firstChunkAudioTime ?? this.startAudioTime

    return {
      samples: buffer,
      sampleRate: this.sampleRate,
      startAudioTime: bufferStartTime,
    }
  }

  isReady() {
    return this.ready
  }

  disable() {
    this.recording = false
    if (this.stream) {
      this.stream.getTracks().forEach(t => t.stop())
      this.stream = null
    }
    if (this.sourceNode) { this.sourceNode.disconnect(); this.sourceNode = null }
    if (this.processor) { this.processor.disconnect(); this.processor = null }
    this.ready = false
  }
}

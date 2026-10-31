const SCHEDULE_AHEAD = 0.1  // seconds to schedule ahead
const ACCENT_FREQ = 1000    // Hz for beat 0 of each bar
const BEAT_FREQ = 800       // Hz for other beats
const COUNTIN_FREQ = 1400   // Hz for count-in clicks (higher, woodblock-ish)
const CLICK_DURATION = 0.04 // seconds

export class Metronome {
  constructor() {
    this.audioCtx = null
    this.worker = new Worker('/js/worker.js')
    this.listeners = []
    this.running = false
    this.nextBeatTime = 0
    this.currentBeat = 0
    this.pattern = null
    this.startTime = 0       // audioCtx time when real beat 0 fires
    this._countInBeats = 0   // number of count-in beats remaining to schedule
    this._inCountIn = false

    this.worker.onmessage = () => {
      if (this.running) this._scheduler()
    }
  }

  on(fn) {
    this.listeners.push(fn)
  }

  off(fn) {
    this.listeners = this.listeners.filter(l => l !== fn)
  }

  _emit(beat, scheduledTime, countIn = false) {
    for (const fn of this.listeners) fn({ beat, scheduledTime, countIn })
  }

  // countIn: if true, play one bar of count-in clicks before beat 0
  async start(pattern, countIn = false) {
    if (this.running) this.stop()

    if (!this.audioCtx) {
      this.audioCtx = new AudioContext()
    }
    await this.audioCtx.resume()

    this.pattern = pattern
    this.running = true
    this.currentBeat = 0
    this.nextBeatTime = this.audioCtx.currentTime + 0.05

    if (countIn) {
      // Count-in uses quarter-note spacing regardless of subdivision,
      // always 4 beats (one 4/4 bar worth of quarter notes)
      const quarterDuration = 60 / pattern.bpm
      this._countInBeats = 4
      this._inCountIn = true
      this._countInBeatDuration = quarterDuration
      this._countInNextTime = this.nextBeatTime
      // Real pattern starts after the 4 count-in beats
      this.startTime = this.nextBeatTime + 4 * quarterDuration
    } else {
      this._countInBeats = 0
      this._inCountIn = false
      this.startTime = this.nextBeatTime
    }

    this.worker.postMessage('start')
    this._scheduler()

    return this.startTime
  }

  stop() {
    this.running = false
    this._inCountIn = false
    this._countInBeats = 0
    this.worker.postMessage('stop')
  }

  getStartTime() {
    return this.startTime
  }

  updatePattern(pattern) {
    this.pattern = pattern
  }

  _beatDuration() {
    const { bpm, subdivision } = this.pattern
    const subdivisionsPerBeat = {
      quarter: 1,
      eighth: 2,
      sixteenth: 4,
      triplet: 3,
    }[subdivision]
    return 60 / (bpm * subdivisionsPerBeat)
  }

  _totalBeats() {
    const { bars, subdivision } = this.pattern
    const beatsPerBar = { quarter: 4, eighth: 8, sixteenth: 16, triplet: 12 }[subdivision]
    return bars * beatsPerBar
  }

  _scheduler() {
    const lookAheadUntil = this.audioCtx.currentTime + SCHEDULE_AHEAD

    // Drain count-in beats first
    while (this._inCountIn && this._countInBeats > 0 && this._countInNextTime < lookAheadUntil) {
      const countInIndex = 4 - this._countInBeats  // 0,1,2,3
      this._scheduleCountIn(countInIndex, this._countInNextTime)
      this._emit(-1, this._countInNextTime, true)
      this._countInNextTime += this._countInBeatDuration
      this._countInBeats--
      if (this._countInBeats === 0) {
        // Hand off: real pattern starts at startTime
        this._inCountIn = false
        this.nextBeatTime = this.startTime
      }
    }

    if (this._inCountIn) return  // still in count-in, don't schedule real beats yet

    while (this.nextBeatTime < lookAheadUntil) {
      const beat = this.currentBeat
      const time = this.nextBeatTime

      if (this.pattern.activeBeats.has(beat)) {
        this._scheduleClick(beat, time)
      }

      this._emit(beat, time, false)

      this.nextBeatTime += this._beatDuration()
      this.currentBeat = (this.currentBeat + 1) % this._totalBeats()
    }
  }

  _scheduleCountIn(index, time) {
    const isFirst = index === 0
    const osc = this.audioCtx.createOscillator()
    const gain = this.audioCtx.createGain()

    // Square wave for a woodblock-ish timbre
    osc.type = 'square'
    osc.frequency.value = isFirst ? COUNTIN_FREQ * 1.25 : COUNTIN_FREQ

    gain.gain.setValueAtTime(isFirst ? 0.35 : 0.25, time)
    gain.gain.exponentialRampToValueAtTime(0.001, time + CLICK_DURATION * 0.8)

    osc.connect(gain)
    gain.connect(this.audioCtx.destination)
    osc.start(time)
    osc.stop(time + CLICK_DURATION)
  }

  _scheduleClick(beat, time) {
    const { subdivision } = this.pattern
    const beatsPerBar = { quarter: 4, eighth: 8, sixteenth: 16, triplet: 12 }[subdivision]
    const isAccent = beat % beatsPerBar === 0

    const osc = this.audioCtx.createOscillator()
    const gain = this.audioCtx.createGain()

    osc.type = 'sine'
    osc.frequency.value = isAccent ? ACCENT_FREQ : BEAT_FREQ

    gain.gain.setValueAtTime(isAccent ? 1.0 : 0.7, time)
    gain.gain.exponentialRampToValueAtTime(0.001, time + CLICK_DURATION)

    osc.connect(gain)
    gain.connect(this.audioCtx.destination)

    osc.start(time)
    osc.stop(time + CLICK_DURATION + 0.01)
  }
}

import { Metronome } from './metronome.js'
import { Grid } from './grid.js'
import { Recorder } from './recorder.js'
import { Visualizer } from './visualizer.js'
import { Player } from './player.js'

// ── State ─────────────────────────────────────────────────────────────────────
let beatSchedule = []
let recordingEnabled = false
let autoStopTimeout = null
let recordingStarted = false
let lastRecording = null   // { samples, sampleRate } from most recent stopRecording()

// ── DOM refs ──────────────────────────────────────────────────────────────────
const bpmRange   = document.getElementById('bpm')
const bpmDisplay = document.getElementById('bpm-display')
const subSel     = document.getElementById('subdivision')
const barsInput  = document.getElementById('bars')
const btnStart   = document.getElementById('btn-start')
const btnStop    = document.getElementById('btn-stop')
const btnMic     = document.getElementById('btn-enable-mic')
const recordToggle = document.getElementById('record-toggle')
const repeatInput  = document.getElementById('repeat-bars')
const waveSection  = document.getElementById('waveform-section')
const statusEl     = document.getElementById('status')
const gridContainer = document.getElementById('grid-container')
const barCounter   = document.getElementById('bar-counter')
const barNumber    = document.getElementById('bar-number')
const barTotal     = document.getElementById('bar-total')
const zoomRange    = document.getElementById('zoom-range')
const zoomDisplay  = document.getElementById('zoom-display')
const btnZoomIn    = document.getElementById('btn-zoom-in')
const btnZoomOut   = document.getElementById('btn-zoom-out')
const btnZoomFit   = document.getElementById('btn-zoom-fit')
const scrollWrapper = document.getElementById('waveform-scroll-wrapper')
const timingIndicator = document.getElementById('timing-indicator')
const timingNeedle    = document.getElementById('timing-needle')
const timingValue     = document.getElementById('timing-value')
const timingHistory   = document.getElementById('timing-history')
const hiresToggle     = document.getElementById('hires-toggle')

// Playback controls
const btnPlay        = document.getElementById('btn-play')
const btnPlayStop    = document.getElementById('btn-play-stop')
const stretchRange   = document.getElementById('stretch-range')
const stretchDisplay = document.getElementById('stretch-display')
const btnStretchHalf = document.getElementById('btn-stretch-half')
const btnStretch1    = document.getElementById('btn-stretch-1')
const btnStretch2    = document.getElementById('btn-stretch-2')

// ── Timing indicator ──────────────────────────────────────────────────────────
const WINDOW_SECS = 0.15   // search ±150ms around each beat (matches visualizer)
const MAX_DISPLAY_MS = 200 // needle spans ±200ms full scale
const MAX_HISTORY = 32

function updateTimingDisplay(offsetSec) {
  const ms = Math.round(offsetSec * 1000)
  const aboveThreshold = Math.abs(ms) > 8  // within 8ms counts as "on"

  // Needle position: 50% = centre, clamped ±MAX_DISPLAY_MS
  const frac = Math.max(-1, Math.min(1, offsetSec * 1000 / MAX_DISPLAY_MS))
  const pct = 50 + frac * 48  // 2–98% to stay inside border
  timingNeedle.style.left = pct + '%'

  const color = !aboveThreshold ? '#4ade80'       // green = on beat
              : offsetSec < 0   ? '#60a5fa'        // blue  = early
                                : '#f87171'        // red   = late
  timingNeedle.style.background = color

  if (!aboveThreshold) {
    timingValue.textContent = 'On beat'
    timingValue.style.color = '#4ade80'
  } else {
    const sign = offsetSec < 0 ? '−' : '+'
    timingValue.textContent = `${sign}${Math.abs(ms)} ms  ${offsetSec < 0 ? 'early' : 'late'}`
    timingValue.style.color = color
  }

  // History dots: height proportional to offset, colour coded
  const dot = document.createElement('div')
  dot.className = 'timing-dot'
  const heightPct = Math.max(15, Math.min(100, Math.abs(ms) / MAX_DISPLAY_MS * 100))
  dot.style.height = heightPct + '%'
  dot.style.background = color
  dot.title = `${offsetSec < 0 ? '−' : '+'}${Math.abs(ms)} ms`
  timingHistory.appendChild(dot)
  // Keep only the last MAX_HISTORY dots
  while (timingHistory.children.length > MAX_HISTORY) {
    timingHistory.removeChild(timingHistory.firstChild)
  }
}

function resetTimingDisplay() {
  timingNeedle.style.left = '50%'
  timingNeedle.style.background = 'var(--green)'
  timingValue.textContent = '—'
  timingValue.style.color = 'var(--green)'
  timingHistory.innerHTML = ''
}

// ── Module init ───────────────────────────────────────────────────────────────
const metronome = new Metronome()

const grid = new Grid(gridContainer, () => {
  if (metronome.running) metronome.updatePattern(grid.getPattern())
})

let recorder = null
const player  = new Player(() => {
  // Lazily create AudioContext if the metronome hasn't yet
  if (!metronome.audioCtx) metronome.audioCtx = new AudioContext()
  return metronome.audioCtx
})

const visualizer = new Visualizer(document.getElementById('waveform-canvas'), scrollWrapper)

// ── BPM control ───────────────────────────────────────────────────────────────
bpmRange.addEventListener('input', () => {
  bpmDisplay.textContent = bpmRange.value
  grid.state.bpm = parseInt(bpmRange.value)
  if (metronome.running) metronome.updatePattern(grid.getPattern())
})

// ── Subdivision ───────────────────────────────────────────────────────────────
subSel.addEventListener('change', () => grid.setSubdivision(subSel.value))

// ── Bars ──────────────────────────────────────────────────────────────────────
barsInput.addEventListener('change', () => grid.setBars(parseInt(barsInput.value)))

// ── Mic enable ────────────────────────────────────────────────────────────────
btnMic.addEventListener('click', async () => {
  try {
    if (!metronome.audioCtx) {
      metronome.audioCtx = new AudioContext()
      await metronome.audioCtx.resume()
    }
    const bufferSize = hiresToggle.checked ? 512 : 4096
    recorder = new Recorder(metronome.audioCtx)
    await recorder.enable(bufferSize)
    const resLabel = hiresToggle.checked ? ' (high-res, ~12 ms)' : ' (~93 ms)'
    btnMic.textContent = 'Mic enabled ✓'
    hiresToggle.disabled = true  // can't change after enabling
    btnMic.disabled = true
    recordToggle.disabled = false
    setStatus(`Microphone enabled${resLabel}. Check "Record" and press Start.`)
  } catch (err) {
    setStatus('Microphone access denied: ' + err.message, true)
  }
})

// ── Record toggle ─────────────────────────────────────────────────────────────
recordToggle.addEventListener('change', () => {
  recordingEnabled = recordToggle.checked
})

// ── Zoom controls ─────────────────────────────────────────────────────────────
function applyZoom(z) {
  z = Math.max(1, Math.min(32, z))
  visualizer.setZoom(z)
  zoomRange.value = z
  zoomDisplay.textContent = z % 1 === 0 ? z + '×' : z.toFixed(1) + '×'
}

zoomRange.addEventListener('input', () => applyZoom(parseFloat(zoomRange.value)))
btnZoomIn.addEventListener('click',  () => applyZoom(parseFloat(zoomRange.value) * 2))
btnZoomOut.addEventListener('click', () => applyZoom(parseFloat(zoomRange.value) / 2))
btnZoomFit.addEventListener('click', () => applyZoom(1))

// ── Start ─────────────────────────────────────────────────────────────────────
btnStart.addEventListener('click', async () => {
  beatSchedule = []
  visualizer.clear()
  waveSection.hidden = true
  applyZoom(1)
  recordingStarted = false

  const pattern = grid.getPattern()
  if (pattern.activeBeats.size === 0) {
    setStatus('Activate at least one beat in the grid first.', true)
    return
  }

  const repeatBars = parseInt(repeatInput.value) || 0
  const doCountIn = recordingEnabled && recorder && recorder.isReady()

  // Show bar counter — hide it until count-in is done
  barTotal.textContent = repeatBars > 0 ? repeatBars : '∞'
  barNumber.textContent = '1'
  barCounter.hidden = doCountIn  // revealed on first real beat

  if (doCountIn) {
    resetTimingDisplay()
    timingIndicator.hidden = false
  } else {
    timingIndicator.hidden = true
  }

  const startTime = await metronome.start(pattern, doCountIn)

  if (doCountIn) {
    setStatus('Count in…')
    // startRecording is deferred — called when the first real beat fires (see beat listener)
  } else {
    setStatus('Playing…')
  }

  btnStart.disabled = true
  btnStop.disabled = false

  // Auto-stop after N repeated bars (measured from real beat 0, not count-in)
  if (repeatBars > 0 && recordingEnabled) {
    const { bpm, subdivision, bars } = pattern
    const beatsPerBar = { quarter: 4, eighth: 8, sixteenth: 16, triplet: 12 }[subdivision]
    const subdivisionsPerBeat = { quarter: 1, eighth: 2, sixteenth: 4, triplet: 3 }[subdivision]
    const beatDuration = 60 / (bpm * subdivisionsPerBeat)
    const totalDuration = repeatBars * bars * beatsPerBar * beatDuration * 1000
    const countInDuration = doCountIn ? (60 / bpm) * 4 * 1000 : 0
    autoStopTimeout = setTimeout(() => {
      if (metronome.running) stopAll()
    }, countInDuration + totalDuration + 200)
  }
})

// ── Stop ──────────────────────────────────────────────────────────────────────
btnStop.addEventListener('click', stopAll)

function stopAll() {
  clearTimeout(autoStopTimeout)
  metronome.stop()
  barCounter.hidden = true
  timingIndicator.hidden = true

  btnStart.disabled = false
  btnStop.disabled = true

  if (recordingEnabled && recorder && recorder.isReady()) {
    const result = recorder.stopRecording()
    if (result && result.samples.length > 0) {
      lastRecording = result
      waveSection.hidden = false
      setPlaybackBusy(false)
      const { subdivision, bars, activeBeats } = grid.getPattern()
      visualizer.draw(
        result.samples,
        result.sampleRate,
        beatSchedule,
        result.startAudioTime,
        subdivision,
        bars,
        activeBeats
      )
      setStatus(`Recording complete — ${(result.samples.length / result.sampleRate).toFixed(1)}s captured.`)
    } else {
      setStatus('Stopped. No audio captured.')
    }
  } else {
    setStatus('Stopped.')
  }
}

// ── Beat events ───────────────────────────────────────────────────────────────
metronome.on(({ beat, scheduledTime, countIn }) => {
  if (countIn) return  // don't record count-in beats on the schedule
  beatSchedule.push({ beat, scheduledTime })
})

// Start recording and reveal bar counter on the first real beat (beat 0 after count-in)
metronome.on(({ beat, scheduledTime, countIn }) => {
  if (countIn || beat !== 0 || recordingStarted) return
  if (recordingEnabled && recorder && recorder.isReady()) {
    recordingStarted = true
    const now = metronome.audioCtx?.currentTime ?? 0
    const delay = Math.max(0, (scheduledTime - now) * 1000)
    setTimeout(() => {
      recorder.startRecording(scheduledTime)
      setStatus('Playing + recording…')
      barCounter.hidden = false
    }, delay)
  }
})

// Bar counter update — fires at the actual audio time of each bar start
metronome.on(({ beat, scheduledTime, countIn }) => {
  if (countIn) return
  const { subdivision } = grid.getPattern()
  const beatsPerBar = { quarter: 4, eighth: 8, sixteenth: 16, triplet: 12 }[subdivision]
  if (beat % beatsPerBar !== 0) return
  const displayBar = beatSchedule.filter(b => b.beat % beatsPerBar === 0).length
  const now = metronome.audioCtx?.currentTime ?? 0
  const delay = Math.max(0, (scheduledTime - now) * 1000)
  setTimeout(() => { barNumber.textContent = displayBar }, delay)
})

// Visual beat flash
metronome.on(({ beat, scheduledTime, countIn }) => {
  if (countIn) return
  const { subdivision } = grid.getPattern()
  const beatsPerBar = { quarter: 4, eighth: 8, sixteenth: 16, triplet: 12 }[subdivision]
  const isAccent = beat % beatsPerBar === 0
  const now = metronome.audioCtx?.currentTime ?? 0
  const delay = Math.max(0, (scheduledTime - now) * 1000)
  setTimeout(() => {
    const cell = gridContainer.querySelector(`.beat-cell[data-index="${beat}"]`)
    if (!cell) return
    cell.classList.add(isAccent ? 'flash-accent' : 'flash')
    setTimeout(() => cell.classList.remove('flash', 'flash-accent'), 120)
  }, delay)
})

// Live timing feedback — check each active beat for a nearby onset
metronome.on(({ beat, scheduledTime, countIn }) => {
  if (countIn || !recordingStarted || !recorder) return
  // Only measure on active beats — unselected beats have no expected hit
  if (!grid.getPattern().activeBeats.has(beat)) return

  const now = metronome.audioCtx?.currentTime ?? 0
  const beatDelay = Math.max(0, (scheduledTime - now) * 1000)
  // Extra margin = 2 ScriptProcessor buffer lengths to ensure audio has arrived
  const bufSize = hiresToggle.checked ? 512 : 4096
  const spLatencyMs = (bufSize / (metronome.audioCtx?.sampleRate ?? 44100)) * 2 * 1000
  const measureDelay = beatDelay + WINDOW_SECS * 1000 + spLatencyMs

  setTimeout(() => {
    const offset = recorder.findOnsetOffsetNearBeat(scheduledTime, WINDOW_SECS)
    if (offset !== null) updateTimingDisplay(offset)
  }, measureDelay)
})

// ── Playback / time-stretch ───────────────────────────────────────────────────
function setStretch(v) {
  v = Math.max(0.25, Math.min(2, v))
  stretchRange.value = v
  stretchDisplay.textContent = v.toFixed(2) + '×'
  player.setStretch(v)
}

function setPlaybackBusy(playing) {
  btnPlay.disabled     = playing
  btnPlayStop.disabled = !playing
}

player.onEnded = () => setPlaybackBusy(false)

btnPlay.addEventListener('click', async () => {
  if (!lastRecording) return
  setPlaybackBusy(true)
  const stretch = parseFloat(stretchRange.value)
  await player.play(lastRecording.samples, lastRecording.sampleRate, stretch)
})

btnPlayStop.addEventListener('click', () => {
  player.stop()
  setPlaybackBusy(false)
})

stretchRange.addEventListener('input', () => {
  stretchDisplay.textContent = parseFloat(stretchRange.value).toFixed(2) + '×'
  player.setStretch(parseFloat(stretchRange.value))
})

btnStretchHalf.addEventListener('click', () => setStretch(0.5))
btnStretch1.addEventListener('click',    () => setStretch(1.0))
btnStretch2.addEventListener('click',    () => setStretch(2.0))

// ── Helper ────────────────────────────────────────────────────────────────────
function setStatus(msg, isError = false) {
  statusEl.textContent = msg
  statusEl.className = isError ? 'status error' : 'status'
}

import { findAttack } from './onset.js'

const WAVEFORM_COLOR = '#4ade80'
const BEAT_COLOR = 'rgba(148, 163, 184, 0.25)'
const BEAT_ACTIVE_COLOR = 'rgba(148, 163, 184, 0.85)'
const ACCENT_ACTIVE_COLOR = 'rgba(251, 191, 36, 1.0)'
const BAR_LABEL_COLOR = 'rgba(251, 191, 36, 0.7)'
const ONSET_COLOR = '#f472b6'
const BG_COLOR = '#0f172a'
const ANNOT_BG = '#0a111e'   // slightly different shade for annotation strip

// Layout
const ANNOT_H = 34   // pixels reserved at bottom for offset annotations
const GAIN = 0.92    // fraction of waveform zone used for amplitude

// Global onset detection (pink triangles)
const ONSET_WINDOW = 512
const ONSET_HOP = 128
const ONSET_THRESHOLD = 1.8
const ONSET_MIN_GAP = 0.06

// Per-beat offset measurement — detection params live in onset.js (shared)
const BEAT_SEARCH_WINDOW = 0.15

// Offset annotation colours
const OFF_EARLY = '#60a5fa'
const OFF_LATE  = '#f87171'
const OFF_ON    = '#4ade80'
const OFF_THRESHOLD_MS = 8

export class Visualizer {
  constructor(canvas, scrollWrapper) {
    this.canvas = canvas
    this.wrapper = scrollWrapper
    this.ctx = canvas.getContext('2d')
    this.zoom = 1
    this._lastDrawArgs = null
  }

  setZoom(z) {
    this.zoom = Math.max(1, z)
    if (this._lastDrawArgs) this._redraw()
  }

  _canvasHeight() { return 250 }

  _resize(totalWidthPx) {
    const dpr = window.devicePixelRatio || 1
    const h = this._canvasHeight()
    this.canvas.width = totalWidthPx * dpr
    this.canvas.height = h * dpr
    this.canvas.style.width = totalWidthPx + 'px'
    this.canvas.style.height = h + 'px'
    this.ctx = this.canvas.getContext('2d')
    this.ctx.scale(dpr, dpr)
    this._cssW = totalWidthPx
    this._cssH = h
  }

  draw(samples, sampleRate, beatSchedule, startAudioTime, subdivision, bars, activeBeats) {
    this._lastDrawArgs = { samples, sampleRate, beatSchedule, startAudioTime, subdivision, bars, activeBeats }
    this._redraw()
  }

  _redraw() {
    const { samples, sampleRate, beatSchedule, startAudioTime, subdivision, bars, activeBeats } = this._lastDrawArgs

    const wrapperW = this.wrapper.clientWidth || 900
    const totalWidthPx = Math.round(wrapperW * this.zoom)
    this._resize(totalWidthPx)

    const ctx = this.ctx
    const cssW = this._cssW
    const cssH = this._cssH
    const total = samples.length

    // Two zones: waveform takes the top, annotations take the bottom strip
    const waveH   = cssH - ANNOT_H   // full height available for amplitude
    const centerY = waveH / 2
    const halfH   = waveH / 2 * GAIN // amplitude swing uses almost all of waveH

    // Backgrounds
    ctx.fillStyle = BG_COLOR
    ctx.fillRect(0, 0, cssW, waveH)
    ctx.fillStyle = ANNOT_BG
    ctx.fillRect(0, waveH, cssW, ANNOT_H)

    // Divider line between zones
    ctx.strokeStyle = 'rgba(100,116,139,0.25)'
    ctx.lineWidth = 1
    ctx.beginPath()
    ctx.moveTo(0, waveH)
    ctx.lineTo(cssW, waveH)
    ctx.stroke()

    if (total === 0) return

    const beatsPerBar = { quarter: 4, eighth: 8, sixteenth: 16, triplet: 12 }[subdivision]
    const onsets      = this._detectOnsets(samples, sampleRate)
    const beatOffsets = this._measureBeatOffsets(samples, sampleRate, beatSchedule, startAudioTime, activeBeats)

    // ── Beat / bar markers — confined to waveform zone ─────────────────────
    const seenBars = new Set()
    for (const { beat, scheduledTime } of beatSchedule) {
      const sampleIdx = (scheduledTime - startAudioTime) * sampleRate
      const x = (sampleIdx / total) * cssW
      if (x < 0 || x > cssW) continue

      const barNum    = Math.floor(beat / beatsPerBar)
      const isBarStart = beat % beatsPerBar === 0
      const isActive  = activeBeats ? activeBeats.has(beat) : true

      if (isBarStart) {
        // Full-height separator within waveform zone only
        ctx.strokeStyle = isActive ? 'rgba(100, 116, 139, 0.5)' : 'rgba(100, 116, 139, 0.15)'
        ctx.lineWidth = 1
        ctx.beginPath()
        ctx.moveTo(x, 0)
        ctx.lineTo(x, waveH)
        ctx.stroke()

        // Amber caps at top and bottom of waveform zone
        ctx.strokeStyle = isActive ? ACCENT_ACTIVE_COLOR : 'rgba(251, 191, 36, 0.3)'
        ctx.lineWidth = isActive ? 2.5 : 1
        ctx.beginPath()
        ctx.moveTo(x, 0);     ctx.lineTo(x, waveH * 0.22)
        ctx.moveTo(x, waveH * 0.78); ctx.lineTo(x, waveH)
        ctx.stroke()

        if (!seenBars.has(barNum)) {
          seenBars.add(barNum)
          ctx.fillStyle = isActive ? BAR_LABEL_COLOR : 'rgba(251, 191, 36, 0.3)'
          ctx.font = '11px system-ui, sans-serif'
          ctx.fillText(`${barNum + 1}`, x + 3, 12)
        }
      } else {
        const tickSpan = isActive ? waveH * 0.44 : waveH * 0.20
        ctx.strokeStyle = isActive ? BEAT_ACTIVE_COLOR : BEAT_COLOR
        ctx.lineWidth = isActive ? 1.5 : 1
        ctx.beginPath()
        ctx.moveTo(x, centerY - tickSpan / 2)
        ctx.lineTo(x, centerY + tickSpan / 2)
        ctx.stroke()
      }
    }

    // ── Waveform envelope — normalized to use full waveH ────────────────────
    ctx.fillStyle = WAVEFORM_COLOR
    const samplesPerPixel = total / cssW

    // Find peak so the loudest sample always fills the zone
    let peakAmplitude = 0
    for (let i = 0; i < total; i++) {
      const a = Math.abs(samples[i])
      if (a > peakAmplitude) peakAmplitude = a
    }
    if (peakAmplitude < 0.0001) peakAmplitude = 1  // all-silence guard

    for (let x = 0; x < cssW; x++) {
      const s = Math.floor(x * samplesPerPixel)
      const e = Math.min(Math.floor((x + 1) * samplesPerPixel), total)
      let min = 0, max = 0
      for (let i = s; i < e; i++) {
        const norm = samples[i] / peakAmplitude
        if (norm < min) min = norm
        if (norm > max) max = norm
      }
      const yTop = centerY - max * halfH
      const yBot = centerY - min * halfH
      ctx.fillRect(x, yTop, 1, Math.max(1, yBot - yTop))
    }

    // ── Center line ─────────────────────────────────────────────────────────
    ctx.strokeStyle = 'rgba(100,116,139,0.35)'
    ctx.lineWidth = 1
    ctx.beginPath()
    ctx.moveTo(0, centerY)
    ctx.lineTo(cssW, centerY)
    ctx.stroke()

    // ── Onset triangles — tip just above top of waveform ────────────────────
    for (const onsetSample of onsets) {
      const x = (onsetSample / total) * cssW
      if (x < 0 || x > cssW) continue
      this._drawTriangle(ctx, x, 2, 7, ONSET_COLOR)
    }

    // ── Per-beat offset annotations — in annotation zone ────────────────────
    this._drawBeatOffsets(ctx, beatOffsets, total, cssW, waveH)
  }

  _measureBeatOffsets(samples, sampleRate, beatSchedule, startAudioTime, activeBeats) {
    const results = []
    const windowSamples = Math.round(BEAT_SEARCH_WINDOW * sampleRate)

    for (const { beat, scheduledTime } of beatSchedule) {
      if (activeBeats && !activeBeats.has(beat)) continue

      const beatSample  = Math.round((scheduledTime - startAudioTime) * sampleRate)
      const searchStart = Math.max(0, beatSample - windowSamples)
      const searchEnd   = Math.min(samples.length, beatSample + windowSamples)

      // Use the SAME shared attack detector as the live indicator so the two agree.
      const region = samples.subarray(searchStart, searchEnd)
      const attackIdx = findAttack(region)

      if (attackIdx >= 0) {
        const hitSample = searchStart + attackIdx
        results.push({ beatSample, hitSample, offsetSec: (hitSample - beatSample) / sampleRate })
      } else {
        results.push({ beatSample, hitSample: null, offsetSec: null })
      }
    }
    return results
  }

  // Annotations drawn entirely within the annotation zone (y >= waveH)
  _drawBeatOffsets(ctx, beatOffsets, total, cssW, waveH) {
    if (beatOffsets.length === 0) return

    const zoneTop  = waveH + 2    // 2px gap after divider
    const arrowY   = waveH + 10   // horizontal arrow line
    const labelY   = waveH + 26   // ms label baseline

    ctx.font = 'bold 9px system-ui, sans-serif'
    ctx.textAlign = 'center'

    for (const { beatSample, hitSample, offsetSec } of beatOffsets) {
      if (offsetSec === null) continue

      const beatX = (beatSample / total) * cssW
      if (beatX < 0 || beatX > cssW) continue

      const ms    = Math.round(offsetSec * 1000)
      const absMs = Math.abs(ms)
      const isOn  = absMs <= OFF_THRESHOLD_MS
      const color = isOn ? OFF_ON : offsetSec < 0 ? OFF_EARLY : OFF_LATE

      // Anchor tick from divider down
      ctx.strokeStyle = color
      ctx.lineWidth = 1.5
      ctx.setLineDash([])
      ctx.beginPath()
      ctx.moveTo(beatX, waveH)
      ctx.lineTo(beatX, zoneTop + 4)
      ctx.stroke()

      if (!isOn && hitSample !== null) {
        const hitX = (hitSample / total) * cssW
        // Dashed arrow
        ctx.strokeStyle = color
        ctx.lineWidth = 1
        ctx.setLineDash([2, 2])
        ctx.beginPath()
        ctx.moveTo(beatX, arrowY)
        ctx.lineTo(hitX, arrowY)
        ctx.stroke()
        ctx.setLineDash([])
        // Arrowhead
        const dir = hitX > beatX ? 1 : -1
        ctx.fillStyle = color
        ctx.beginPath()
        ctx.moveTo(hitX, arrowY)
        ctx.lineTo(hitX - dir * 5, arrowY - 3)
        ctx.lineTo(hitX - dir * 5, arrowY + 3)
        ctx.closePath()
        ctx.fill()
      }

      ctx.fillStyle = color
      ctx.fillText(isOn ? '✓' : (offsetSec < 0 ? `−${absMs}ms` : `+${absMs}ms`), beatX, labelY)
    }

    ctx.textAlign = 'left'
  }

  _drawTriangle(ctx, x, tipY, size, color) {
    ctx.fillStyle = color
    ctx.beginPath()
    ctx.moveTo(x, tipY + size * 1.5)
    ctx.lineTo(x - size, tipY)
    ctx.lineTo(x + size, tipY)
    ctx.closePath()
    ctx.fill()
  }

  _detectOnsets(samples, sampleRate) {
    const energies = []
    for (let i = 0; i + ONSET_WINDOW <= samples.length; i += ONSET_HOP) {
      let sum = 0
      for (let j = i; j < i + ONSET_WINDOW; j++) sum += samples[j] * samples[j]
      energies.push({ sample: i + ONSET_WINDOW / 2, rms: Math.sqrt(sum / ONSET_WINDOW) })
    }

    const SMOOTH = 8
    const onsets = []
    const minGapSamples = ONSET_MIN_GAP * sampleRate
    let lastOnsetSample = -Infinity

    for (let i = 1; i < energies.length; i++) {
      const lo = Math.max(0, i - SMOOTH)
      let mean = 0
      for (let k = lo; k < i; k++) mean += energies[k].rms
      mean /= (i - lo)

      const prev = energies[i - 1].rms
      const curr = energies[i].rms

      if (
        mean > 0.001 &&
        curr > mean * ONSET_THRESHOLD &&
        curr > prev &&
        energies[i].sample - lastOnsetSample > minGapSamples
      ) {
        onsets.push(energies[i].sample)
        lastOnsetSample = energies[i].sample
      }
    }

    return onsets
  }

  clear() {
    const wrapperW = this.wrapper.clientWidth || 900
    this._resize(wrapperW)
    this.ctx.fillStyle = BG_COLOR
    this.ctx.fillRect(0, 0, this._cssW, this._cssH)
  }
}

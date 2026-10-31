// Shared onset detection — used by BOTH the live recording indicator and the
// post-recording waveform display so the two always agree exactly.
//
// Returns the ATTACK point (where energy first rises sharply toward the peak),
// not the energy peak. For struck/plucked/spoken sounds the energy peak lags the
// true attack by 10–50ms; musicians hear the attack as "the note", so we locate
// that instead. This removes a systematic "late" bias.

export const DETECT = {
  RMS_WINDOW: 256,   // samples per RMS frame
  HOP: 64,           // frame hop
  SILENCE_FLOOR: 0.004,
  // Onset = first frame whose RMS crosses this fraction of the window's peak RMS,
  // scanning forward from the start of the search window.
  ATTACK_FRACTION: 0.35,
}

// Compute RMS energy envelope over `region` (Float32Array).
// Returns { frames: [{idx, rms}], peakRms }.
function envelope(region) {
  const frames = []
  let peakRms = 0
  for (let i = 0; i + DETECT.RMS_WINDOW <= region.length; i += DETECT.HOP) {
    let sum = 0
    for (let j = i; j < i + DETECT.RMS_WINDOW; j++) sum += region[j] * region[j]
    const rms = Math.sqrt(sum / DETECT.RMS_WINDOW)
    frames.push({ idx: i + DETECT.RMS_WINDOW / 2, rms })
    if (rms > peakRms) peakRms = rms
  }
  return { frames, peakRms }
}

// Find the attack sample index within `region` (Float32Array), or -1 if none.
// The index returned is relative to region[0].
export function findAttack(region) {
  const { frames, peakRms } = envelope(region)
  if (peakRms < DETECT.SILENCE_FLOOR || frames.length === 0) return -1

  const threshold = peakRms * DETECT.ATTACK_FRACTION

  // Walk forward to the first frame that crosses the attack threshold AND is
  // rising (greater than the previous frame). This catches the leading edge of
  // the loudest event in the window rather than its peak.
  for (let i = 1; i < frames.length; i++) {
    if (frames[i].rms >= threshold && frames[i].rms > frames[i - 1].rms) {
      return frames[i].idx
    }
  }
  // Fallback: the first frame already above threshold (attack before window start)
  for (let i = 0; i < frames.length; i++) {
    if (frames[i].rms >= threshold) return frames[i].idx
  }
  return -1
}

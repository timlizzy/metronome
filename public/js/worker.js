// Tick loop runs in a Worker so background tabs don't throttle setTimeout to ~1s
const INTERVAL_MS = 25

let timerId = null

self.onmessage = (e) => {
  if (e.data === 'start') {
    if (timerId !== null) return
    timerId = setInterval(() => self.postMessage('tick'), INTERVAL_MS)
  } else if (e.data === 'stop') {
    clearInterval(timerId)
    timerId = null
  }
}

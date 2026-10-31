# Metronome

A browser-based metronome with microphone recording and precise timing analysis. Set up a beat pattern, play along, and see exactly how early or late each of your hits landed — both live while you play and in a waveform overlay afterward.

## Features

- **Configurable patterns** — fill a 4/4 bar with quarter, eighth, sixteenth, or triplet subdivisions, across multiple bars. Click cells in the grid to toggle which beats play.
- **Accurate clicks** — look-ahead Web Audio scheduler (accented downbeats, runs in a Web Worker so background tabs don't throttle timing).
- **BPM and bar controls** — adjust tempo, bar count, and auto-stop after a set number of bars.
- **Count-in** — one bar of distinct count-in clicks before recording starts.
- **Microphone recording** — record yourself playing along for as many bars as you like.
- **Live timing feedback** — while recording, a needle and millisecond readout show whether each hit was early, late, or on the beat, with a running history.
- **High-res timing mode** — optional 512-sample capture buffer (~12 ms resolution) instead of the default 4096 (~93 ms).
- **Waveform overlay** — after recording, see your audio aligned to the click positions, with per-beat offset annotations (dashed arrows and ms labels), active vs. inactive beat markers, and bar numbers.
- **Zoom** — scale the waveform from 1× to 32× for inspecting long takes.
- **Playback with time-stretch** — replay your recording at 0.25×–2× speed with pitch preserved (overlap-add in an AudioWorklet). At 1× it plays the raw audio directly for full fidelity.

## Timing accuracy

Both the live indicator and the post-recording graphic use a single shared onset detector (`public/js/onset.js`), so they always agree. It locates each note's **attack** (leading edge) rather than its energy peak, which removes the systematic "late" bias a peak-finder introduces. Beat positions are anchored to each capture buffer's exact `playbackTime` to avoid clock drift. For the tightest live resolution, enable **High-res timing**; the post-recording waveform is sample-accurate either way.

## Requirements

- Node.js 18+ (for `node --watch`)
- A modern browser with Web Audio API support (Chrome, Edge, Firefox, Safari)
- A microphone, for the recording features

## Setup

```bash
npm install
npm start
```

Then open <http://localhost:3000>.

For development with auto-reload on server changes:

```bash
npm run dev
```

## Usage

1. Choose a note subdivision, set the BPM and number of bars.
2. Click grid cells to activate the beats you want to hear.
3. Press **Start** to play, **Stop** to end.
4. To record: click **Enable Microphone** and grant permission, check **Record while playing**, then press **Start**. After a one-bar count-in, recording begins.
5. When you stop (or auto-stop triggers), the waveform overlay appears showing your hits against the clicks.
6. Use the zoom controls to inspect, and the playback controls to replay at different speeds.

### Microphone permission (macOS)

If you see "Permission denied by system," enable microphone access for your browser in **System Settings → Privacy & Security → Microphone**.

## Project structure

```
metronome/
├── package.json          # type:module, express, start/dev scripts
├── server.js             # Express static server on port 3000
└── public/
    ├── index.html
    ├── css/style.css
    └── js/
        ├── main.js        # wires modules, event handling, live timing display
        ├── metronome.js   # look-ahead scheduler, AudioContext, beat events
        ├── grid.js        # note grid UI and pattern state
        ├── recorder.js    # mic capture, rolling buffer, live onset search
        ├── visualizer.js  # canvas waveform + beat-marker overlay
        ├── onset.js        # shared attack detector (live + graphic)
        ├── player.js       # playback: direct at 1×, OLA time-stretch otherwise
        ├── ola-worklet.js  # overlap-add time-stretch AudioWorklet
        └── worker.js       # scheduler tick loop (avoids tab throttling)
```

No build step — plain ES modules served statically.

## Notes

- Recording uses `ScriptProcessorNode` for raw PCM capture. It's deprecated but universally supported and gives sample-accurate timing, unlike `MediaRecorder`.
- Microphone monitoring is routed through a silent gain node to prevent echo.

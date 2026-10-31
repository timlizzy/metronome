const BEATS_PER_BAR = { quarter: 4, eighth: 8, sixteenth: 16, triplet: 12 }

export class Grid {
  constructor(container, onChange) {
    this.container = container
    this.onChange = onChange
    this.state = {
      bpm: 120,
      bars: 1,
      subdivision: 'quarter',
      activeBeats: new Set([0, 1, 2, 3]),
    }
    this._render()
  }

  getPattern() {
    return {
      bpm: this.state.bpm,
      bars: this.state.bars,
      subdivision: this.state.subdivision,
      activeBeats: new Set(this.state.activeBeats),
    }
  }

  setSubdivision(sub) {
    this.state.subdivision = sub
    const total = BEATS_PER_BAR[sub] * this.state.bars
    // Default: all beats active on subdivision change
    this.state.activeBeats = new Set(Array.from({ length: total }, (_, i) => i))
    this._render()
    this.onChange?.()
  }

  setBars(n) {
    this.state.bars = Math.max(1, Math.min(8, n))
    const total = BEATS_PER_BAR[this.state.subdivision] * this.state.bars
    this.state.activeBeats = new Set(Array.from({ length: total }, (_, i) => i))
    this._render()
    this.onChange?.()
  }

  _render() {
    this.container.innerHTML = ''
    const { subdivision, bars, activeBeats } = this.state
    const beatsPerBar = BEATS_PER_BAR[subdivision]
    const total = beatsPerBar * bars

    const grid = document.createElement('div')
    grid.className = 'beat-grid'

    for (let i = 0; i < total; i++) {
      if (i > 0 && i % beatsPerBar === 0) {
        const sep = document.createElement('div')
        sep.className = 'bar-sep'
        grid.appendChild(sep)
      }

      const cell = document.createElement('button')
      cell.className = 'beat-cell' + (activeBeats.has(i) ? ' active' : '')
      cell.dataset.index = i

      // Label: beat position within bar
      const posInBar = i % beatsPerBar
      if (posInBar === 0) {
        cell.setAttribute('aria-label', `Bar ${Math.floor(i / beatsPerBar) + 1} beat 1`)
        cell.classList.add('downbeat')
      }

      cell.addEventListener('click', () => this._toggle(i))
      grid.appendChild(cell)
    }

    this.container.appendChild(grid)
  }

  _toggle(index) {
    if (this.state.activeBeats.has(index)) {
      this.state.activeBeats.delete(index)
    } else {
      this.state.activeBeats.add(index)
    }
    const cell = this.container.querySelector(`.beat-cell[data-index="${index}"]`)
    if (cell) cell.classList.toggle('active')
    this.onChange?.()
  }
}

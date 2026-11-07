/**
 * Uniform grid over the inner solar system for hover/select picking.
 * Points outside the gridded extent are kept in a small overflow list.
 */
export class SpatialIndex {
  private readonly extent = 6
  private readonly cells = 400
  private readonly cellSize: number
  private readonly cellStart: Int32Array
  private readonly cellItems: Int32Array
  private readonly overflow: Int32Array

  constructor(private readonly positions: Float32Array) {
    const count = positions.length / 2
    this.cellSize = (this.extent * 2) / this.cells
    const total = this.cells * this.cells
    const cellOf = new Int32Array(count)
    const counts = new Int32Array(total + 1)
    let overflowCount = 0

    for (let k = 0; k < count; k++) {
      const c = this.cellIndex(positions[k * 2], positions[k * 2 + 1])
      cellOf[k] = c
      if (c < 0) overflowCount++
      else counts[c + 1]++
    }
    for (let c = 0; c < total; c++) counts[c + 1] += counts[c]

    this.cellStart = counts
    this.cellItems = new Int32Array(count - overflowCount)
    this.overflow = new Int32Array(overflowCount)
    const cursor = counts.slice(0, total)
    let o = 0
    for (let k = 0; k < count; k++) {
      const c = cellOf[k]
      if (c < 0) this.overflow[o++] = k
      else this.cellItems[cursor[c]++] = k
    }
  }

  private cellCoord(v: number): number {
    return Math.floor((v + this.extent) / this.cellSize)
  }

  private cellIndex(x: number, y: number): number {
    const cx = this.cellCoord(x)
    const cy = this.cellCoord(y)
    if (cx < 0 || cy < 0 || cx >= this.cells || cy >= this.cells) return -1
    return cy * this.cells + cx
  }

  /**
   * Nearest point within `radius` au. Points with mask 0 are treated as
   * farther away so visible asteroids win ties in dense regions.
   */
  nearest(x: number, y: number, radius: number, mask?: Uint8Array | null): number {
    let best = -1
    let bestDist = radius * radius
    const consider = (k: number) => {
      const dx = this.positions[k * 2] - x
      const dy = this.positions[k * 2 + 1] - y
      let d = dx * dx + dy * dy
      if (mask && mask[k] === 0) d *= 4
      if (d < bestDist) {
        bestDist = d
        best = k
      }
    }

    const x0 = Math.max(0, this.cellCoord(x - radius))
    const x1 = Math.min(this.cells - 1, this.cellCoord(x + radius))
    const y0 = Math.max(0, this.cellCoord(y - radius))
    const y1 = Math.min(this.cells - 1, this.cellCoord(y + radius))
    for (let cy = y0; cy <= y1; cy++) {
      for (let cx = x0; cx <= x1; cx++) {
        const c = cy * this.cells + cx
        for (let p = this.cellStart[c]; p < this.cellStart[c + 1]; p++) consider(this.cellItems[p])
      }
    }
    for (let p = 0; p < this.overflow.length; p++) consider(this.overflow[p])
    return best
  }
}

// Sparse, session-local brush marks in volume coordinates. Unlike a slice cache,
// these survive windowing, slice eviction, and switching anatomical planes.
export class BrushPreview {
  private voxels = new Map<number, number>();
  revision = 0;

  constructor(private shape: number[]) {}

  private key(axis: number, index: number, offset: number): number {
    const rest = [0, 1, 2].filter((value) => value !== axis);
    const columns = this.shape[rest[0]];
    const point = [0, 0, 0];
    point[axis] = index;
    // Match the backend's radiological display: reversed axes, then transpose.
    point[rest[0]] = columns - 1 - (offset % columns);
    point[rest[1]] = this.shape[rest[1]] - 1 - Math.floor(offset / columns);
    return (point[0] * this.shape[1] + point[1]) * this.shape[2] + point[2];
  }

  plane(axis: number, index: number): Map<number, number> {
    const result = new Map<number, number>();
    const rest = [0, 1, 2].filter((value) => value !== axis);
    for (const [key, value] of this.voxels) {
      const point = [
        Math.floor(key / (this.shape[1] * this.shape[2])),
        Math.floor(key / this.shape[2]) % this.shape[1],
        key % this.shape[2],
      ];
      if (point[axis] !== index) continue;
      const column = this.shape[rest[0]] - 1 - point[rest[0]];
      const row = this.shape[rest[1]] - 1 - point[rest[1]];
      result.set(row * this.shape[rest[0]] + column, value);
    }
    return result;
  }

  set(axis: number, index: number, offset: number, value: number): boolean {
    const key = this.key(axis, index, offset);
    if (this.voxels.get(key) === value) return false;
    this.voxels.set(key, value);
    this.revision++;
    return true;
  }

  restore(axis: number, index: number, previous: Map<number, number>) {
    for (const offset of this.plane(axis, index).keys())
      this.voxels.delete(this.key(axis, index, offset));
    for (const [offset, value] of previous)
      this.voxels.set(this.key(axis, index, offset), value);
    this.revision++;
  }

  removeLabel(label: number) {
    for (const [key, value] of this.voxels)
      if (value === label) this.voxels.set(key, 0);
    this.revision++;
  }

  clear() {
    this.voxels.clear();
    this.revision++;
  }
}

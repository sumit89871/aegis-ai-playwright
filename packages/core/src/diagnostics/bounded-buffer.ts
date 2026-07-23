export class BoundedBuffer<T> {
  readonly #entries: T[] = [];
  readonly #maximumEntries: number;
  #droppedEntries = 0;

  public constructor(maximumEntries: number) {
    if (!Number.isInteger(maximumEntries) || maximumEntries < 1) {
      throw new Error("maximumEntries must be a positive integer.");
    }

    this.#maximumEntries = maximumEntries;
  }

  public get count(): number {
    return this.#entries.length;
  }

  public get droppedEntries(): number {
    return this.#droppedEntries;
  }

  public add(entry: T): void {
    if (this.#entries.length >= this.#maximumEntries) {
      this.#droppedEntries++;
      return;
    }

    this.#entries.push(entry);
  }

  public toArray(): readonly T[] {
    return [...this.#entries];
  }
}

/**
 * Small single-writer JSON store for plugin-owned files. A write confirms only
 * the revision it observed, so a change made while I/O is in flight remains
 * dirty and is written by the next loop iteration.
 */
export interface JsonAdapter {
  exists(path: string): Promise<boolean>;
  read(path: string): Promise<string>;
  write(path: string, content: string): Promise<void>;
}

export interface RevisionedJsonStoreOptions<T> {
  create: () => T;
  validate?: (value: unknown) => value is T;
  onWriteError?: (error: unknown) => void;
}

export class RevisionedJsonStore<T> {
  private value: T;
  private revision = 0;
  private persistedRevision = 0;
  private savePromise: Promise<void> | null = null;
  private loadError: Error | null = null;
  private loaded = false;

  constructor(
    private readonly adapter: JsonAdapter,
    readonly path: string,
    private readonly options: RevisionedJsonStoreOptions<T>,
  ) {
    this.value = options.create();
  }

  async load(): Promise<{ exists: boolean; value: T }> {
    const exists = await this.adapter.exists(this.path);
    if (!exists) {
      this.value = this.options.create();
      this.revision = 0;
      this.persistedRevision = 0;
      this.loaded = true;
      return { exists: false, value: this.value };
    }

    try {
      const parsed: unknown = JSON.parse(await this.adapter.read(this.path));
      if (this.options.validate && !this.options.validate(parsed)) {
        throw new Error(`Invalid JSON shape in ${this.path}`);
      }
      this.value = parsed as T;
      this.revision = 0;
      this.persistedRevision = 0;
      this.loaded = true;
      this.loadError = null;
      return { exists: true, value: this.value };
    } catch (error) {
      this.loadError = error instanceof Error ? error : new Error(String(error));
      this.loaded = true;
      throw this.loadError;
    }
  }

  get(): T {
    this.assertUsable();
    return this.value;
  }

  replace(next: T): void {
    this.assertUsable();
    this.value = next;
    this.revision++;
  }

  update(mutator: (current: T) => T): T {
    this.assertUsable();
    this.value = mutator(this.value);
    this.revision++;
    return this.value;
  }

  isDirty(): boolean {
    return this.revision > this.persistedRevision;
  }

  getLoadError(): Error | null {
    return this.loadError;
  }

  async save(): Promise<void> {
    this.assertUsable();
    // A caller can arrive during the final microtask of a completed writer.
    // Recheck after awaiting so that revision is not left dirty with no owner.
    while (this.isDirty()) {
      const active = this.savePromise ?? this.startDrain();
      await active;
    }
  }

  private startDrain(): Promise<void> {
    const active = this.drain().finally(() => {
      if (this.savePromise === active) this.savePromise = null;
    });
    this.savePromise = active;
    return active;
  }

  private async drain(): Promise<void> {
    while (this.persistedRevision < this.revision) {
      const revision = this.revision;
      const content = JSON.stringify(this.value, null, 2);
      try {
        await this.adapter.write(this.path, content);
        this.persistedRevision = revision;
      } catch (error) {
        this.options.onWriteError?.(error);
        throw error;
      }
    }
  }

  private assertUsable(): void {
    if (!this.loaded) {
      throw new Error(`JSON store ${this.path} has not been loaded`);
    }
    if (this.loadError) {
      throw this.loadError;
    }
  }
}

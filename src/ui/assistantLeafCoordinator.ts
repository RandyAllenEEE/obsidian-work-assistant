export interface AssistantLeafHost<Leaf> {
  isEnabled(): boolean;
  onLayoutReady(callback: () => void): void;
  findLeaves(): Leaf[];
  createLeaf(): Leaf | null;
  isCurrentView(leaf: Leaf): boolean;
  setAssistantView(leaf: Leaf): Promise<void>;
  onLeafReady(leaf: Leaf): void;
  revealLeaf(leaf: Leaf): Promise<void>;
  detachLeaf(leaf: Leaf): void;
  onError(error: unknown): void;
}

/** Coordinates Assistant view restoration without touching workspace leaves mid-restore. */
export class AssistantLeafCoordinator<Leaf> {
  private generation = 0;
  private pending = false;
  private revealRequested = false;
  private drainPromise: Promise<void> | null = null;
  private cleanupGeneration = 0;

  constructor(private readonly host: AssistantLeafHost<Leaf>) {}

  request(reveal: boolean): void {
    this.cleanupGeneration++;
    this.pending = true;
    this.revealRequested ||= reveal;
    const generation = this.generation;
    this.host.onLayoutReady(() => {
      if (generation !== this.generation || !this.host.isEnabled()) return;
      this.startDrain(generation);
    });
  }

  cancel(): void {
    this.generation++;
    this.cleanupGeneration++;
    this.pending = false;
    this.revealRequested = false;
  }

  removeAfterLayoutReady(): void {
    this.cancel();
    const cleanupGeneration = this.cleanupGeneration;
    this.host.onLayoutReady(() => {
      if (cleanupGeneration !== this.cleanupGeneration) return;
      this.host.findLeaves().forEach((leaf) => this.host.detachLeaf(leaf));
    });
  }

  private startDrain(generation: number): void {
    if (this.drainPromise || generation !== this.generation) return;
    const run = this.drain(generation);
    this.drainPromise = run
      .catch((error) => this.host.onError(error))
      .finally(() => {
        this.drainPromise = null;
        if (this.pending && generation === this.generation && this.host.isEnabled()) {
          this.startDrain(generation);
        }
      });
  }

  private async drain(generation: number): Promise<void> {
    while (this.pending && generation === this.generation && this.host.isEnabled()) {
      const reveal = this.revealRequested;
      this.pending = false;
      this.revealRequested = false;
      await this.reconcileLeaf(reveal, generation);
    }
  }

  private async reconcileLeaf(reveal: boolean, generation: number): Promise<void> {
    const existingLeaves = this.host.findLeaves();
    let primaryLeaf = existingLeaves[0] ?? null;

    if (!primaryLeaf) {
      primaryLeaf = this.host.createLeaf();
      if (!primaryLeaf) return;
      await this.host.setAssistantView(primaryLeaf);
    } else if (!this.host.isCurrentView(primaryLeaf)) {
      // Legacy Assistant leaves are migrated only after workspace restoration.
      await this.host.setAssistantView(primaryLeaf);
    }

    if (generation !== this.generation || !this.host.isEnabled()) return;
    this.host.onLeafReady(primaryLeaf);

    for (const duplicateLeaf of existingLeaves.slice(1)) {
      this.host.detachLeaf(duplicateLeaf);
    }

    if (reveal) {
      await this.host.revealLeaf(primaryLeaf);
    }
  }
}

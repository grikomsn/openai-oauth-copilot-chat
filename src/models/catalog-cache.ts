/** Small in-memory cache policy for authenticated model catalogs. */

export class CatalogCache<T> {
  private value: T | undefined;
  private refreshedAt = 0;
  private generation = 0;

  constructor(private readonly now: () => number = Date.now) {}

  clear(): void {
    this.generation += 1;
    this.value = undefined;
    this.refreshedAt = 0;
  }

  async getOrRefresh(
    maxAgeMs: number,
    load: () => Promise<T>,
    isCancellation: (error: unknown) => boolean = () => false,
  ): Promise<T> {
    const generation = this.generation;
    if (this.value !== undefined && this.now() - this.refreshedAt < maxAgeMs) return this.value;
    try {
      const value = await load();
      if (this.generation !== generation) throw new Error("Catalog cache was invalidated during refresh");
      this.value = value;
      this.refreshedAt = this.now();
      return value;
    } catch (error) {
      if (this.generation !== generation) throw error;
      if (this.value !== undefined && !isCancellation(error)) return this.value;
      throw error;
    }
  }
}

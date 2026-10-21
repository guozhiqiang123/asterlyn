import type { HistoryQuery } from "../../models.ts";

type HistoryCountReader = (root: string, query: HistoryQuery) => Promise<number>;

export class LatestHistoryCount {
  private sequence = 0;
  private readonly read: HistoryCountReader;
  private active: { key: string; promise: Promise<number> } | null = null;

  constructor(read: HistoryCountReader) {
    this.read = read;
  }

  invalidate(): void {
    this.sequence += 1;
    this.active = null;
  }

  request(
    root: string,
    query: HistoryQuery,
    current: () => boolean,
    complete: (count: number | null) => void,
  ): void {
    const sequence = ++this.sequence;
    const key = JSON.stringify([root, query]);
    const promise = this.active?.key === key
      ? this.active.promise
      : this.read(root, query);
    this.active = { key, promise };
    void promise.then((count) => {
      if (this.active?.promise === promise) this.active = null;
      if (sequence === this.sequence && current()) complete(count);
    }).catch(() => {
      if (this.active?.promise === promise) this.active = null;
      if (sequence === this.sequence && current()) complete(null);
    });
  }
}

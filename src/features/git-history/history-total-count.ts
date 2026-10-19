import type { HistoryQuery } from "../../models.ts";

type HistoryCountReader = (root: string, query: HistoryQuery) => Promise<number>;

export class LatestHistoryCount {
  private sequence = 0;
  private readonly read: HistoryCountReader;

  constructor(read: HistoryCountReader) {
    this.read = read;
  }

  invalidate(): void {
    this.sequence += 1;
  }

  request(
    root: string,
    query: HistoryQuery,
    current: () => boolean,
    complete: (count: number | null) => void,
  ): void {
    const sequence = ++this.sequence;
    void this.read(root, query).then((count) => {
      if (sequence === this.sequence && current()) complete(count);
    }).catch(() => {
      if (sequence === this.sequence && current()) complete(null);
    });
  }
}

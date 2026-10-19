import { demoQueryHistory } from "../../demo.ts";
import type { HistoryPage, HistoryQuery, RepositorySnapshot } from "../../models.ts";
import type { GitReadBridge } from "../../protocol/desktop-bridge.ts";
import {
  invokeDesktopCommand,
  isTauriRuntime,
} from "../tauri/desktop-command-adapter.ts";

type DemoHistoryReadBridge = Pick<
  GitReadBridge,
  "readHistoryPage" | "readHistoryCount"
>;

export function createDemoHistoryReadBridge(
  snapshot: () => RepositorySnapshot,
): DemoHistoryReadBridge {
  return {
    async readHistoryPage(repositoryRoot, query, offset, limit): Promise<HistoryPage> {
      if (!isTauriRuntime) {
        await delay(180);
        const commits = demoQueryHistory(snapshot(), query);
        return {
          commits: commits.slice(offset, offset + limit),
          offset,
          hasMore: commits.length > offset + limit,
        };
      }
      return invokeDesktopCommand<HistoryPage>("read_history_page", {
        repositoryRoot,
        query,
        offset,
        limit,
      });
    },

    async readHistoryCount(repositoryRoot, query: HistoryQuery): Promise<number> {
      if (!isTauriRuntime) {
        await delay(60);
        return demoQueryHistory(snapshot(), query).length;
      }
      return invokeDesktopCommand<number>("read_history_count", { repositoryRoot, query });
    },
  };
}

function delay(milliseconds: number): Promise<void> {
  return new Promise((resolve) => window.setTimeout(resolve, milliseconds));
}

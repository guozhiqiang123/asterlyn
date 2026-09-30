import type {
  CommandCategory,
  CommandFocusScope,
  CommandId,
} from "../application/commands/command-service.ts";
import type { LocaleCatalog } from "../localization/catalog.ts";

export interface DomCommandDefinition {
  readonly id: CommandId;
  readonly category: CommandCategory;
  readonly selector: string;
  readonly scopes: readonly CommandFocusScope[];
  readonly title: (catalog: LocaleCatalog) => string;
  readonly detail: (catalog: LocaleCatalog) => string;
  readonly keywords: string;
  readonly blockedReason: (catalog: LocaleCatalog) => string;
}

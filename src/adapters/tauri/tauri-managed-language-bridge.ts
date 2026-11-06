import type { ManagedLanguageEnvironment } from "../../protocol/managed-language-environment.ts";
import { validateManagedLanguageEnvironment } from "../../protocol/managed-language-environment.ts";
import type {
  ManagedLanguageInstallReview,
  ManagedLanguageRecipeCatalog,
} from "../../protocol/managed-language-management.ts";
import {
  validateManagedLanguageInstallReview,
  validateManagedLanguageRecipeCatalog,
} from "../../protocol/managed-language-management.ts";
import { invokeDesktopCommandUnvalidated } from "./desktop-command-adapter.ts";

export async function readManagedLanguageEnvironment(): Promise<ManagedLanguageEnvironment> {
  return validateManagedLanguageEnvironment(
    await invokeDesktopCommandUnvalidated("read_managed_language_environment", {}),
  );
}

export async function listManagedLanguageRecipes(
  pluginId: string,
): Promise<ManagedLanguageRecipeCatalog> {
  return validateManagedLanguageRecipeCatalog(
    await invokeDesktopCommandUnvalidated("list_managed_language_recipes", { pluginId }),
  );
}

export async function prepareManagedLanguageInstall(
  pluginId: string,
  serverId: string,
  recipeDigest: string,
): Promise<ManagedLanguageInstallReview> {
  return validateManagedLanguageInstallReview(
    await invokeDesktopCommandUnvalidated("prepare_managed_language_install", {
      pluginId,
      serverId,
      recipeDigest,
    }),
  );
}

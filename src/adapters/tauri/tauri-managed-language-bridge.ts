import type { ManagedLanguageEnvironment } from "../../protocol/managed-language-environment.ts";
import { validateManagedLanguageEnvironment } from "../../protocol/managed-language-environment.ts";
import type {
  ManagedLanguageInstallReview,
  ManagedLanguageInstallCompletion,
  ManagedLanguageInstallStarted,
  ManagedLanguageRecipeCatalog,
} from "../../protocol/managed-language-management.ts";
import {
  MANAGED_LANGUAGE_INSTALLATION_EVENT,
  parseManagedLanguageInstallCompletion,
  validateManagedLanguageInstallReview,
  validateManagedLanguageInstallStarted,
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

export async function confirmManagedLanguageInstall(
  pluginId: string,
  reviewId: string,
): Promise<ManagedLanguageInstallStarted> {
  return validateManagedLanguageInstallStarted(
    await invokeDesktopCommandUnvalidated("confirm_managed_language_install", {
      pluginId,
      reviewId,
    }),
  );
}

export async function cancelManagedLanguageInstall(
  pluginId: string,
  operationId: string,
): Promise<void> {
  await invokeDesktopCommandUnvalidated("cancel_managed_language_install", {
    pluginId,
    operationId,
  });
}

export async function subscribeManagedLanguageInstallations(
  listener: (event: ManagedLanguageInstallCompletion) => void,
): Promise<() => void> {
  const { listen } = await import("@tauri-apps/api/event");
  return listen<unknown>(MANAGED_LANGUAGE_INSTALLATION_EVENT, (event) => {
    listener(parseManagedLanguageInstallCompletion(event.payload));
  });
}

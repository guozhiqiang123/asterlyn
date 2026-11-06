import assert from "node:assert/strict";
import test from "node:test";

import {
  validateManagedLanguageInstallReview,
  validateManagedLanguageRecipeCatalog,
} from "../src/protocol/managed-language-management.ts";

const digest = character => `sha256:${character.repeat(64)}`;
const server = { pluginId: "dev.asterlyn.lsp", serverId: "rust-analyzer" };
const recipe = {
  reference: {
    server,
    target: "aarch64-apple-darwin",
    recipeDigest: digest("a"),
  },
  version: "2026.11.6",
  archiveDigest: digest("b"),
  contentDigest: digest("c"),
  downloadBytes: 1024,
  expandedBytes: 4096,
  source: "https://github.com/rust-lang/rust-analyzer/releases/download/2026-11-06/server.gz",
  license: {
    expression: "MIT OR Apache-2.0",
    noticeUrl: "https://github.com/rust-lang/rust-analyzer/blob/2026-11-06/LICENSE-MIT",
    noticeDigest: digest("d"),
  },
};

const catalog = {
  protocolVersion: 1,
  target: "aarch64-apple-darwin",
  recipes: [recipe],
};

const review = {
  protocolVersion: 1,
  reviewId: "review-1",
  kind: "install",
  artifact: {
    server,
    version: recipe.version,
    target: recipe.reference.target,
    recipeDigest: recipe.reference.recipeDigest,
    archiveDigest: recipe.archiveDigest,
    contentDigest: recipe.contentDigest,
  },
  indexRevision: 0,
  downloadBytes: recipe.downloadBytes,
  expandedBytes: recipe.expandedBytes,
  recipe,
  noticeText: "MIT license notice\n",
};

test("managed language management accepts exact catalog and review projections", () => {
  assert.equal(validateManagedLanguageRecipeCatalog(catalog), catalog);
  assert.equal(validateManagedLanguageInstallReview(review), review);
  assert.deepEqual(validateManagedLanguageRecipeCatalog({
    protocolVersion: 1,
    target: "aarch64-apple-darwin",
    recipes: [],
  }).recipes, []);
});

test("managed language management rejects drift, substitution and unbounded evidence", () => {
  assert.throws(() => validateManagedLanguageRecipeCatalog({ ...catalog, extra: true }));
  assert.throws(() => validateManagedLanguageRecipeCatalog({
    ...catalog,
    recipes: [recipe, recipe],
  }));
  assert.throws(() => validateManagedLanguageInstallReview({
    ...review,
    artifact: { ...review.artifact, contentDigest: digest("e") },
  }));
  assert.throws(() => validateManagedLanguageInstallReview({
    ...review,
    noticeText: "x".repeat(128 * 1024 + 1),
  }));
  assert.throws(() => validateManagedLanguageInstallReview({
    ...review,
    recipe: { ...recipe, source: "http://example.com/server.gz" },
  }));
});

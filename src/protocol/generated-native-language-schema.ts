// Generated from native serde models by scripts/generate-native-language-contract.mjs. Do not edit.
export const NATIVE_LANGUAGE_SCHEMAS = {
  "JavaRequirement": {
    "additionalProperties": false,
    "properties": {
      "maximumMajorExclusive": {
        "format": "uint16",
        "minimum": 0,
        "type": [
          "integer",
          "null"
        ]
      },
      "minimumMajor": {
        "format": "uint16",
        "minimum": 0,
        "type": "integer"
      }
    },
    "required": [
      "minimumMajor"
    ],
    "type": "object"
  },
  "LanguageFailureCode": {
    "enum": [
      "backend-exited",
      "protocol-failed",
      "resource-limit",
      "authority-revoked",
      "model-unavailable",
      "toolchain-unavailable",
      "cancelled",
      "unavailable"
    ],
    "type": "string"
  },
  "LanguageResourcePolicy": {
    "additionalProperties": false,
    "properties": {
      "budgetMiB": {
        "format": "uint32",
        "minimum": 0,
        "type": "integer"
      },
      "choicesMiB": {
        "items": {
          "format": "uint32",
          "minimum": 0,
          "type": "integer"
        },
        "type": "array"
      },
      "compilerMaxMiB": {
        "format": "uint32",
        "minimum": 0,
        "type": [
          "integer",
          "null"
        ]
      },
      "maxHeapMiB": {
        "format": "uint32",
        "minimum": 0,
        "type": "integer"
      },
      "physicalMiB": {
        "format": "uint32",
        "minimum": 0,
        "type": "integer"
      },
      "schema": {
        "format": "uint8",
        "minimum": 0,
        "type": "integer"
      }
    },
    "required": [
      "budgetMiB",
      "choicesMiB",
      "maxHeapMiB",
      "physicalMiB",
      "schema"
    ],
    "type": "object"
  },
  "ManagedArtifact": {
    "additionalProperties": false,
    "properties": {
      "archiveDigest": {
        "maxLength": 71,
        "minLength": 71,
        "type": "string"
      },
      "contentDigest": {
        "maxLength": 71,
        "minLength": 71,
        "type": "string"
      },
      "recipeDigest": {
        "maxLength": 71,
        "minLength": 71,
        "type": "string"
      },
      "server": {
        "$ref": "#/definitions/ManagedServerId"
      },
      "target": {
        "maxLength": 80,
        "minLength": 1,
        "type": "string"
      },
      "version": {
        "maxLength": 128,
        "minLength": 1,
        "type": "string"
      }
    },
    "required": [
      "archiveDigest",
      "contentDigest",
      "recipeDigest",
      "server",
      "target",
      "version"
    ],
    "type": "object"
  },
  "ManagedArtifactOwnership": {
    "enum": [
      "managed",
      "external"
    ],
    "type": "string"
  },
  "ManagedArtifactStatus": {
    "additionalProperties": false,
    "properties": {
      "artifact": {
        "$ref": "#/definitions/ManagedInstalledArtifact"
      },
      "useCount": {
        "format": "uint32",
        "maximum": 128,
        "minimum": 0,
        "type": "integer"
      },
      "verification": {
        "$ref": "#/definitions/ManagedArtifactVerification"
      }
    },
    "required": [
      "artifact",
      "useCount",
      "verification"
    ],
    "type": "object"
  },
  "ManagedArtifactVerification": {
    "enum": [
      "required",
      "verified"
    ],
    "type": "string"
  },
  "ManagedInstallationIndex": {
    "additionalProperties": false,
    "description": "Durable schema only. Reviews, permissions, jobs, verification and live uses are never persisted.",
    "properties": {
      "artifacts": {
        "items": {
          "$ref": "#/definitions/ManagedInstalledArtifact"
        },
        "maxItems": 64,
        "type": "array"
      },
      "revision": {
        "format": "uint64",
        "maximum": 9007199254740991,
        "minimum": 0,
        "type": "integer"
      },
      "schemaVersion": {
        "format": "uint32",
        "maximum": 1,
        "minimum": 1,
        "type": "integer"
      },
      "selections": {
        "items": {
          "$ref": "#/definitions/ManagedServerSelection"
        },
        "maxItems": 64,
        "type": "array"
      }
    },
    "required": [
      "artifacts",
      "revision",
      "schemaVersion",
      "selections"
    ],
    "type": "object"
  },
  "ManagedInstallationSnapshot": {
    "additionalProperties": false,
    "properties": {
      "artifacts": {
        "items": {
          "$ref": "#/definitions/ManagedArtifactStatus"
        },
        "maxItems": 64,
        "type": "array"
      },
      "epoch": {
        "maxLength": 64,
        "minLength": 1,
        "type": "string"
      },
      "indexRevision": {
        "format": "uint64",
        "maximum": 9007199254740991,
        "minimum": 0,
        "type": "integer"
      },
      "operations": {
        "items": {
          "$ref": "#/definitions/ManagedInstallOperation"
        },
        "maxItems": 24,
        "type": "array"
      },
      "protocolVersion": {
        "format": "uint32",
        "maximum": 1,
        "minimum": 1,
        "type": "integer"
      },
      "revision": {
        "format": "uint64",
        "maximum": 9007199254740991,
        "minimum": 0,
        "type": "integer"
      },
      "selections": {
        "items": {
          "$ref": "#/definitions/ManagedServerSelection"
        },
        "maxItems": 64,
        "type": "array"
      }
    },
    "required": [
      "artifacts",
      "epoch",
      "indexRevision",
      "operations",
      "protocolVersion",
      "revision",
      "selections"
    ],
    "type": "object"
  },
  "ManagedInstalledArtifact": {
    "additionalProperties": false,
    "properties": {
      "id": {
        "maxLength": 71,
        "minLength": 71,
        "type": "string"
      },
      "identity": {
        "$ref": "#/definitions/ManagedArtifact"
      },
      "ownership": {
        "$ref": "#/definitions/ManagedArtifactOwnership"
      }
    },
    "required": [
      "id",
      "identity",
      "ownership"
    ],
    "type": "object"
  },
  "ManagedInstallError": {
    "enum": [
      "invalid-request",
      "unsupported-schema",
      "permission-denied",
      "stale-review",
      "expired-review",
      "not-found",
      "busy",
      "resource-limit",
      "integrity-mismatch",
      "storage-failed",
      "protected-artifact",
      "external-artifact",
      "in-use",
      "cancelled",
      "invalid-transition",
      "unverified",
      "state-changed"
    ],
    "type": "string"
  },
  "ManagedInstallOperation": {
    "additionalProperties": false,
    "properties": {
      "artifactId": {
        "maxLength": 71,
        "minLength": 71,
        "type": "string"
      },
      "completedBytes": {
        "format": "uint64",
        "maximum": 536870912,
        "minimum": 0,
        "type": "integer"
      },
      "failure": {
        "anyOf": [
          {
            "$ref": "#/definitions/ManagedInstallError"
          },
          {
            "type": "null"
          }
        ]
      },
      "id": {
        "maxLength": 128,
        "minLength": 1,
        "type": "string"
      },
      "kind": {
        "$ref": "#/definitions/ManagedOperationKind"
      },
      "phase": {
        "$ref": "#/definitions/ManagedOperationPhase"
      },
      "server": {
        "$ref": "#/definitions/ManagedServerId"
      },
      "totalBytes": {
        "format": "uint64",
        "maximum": 536870912,
        "minimum": 0,
        "type": "integer"
      }
    },
    "required": [
      "artifactId",
      "completedBytes",
      "id",
      "kind",
      "phase",
      "server",
      "totalBytes"
    ],
    "type": "object"
  },
  "ManagedOperationKind": {
    "enum": [
      "install",
      "remove"
    ],
    "type": "string"
  },
  "ManagedOperationPhase": {
    "enum": [
      "acquiring",
      "verifying",
      "committing",
      "waiting-for-uses",
      "completed",
      "cancelled",
      "failed"
    ],
    "type": "string"
  },
  "ManagedServerId": {
    "additionalProperties": false,
    "properties": {
      "pluginId": {
        "maxLength": 160,
        "minLength": 1,
        "type": "string"
      },
      "serverId": {
        "maxLength": 128,
        "minLength": 1,
        "type": "string"
      }
    },
    "required": [
      "pluginId",
      "serverId"
    ],
    "type": "object"
  },
  "ManagedServerSelection": {
    "additionalProperties": false,
    "properties": {
      "current": {
        "type": [
          "string",
          "null"
        ]
      },
      "rollback": {
        "type": [
          "string",
          "null"
        ]
      },
      "server": {
        "$ref": "#/definitions/ManagedServerId"
      }
    },
    "required": [
      "server"
    ],
    "type": "object"
  },
  "NativeLanguageServiceFailure": {
    "properties": {
      "code": {
        "$ref": "#/definitions/LanguageFailureCode"
      },
      "message": {
        "type": "string"
      },
      "project": {
        "anyOf": [
          {
            "$ref": "#/definitions/ProjectFailure"
          },
          {
            "type": "null"
          }
        ]
      },
      "requestId": {
        "type": [
          "string",
          "null"
        ]
      },
      "retryable": {
        "description": "Classification only; automatic recovery still requires current authority and a retry budget.",
        "type": "boolean"
      }
    },
    "required": [
      "code",
      "message",
      "retryable"
    ],
    "type": "object"
  },
  "NativeLanguageServiceReview": {
    "properties": {
      "executableIdentity": {
        "type": "string"
      },
      "expiresAt": {
        "format": "uint64",
        "minimum": 0,
        "type": "integer"
      },
      "packageDigest": {
        "type": "string"
      },
      "pluginId": {
        "type": "string"
      },
      "pluginVersion": {
        "type": "string"
      },
      "remembered": {
        "type": "boolean"
      },
      "resourceDigest": {
        "type": "string"
      },
      "reviewId": {
        "type": "string"
      },
      "serverId": {
        "type": "string"
      },
      "toolchains": {
        "items": {
          "$ref": "#/definitions/ToolchainSnapshot"
        },
        "maxItems": 32,
        "type": "array"
      }
    },
    "required": [
      "executableIdentity",
      "expiresAt",
      "packageDigest",
      "pluginId",
      "pluginVersion",
      "remembered",
      "resourceDigest",
      "reviewId",
      "serverId",
      "toolchains"
    ],
    "type": "object"
  },
  "ProjectFailure": {
    "additionalProperties": false,
    "properties": {
      "dependency": {
        "type": [
          "string",
          "null"
        ]
      },
      "kind": {
        "$ref": "#/definitions/ProjectFailureKind"
      },
      "module": {
        "type": [
          "string",
          "null"
        ]
      },
      "remaining": {
        "default": 0,
        "format": "uint32",
        "minimum": 0,
        "type": "integer"
      }
    },
    "required": [
      "kind"
    ],
    "type": "object"
  },
  "ProjectFailureKind": {
    "enum": [
      "dependency-offline",
      "dependency-unavailable",
      "dependency-tls",
      "dependency-dns",
      "repository-credentials-missing",
      "android-sdk-missing",
      "project-configuration-failed",
      "project-script-failed",
      "model-selected-variant-missing",
      "model-dependency-variant-missing",
      "model-dependency-variant-ambiguous"
    ],
    "type": "string"
  },
  "SymbolCandidate": {
    "properties": {
      "extractorId": {
        "type": "string"
      },
      "kind": {
        "$ref": "#/definitions/SymbolKind"
      },
      "name": {
        "type": "string"
      },
      "overlay": {
        "type": "boolean"
      },
      "range": {
        "$ref": "#/definitions/SymbolRange"
      },
      "revision": {
        "type": "string"
      },
      "workspacePath": {
        "type": "string"
      }
    },
    "required": [
      "extractorId",
      "kind",
      "name",
      "overlay",
      "range",
      "revision",
      "workspacePath"
    ],
    "type": "object"
  },
  "SymbolKind": {
    "enum": [
      "class",
      "interface",
      "enum",
      "struct",
      "object",
      "function",
      "constant",
      "variable",
      "module",
      "type"
    ],
    "type": "string"
  },
  "SymbolOverlay": {
    "additionalProperties": false,
    "properties": {
      "text": {
        "type": [
          "string",
          "null"
        ]
      },
      "workspacePath": {
        "type": "string"
      }
    },
    "required": [
      "workspacePath"
    ],
    "type": "object"
  },
  "SymbolPosition": {
    "additionalProperties": false,
    "properties": {
      "character": {
        "format": "uint32",
        "minimum": 0,
        "type": "integer"
      },
      "line": {
        "format": "uint32",
        "minimum": 0,
        "type": "integer"
      }
    },
    "required": [
      "character",
      "line"
    ],
    "type": "object"
  },
  "SymbolQueryReport": {
    "properties": {
      "filesScanned": {
        "format": "uint",
        "minimum": 0,
        "type": "integer"
      },
      "filesTotal": {
        "format": "uint",
        "minimum": 0,
        "type": "integer"
      },
      "identity": {
        "type": "string"
      },
      "matches": {
        "items": {
          "$ref": "#/definitions/SymbolCandidate"
        },
        "type": "array"
      },
      "partial": {
        "type": "boolean"
      },
      "reasons": {
        "items": {
          "type": "string"
        },
        "type": "array"
      },
      "reusedFiles": {
        "format": "uint",
        "minimum": 0,
        "type": "integer"
      },
      "scopeToken": {
        "type": [
          "string",
          "null"
        ]
      },
      "skippedFiles": {
        "format": "uint",
        "minimum": 0,
        "type": "integer"
      }
    },
    "required": [
      "filesScanned",
      "filesTotal",
      "identity",
      "matches",
      "partial",
      "reasons",
      "reusedFiles",
      "skippedFiles"
    ],
    "type": "object"
  },
  "SymbolRange": {
    "additionalProperties": false,
    "properties": {
      "end": {
        "$ref": "#/definitions/SymbolPosition"
      },
      "start": {
        "$ref": "#/definitions/SymbolPosition"
      }
    },
    "required": [
      "end",
      "start"
    ],
    "type": "object"
  },
  "ToolchainRole": {
    "enum": [
      "build-runtime",
      "build-model",
      "language-server"
    ],
    "type": "string"
  },
  "ToolchainSnapshot": {
    "additionalProperties": false,
    "properties": {
      "executable": {
        "type": "string"
      },
      "home": {
        "type": "string"
      },
      "id": {
        "type": "string"
      },
      "identity": {
        "type": "string"
      },
      "major": {
        "format": "uint16",
        "minimum": 0,
        "type": "integer"
      },
      "requirement": {
        "$ref": "#/definitions/JavaRequirement"
      },
      "role": {
        "$ref": "#/definitions/ToolchainRole"
      },
      "selectionReason": {
        "type": "string"
      },
      "source": {
        "$ref": "#/definitions/ToolchainSource"
      },
      "version": {
        "type": "string"
      }
    },
    "required": [
      "executable",
      "home",
      "id",
      "identity",
      "major",
      "requirement",
      "role",
      "selectionReason",
      "source",
      "version"
    ],
    "type": "object"
  },
  "ToolchainSource": {
    "enum": [
      "installed",
      "environment",
      "project",
      "user",
      "command-line"
    ],
    "type": "string"
  }
} as const;

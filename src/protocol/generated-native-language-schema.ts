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
  "NativeLanguageServiceFailure": {
    "properties": {
      "code": {
        "$ref": "#/definitions/LanguageFailureCode"
      },
      "message": {
        "type": "string"
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

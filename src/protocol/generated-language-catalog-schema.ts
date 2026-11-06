// Generated from native catalog models. Run npm run protocol:catalog. Do not edit.
export const LANGUAGE_CATALOG_SCHEMA = {
  "$schema": "http://json-schema.org/draft-07/schema#",
  "additionalProperties": false,
  "definitions": {
    "CatalogAffiliation": {
      "enum": [
        "language-official",
        "community"
      ],
      "type": "string"
    },
    "CatalogLanguage": {
      "additionalProperties": false,
      "properties": {
        "extensions": {
          "items": {
            "type": "string"
          },
          "maxItems": 16,
          "type": "array"
        },
        "fileNames": {
          "items": {
            "type": "string"
          },
          "maxItems": 16,
          "type": "array"
        },
        "id": {
          "type": "string"
        },
        "labelKey": {
          "type": "string"
        }
      },
      "required": [
        "extensions",
        "fileNames",
        "id",
        "labelKey"
      ],
      "type": "object"
    },
    "CatalogPlatform": {
      "enum": [
        "macos-arm64",
        "macos-x64",
        "linux-arm64",
        "linux-x64",
        "windows-arm64",
        "windows-x64"
      ],
      "type": "string"
    },
    "CatalogServer": {
      "additionalProperties": false,
      "properties": {
        "id": {
          "type": "string"
        },
        "labelKey": {
          "type": "string"
        },
        "languageIds": {
          "items": {
            "type": "string"
          },
          "maxItems": 16,
          "minItems": 1,
          "type": "array"
        },
        "platforms": {
          "items": {
            "$ref": "#/definitions/CatalogPlatform"
          },
          "maxItems": 6,
          "minItems": 1,
          "type": "array"
        },
        "requireRootMarker": {
          "type": "boolean"
        },
        "rootMarkers": {
          "items": {
            "type": "string"
          },
          "maxItems": 8,
          "type": "array"
        },
        "upstream": {
          "$ref": "#/definitions/CatalogUpstream"
        }
      },
      "required": [
        "id",
        "labelKey",
        "languageIds",
        "platforms",
        "requireRootMarker",
        "rootMarkers",
        "upstream"
      ],
      "type": "object"
    },
    "CatalogUpstream": {
      "additionalProperties": false,
      "properties": {
        "affiliation": {
          "$ref": "#/definitions/CatalogAffiliation"
        },
        "repository": {
          "type": "string"
        }
      },
      "required": [
        "affiliation",
        "repository"
      ],
      "type": "object"
    }
  },
  "properties": {
    "languages": {
      "items": {
        "$ref": "#/definitions/CatalogLanguage"
      },
      "maxItems": 16,
      "minItems": 1,
      "type": "array"
    },
    "schemaVersion": {
      "format": "uint32",
      "maximum": 1,
      "minimum": 1,
      "type": "integer"
    },
    "servers": {
      "items": {
        "$ref": "#/definitions/CatalogServer"
      },
      "maxItems": 16,
      "type": "array"
    }
  },
  "required": [
    "languages",
    "schemaVersion",
    "servers"
  ],
  "title": "LanguageServerCatalog",
  "type": "object"
} as const;
export const LANGUAGE_CATALOG_PATTERNS = {
  "extension": "^\\.[a-z0-9]+(?:\\.[a-z0-9]+)*$",
  "fileName": "^[A-Za-z0-9._-]+$",
  "labelKey": "^[A-Za-z0-9](?:[A-Za-z0-9._-]{0,158}[A-Za-z0-9])?$",
  "languageId": "^[a-z][a-z0-9-]{0,63}$",
  "repository": "^https://github\\.com/[A-Za-z0-9][A-Za-z0-9-]{0,38}/[A-Za-z0-9][A-Za-z0-9._-]{0,99}$",
  "serverId": "^[a-z][a-z0-9.-]{0,127}$"
} as const;

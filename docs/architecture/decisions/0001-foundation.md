# ADR-0001: Rust capability core with a replaceable Tauri and CodeMirror presentation

- **Status:** Accepted for M1; review at the end of Stages 2 and 3
- **Date:** 2026-09-08

## Context

Asterlyn must deliver a lightweight Git workbench quickly while preserving a credible path toward editor, language, debug, extension, remote, and AI capabilities over 3–5 years. Tying product logic directly to a desktop shell or editor widget would make that evolution expensive.

## Decision

Use Rust for UI-independent capabilities and application policy, Tauri 2 as the initial desktop shell/transport, and CodeMirror 6 as the initial editor/diff surface. Keep the web UI framework-light in M1. Put system-Git invocation and parsing in a pure Rust crate that can be tested without native webview development packages.

Use system Git for canonical mutation semantics. Add optimized readers only behind the Git capability interface and only after benchmark evidence.

## Consequences

- The first vertical slice has more explicit boundaries than a single Tauri example application.
- Core Git behavior can be tested even when a machine lacks WebKitGTK build headers.
- Tauri and CodeMirror remain replaceable, but replacement still has a real cost and must be evidence-driven.
- Some logic will remain in TypeScript where it is inherently presentational; duplicating a domain model in both languages is avoided.
- A public extension ABI is deferred until internal capability contracts have production history.

## Revisit triggers

- Tauri prevents required accessibility, windowing, input-method, or process-isolation behavior on a target platform.
- CodeMirror cannot meet measured large-file, IME, accessibility, or language-feature requirements.
- System Git startup dominates interaction latency in measured repositories and a safe read-path accelerator demonstrates clear benefit.
- Serialization overhead or boundary churn materially harms maintainability.


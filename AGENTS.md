# AI Agents Guide for NEJY

Welcome! If you are an AI agent working on the `nejy` project, this document provides critical context, architecture rules, and guidelines to help you navigate and contribute effectively to the codebase.

## 1. Documentation Reference
- **Locations**: You can find documentation in the `docs/` and `ai-generated-docs/` directories.
- **Warning**: These documents might occasionally be out of date or obsolete. Always rely on the source code as the ultimate source of truth when determining current behavior.

## 2. Architecture & Risk Model
`nejy` is designed as a risk-controlled, embedded scripting language intended for use within other systems. It operates under a strict risk model that must be respected at all times:

- **LOW**: Safe operations, primarily manipulating the program's own data.
- **MEDIUM**: Operations involving the filesystem or external data (e.g., reading).
- **HIGH**: Operations with the ability to alter data or environment state in a regulated fashion.
- **INSANE**: Operations that can do anything else, free from strict controls. Note that even `INSANE` capabilities are often limited to what is explicitly permitted in the registry.

**Crucial Constraints:**
- **No Privilege Escalation**: When writing code or adding new features, you must guarantee that scripts cannot perform privilege escalation to run at risk levels above the declared policy.
- **No Servers/Ports**: `nejy` does not generally open ports or start servers. Do not add commands, registry entries, or capabilities to do so natively. Such tasks should be handled externally by the host application embedding `nejy`.
- **New Commands**: When creating a new command for `nejy`, carefully evaluate whether the assigned risk level is appropriate.

## 3. Development & Security Guidelines
- **Adding Commands**: If you add a new interpreter command, you must define its handler in `lib/interp/commands.mjs` and also add it to `HANDLED_COMMANDS` in `lib/interp/scanner.mjs` to ensure the Security Scanner statically analyzes it to prevent bypasses.
- **Security Layers**: `nejy` employs a "belt and suspenders" approach. **Do not remove any pre-existing security code**, even if it seems redundant. Features like prototype pollution protections (via `removePP` or freezing module prototypes) are critical.
- **Testing**: The project uses the native Node.js test runner. Always run tests using `npm run test:all` to ensure regressions are caught.
- **Test-Driven Development (TDD)**: Write failing tests before implementing new functionality. Do not mock outputs simply to pass tests (Feynman principle: "don't fool yourself").

## 4. Leverage Existing Dependencies
Prefer leveraging the built-in Node.js standard library or existing high-quality modules rather than writing complex custom logic where possible. You should review `package.json` to see what is already available. For example:
- **`zod`**: Use for strict, generated-code-free schema validation.
- **`mathjs`**: Use for safe mathematical parsing and evaluation.
- **`jsonpath-plus`**: Use for advanced JSON querying.
- **`fast-json-patch` / `json-pointer`**: Use for JSON patching and manipulations.

## 5. Writing NEJY Scripts
When writing `nejy` scripts (e.g. for testing or examples), adhere to the following best practices:
- **Format**: Prefer **YAML** over JSON for all `nejy` scripts unless JSON is explicitly requested.
- **Discovery**: Scan the source code (particularly `lib/interp/commands.mjs`) for available commands, and explore the registry configurations (`config/security/registry/`) so you know what capabilities and modules are available.
- **Command Choice**:
  - Prefer using the `TO` command for mapping or assigning results directly, rather than running `EXEC` followed by referencing `$LAST`.
  - Prefer using the `PIPE` command when executing method chaining.
- **Functions**: Prefer using the configured `mathFunction` capability to create JavaScript functions dynamically from mathematical expressions, rather than passing raw string callbacks or building functions manually.
- **Iteration**: Prefer native Array operations (`map`, `reduce`, `forEach`), which are available in the builtins registry, over the `nejy` `FOR_EACH` command.

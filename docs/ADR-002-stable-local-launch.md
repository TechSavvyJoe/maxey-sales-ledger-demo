# ADR-002: Stable local launcher origin

**Status:** Accepted for version 1.1\\
**Decision date:** 2026-08-31\\
**Decider:** Product owner, pending dealership approval for any hosted rollout

## Context

The static application was opened by double-clicking `index.html`. Browsers block the required JavaScript modules under a `file://` origin, so the page appeared blank. Even when files load, service workers require HTTPS or localhost and IndexedDB belongs to an exact browser origin. Automatically choosing a different free port would make existing sales appear missing because the new port receives a separate browser database.

The local option needs to be simple for salespeople, must not stop unrelated software, and must preserve one predictable data origin. Coworker distribution still needs a hosted HTTPS URL rather than developer tooling.

## Decision

Provide a dependency-free Node.js launcher with macOS and Windows double-click wrappers.

- Bind only to `127.0.0.1:4180`.
- Serve the built static app with safe path resolution, explicit MIME types, cache rules, and local security headers.
- Expose a health marker containing the launcher version and a deterministic fingerprint of every file in the built app, so another launcher can distinguish the exact build from an unrelated process or altered package.
- Reopen an already-running matching version.
- Refuse to replace a different Sales Ledger version or unrelated process on port 4180.
- Never kill a process and never fall back to another port.
- Keep the server in the foreground so the user can see that closing its window stops the local app.
- Show recovery instructions when `index.html` is opened under `file://`.

## Options considered

### Direct file opening

| Dimension | Assessment |
|---|---|
| Simplicity | Appears simple, but fails in current browsers |
| Offline support | No service worker |
| Data consistency | File-origin storage behavior is not a supported contract |

Rejected because the production JavaScript, service worker, and browser database require a trustworthy hosted origin.

### Automatically choose any free port

| Dimension | Assessment |
|---|---|
| Startup success | High |
| Data consistency | Unacceptable; every port is a different IndexedDB origin |
| Supportability | Users may believe saved records were lost |

Rejected because convenience at startup would create a serious data-recovery risk.

### Single self-contained HTML artifact

| Dimension | Assessment |
|---|---|
| Sharing | Convenient for demonstrations |
| PWA/offline behavior | Cannot provide the supported service-worker lifecycle |
| Maintainability | Duplicates the authoritative production build and complicates updates |

Rejected as the primary tracker. It can be useful for disposable demos, but not as the authoritative local sales workspace.

### Stable loopback launcher

| Dimension | Assessment |
|---|---|
| Complexity | Low; Node.js standard library only |
| Data consistency | Strong when the exact address and browser profile are reused |
| User experience | One double-click, visible running state, friendly collision errors |

Accepted for local use. An approved static HTTPS deployment remains the preferred coworker experience.

## Consequences

- Node.js 22 or newer is required for the packaged local option.
- The launcher window must remain open.
- A real port collision requires the user to close the owning app or get help; the launcher will not silently change origins.
- `127.0.0.1`, `localhost`, other ports, other browsers, and other devices remain separate data workspaces.
- The launcher does not add accounts, cloud sync, central backup, or manager visibility.
- The deploy ZIP remains the authoritative package for an approved HTTPS host.

## Acceptance checks

1. Direct `file://` opening presents recovery instructions.
2. The launcher serves the full built app and versioned health marker on the exact origin.
3. Closing and restarting the launcher preserves a saved sale in the same browser profile.
4. A matching running launcher reopens without starting a second server.
5. Same-version packages with any altered built file, different launcher versions, and unrelated listeners are refused without being stopped.
6. The extracted Local ZIP has the documented root layout and the macOS launcher retains executable permission.
7. Windows wrapper execution, browser opening, and downloaded-ZIP behavior remain a manual Windows acceptance check.

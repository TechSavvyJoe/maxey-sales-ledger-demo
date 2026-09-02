# ADR-003: User-selected automatic recovery folder

**Status:** Accepted for version 1.5; broadened for existing Google Drive folders in 1.6\\
**Decision date:** 2026-08-31\\
**Decider:** Product owner

## Context

Each salesperson needs recovery copies without installing a Sales Ledger application, asking Joe to store coworker data, registering an Entra application, requesting Microsoft Graph consent, or involving dealership IT. A shared Excel workbook is not suitable as the database because it creates locking, formula, conflict, and privacy risks.

The browser File System Access API can grant a secure site access to a folder selected through a user action. Desktop Edge and Chrome can store the returned handle in IndexedDB and renew permission when required. If that folder is already inside the user's locally synced OneDrive or Google Drive, the desktop sync client can handle upload separately.

## Decision

Keep the existing Sales Ledger IndexedDB database as the authoritative working copy and add an optional, device-local automatic recovery destination.

- The salesperson chooses a private parent folder. Sales Ledger creates `Sales Ledger Backups` and `Recovery History` beneath it.
- Store the folder handle, selection identity, last verified checksum, and last successful time in a separate device-integration IndexedDB database. Never serialize the handle into a full backup, report, diagnostic file, profile, or audit event.
- Request folder permission only after a direct button selection. On startup, query permission without opening a prompt; show **Reconnect folder** when another user gesture is required.
- After a committed sale, settings save, import, demo change, or restore, debounce briefly and capture settings, sales, and activity in one read transaction.
- Serialize writes in the current page and across tabs. Before writing, compare the existing current-file checksum with the last checksum verified by this browser.
- Stop on missing, damaged, unrecognized, or externally changed files. Never silently overwrite a conflicting recovery copy.
- Write a dated recovery file and the current file, await close, reopen both, run the full backup parser, and verify the data checksum before recording success.
- Preserve **Download full backup** as the universal fallback.

## Boundaries

- This is automatic recovery backup, not live bidirectional sync or a shared multi-user database.
- Sales Ledger sees a local folder handle, not its full path or Microsoft tenant identity.
- A successful write means only **saved and verified in the selected local folder**. It does not prove OneDrive or Google Drive uploaded the file.
- A new browser profile, origin, or computer must select the folder again. Data from another computer is restored explicitly and never merged automatically.
- Managed Edge policy can block website file access. The application cannot and will not bypass that restriction.
- The feature does not distribute or host the application. Coworkers without the local launcher still need one stable HTTPS link.

## Alternatives considered

### Microsoft Graph and Entra application registration

Rejected for the no-IT path because it requires an application identity, redirect-URI management, tenant/user consent behavior, token handling, and ongoing integration ownership.

### Shared Excel workbook as the database

Rejected because workbooks can be open or locked, conflicts can create extra copies, and formulas or structure can be changed outside the tracker. Excel remains a generated report.

### Browser database only

Retained as the primary copy but insufficient as the only recovery control because clearing site data, changing browser profiles, or replacing a computer can remove access.

## Acceptance checks

1. Supported, unsupported, prompt, denied, revoked, canceled, missing-folder, quota, and verification-failure states leave committed browser data untouched.
2. The handle survives reload and survives a full workspace restore.
3. Identical data performs no redundant file write and heals stale success metadata.
4. External checksum changes and corrupt files are never overwritten.
5. Concurrent tabs serialize and cannot replace a newly selected folder binding.
6. A real Edge/Windows test confirms permission behavior and separately confirms the file appears on the selected cloud provider's website when a synced folder is used.

## References

- [Chrome File System Access guidance](https://developer.chrome.com/docs/capabilities/web-apis/file-system-access)
- [Chrome persistent file-system permissions](https://developer.chrome.com/blog/persistent-permissions-for-the-file-system-access-api)
- [File System Access specification](https://wicg.github.io/file-system-access/)
- [Microsoft Edge file-system write policy](https://learn.microsoft.com/en-us/deployedge/microsoft-edge-policies/defaultfilesystemwriteguardsetting)
- [Microsoft OneDrive Files On-Demand](https://support.microsoft.com/en-us/onedrive/save-disk-space-with-onedrive-files-on-demand-for-windows)
- [Google Drive for desktop system requirements](https://support.google.com/drive/answer/2375082)

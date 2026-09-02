# ADR-004: No-admin Google Drive backup handoff

**Status:** Accepted for version 1.6\\
**Decision date:** 2026-08-31\\
**Decider:** Product owner

## Context

Salespeople need a Google option without dealership IT, application installation, a Sales Ledger backend, or Joe managing coworker accounts or data. A direct browser Google Drive connection would require an owned Google Cloud project, Drive API enablement, an OAuth web client, exact authorized origins, consent-screen and privacy-policy maintenance, and a user-triggered token renewal after short-lived browser tokens expire.

The tracker already creates complete checksum-verified JSON recovery files and can write automatically to a user-selected local folder. Google Drive's normal website accepts file uploads after Google handles its own sign-in.

## Decision

Do not add Google OAuth in the no-admin release. Provide two transparent paths:

1. If Google Drive for desktop is already visible in File Explorer or Finder, the salesperson may select a private folder through the existing automatic recovery-folder control. Existing read-back verification and conflict stopping remain unchanged.
2. Otherwise, **Google Drive backup** prepares the exact full JSON file, parses it again to validate the complete schema and SHA-256 data checksum, then enables **Download & open Google Drive**. The browser downloads the checked file and opens `https://drive.google.com/drive/my-drive`; the salesperson signs in with Google and uses **New → File upload**.

The interface must never call either path connected, synced, or a verified Google upload. Only the local file preparation or local folder write is verified. The salesperson confirms cloud arrival in Google Drive.

## Consequences

- No Google credentials, tokens, client secret, Cloud project, backend, account mapping, or Drive file listing enters Sales Ledger.
- Personal and Workspace Google accounts can use the manual website path unless local policy blocks Google Drive itself.
- The app cannot choose the remote folder, confirm upload, restore automatically from Drive, or run unattended cloud backups.
- Users with an already-installed desktop sync client retain automatic local-folder recovery copies while the app is open.
- Complete backups remain unencrypted confidential files and must be stored only in an approved private location.

## Alternatives considered

### Google Identity Services plus Drive API

Rejected for this no-admin path. The recommended `drive.file` scope is narrow, but the integration still needs OAuth application ownership and production-origin configuration. Browser access tokens are short-lived and a replacement token must be requested from a user gesture, so it is not permanent set-and-forget backup without a backend.

### Google “Save to Drive” website widget

Rejected for generated local backups. Google's widget expects a same-origin or CORS-accessible HTTP(S) file URL and does not support data or `file://` URLs. Publishing each salesperson's confidential backup at a retrievable URL would violate the local-ownership design.

## Acceptance checks

1. Unsaved Settings prevent backup preparation.
2. The exact prepared file survives a full parser and checksum round trip before the Drive action appears.
3. The Google Drive link uses the official HTTPS destination, a new tab, and `noopener noreferrer`.
4. Preparation failure never displays a ready, connected, synced, or uploaded state.
5. The downloaded JSON can be selected in Google Drive, downloaded again, validated, and restored through the normal reviewed restore workflow.
6. The interface states that Google sign-in and upload happen on Google's website and that Sales Ledger cannot confirm cloud arrival.

## References

- [Google browser token model](https://developers.google.com/identity/oauth2/web/guides/use-token-model)
- [Create a Google browser client ID](https://developers.google.com/identity/oauth2/web/guides/get-google-api-clientid)
- [Choose Google Drive API scopes](https://developers.google.com/workspace/drive/api/guides/api-specific-auth)
- [Google Drive upload guidance](https://support.google.com/drive/answer/2424368)
- [Google Drive branding guidance](https://developers.google.com/workspace/drive/api/guides/branding)
- [Google Save to Drive widget requirements](https://developers.google.com/workspace/drive/api/guides/savetodrive)

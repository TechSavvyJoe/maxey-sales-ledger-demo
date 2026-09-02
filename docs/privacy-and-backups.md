# Privacy, storage, and backup guide

## Where data lives

Sales Ledger stores working records in IndexedDB inside the current browser profile. It does not create an account, transmit sales to a Sales Ledger server, provide live two-way sync, or let a manager see the data. The app can request persistent browser storage, but browsers may decline; complete JSON recovery copies remain the recovery control.

Current desktop Edge and Chrome can also write automatic recovery copies to a private folder the salesperson selects. That folder may be inside an existing locally synced OneDrive or Google Drive folder, but Sales Ledger sees only the chosen local folder. It cannot identify the cloud account or prove that the sync client uploaded the file.

Anyone with access to the unlocked device and browser profile may be able to view the records. Use an operating-system login, screen lock, encrypted device storage, and a dedicated browser profile where appropriate. An in-app PIN would not encrypt IndexedDB and is therefore not presented as security.

## Appropriate fields

- Customer last name
- Stock number
- Vehicle description
- Delivery or expected date
- Deal status and credited unit amount
- Credited front-end gross
- Total eligible F&I gross
- Short non-sensitive notes
- Monthly actual commission paid as a number for reconciliation
- Personal days off used for monthly pacing

## Never enter

- Social Security numbers
- Driver-license numbers or images
- Credit applications, reports, scores, or lender stipulations
- Bank, debit-card, credit-card, or routing information
- Insurance documents or policy information
- Passwords, authentication codes, or security answers
- Deal jackets, paystub images, signed forms, or customer screenshots
- Customer phone numbers, email addresses, full addresses, or dates of birth

Use DealerMail, CDK, and the dealership's approved secure process for transaction records and sensitive customer information.

## Automatic recovery folder

1. Open **Settings → Automatic backup folder → Choose backup folder**.
2. Choose a private Documents folder or a private folder already inside the salesperson's locally synced OneDrive or Google Drive. Sales Ledger creates a `Sales Ledger Backups` subfolder.
3. Allow folder access when Edge or Chrome asks. A permission prompt is shown only after a direct button selection; it is never opened silently during startup.
4. Confirm the card shows **Automatic backups on** and a recent **Last successful backup** time.
5. Periodically confirm the files exist in the folder. If OneDrive or Google Drive is being used, separately confirm the cloud website shows the expected upload; Sales Ledger cannot verify cloud arrival.

The app writes `Sales Ledger - Current Backup.json` plus a dated copy in `Recovery History`, closes each write, reopens it, validates the full schema, and checks the data checksum before recording success. If the current file is missing, damaged, or changed outside this browser, the app stops and asks for review instead of overwriting it.

Folder access is stored only in that browser profile and website address. A new computer, browser profile, or site address must select the folder again. Managed browser policy can block file access; the app cannot bypass that policy, and **Download full backup** remains available.

## Google Drive web handoff

Use **Settings → Google Drive backup** when Google Drive for desktop is not already available:

1. Select **Save to Google Drive**. Sales Ledger creates the complete JSON backup and parses the exact file again to verify its schema and checksum.
2. When **Backup checked and ready** appears, select **Download & open Google Drive**.
3. Sign in on Google's website if asked. In Google Drive, select **New → File upload** and choose the displayed `.json` filename from Downloads.
4. Confirm the file appears in the intended private Drive location. Sales Ledger cannot see the Google account or confirm the upload.

This is a manual handoff, not a connected Google account or automatic cloud sync. It requires no Google Cloud developer project, OAuth client, access token, backend, dealership administrator, or installation. Use only an account and storage location permitted for dealership work. The backup is unencrypted and includes customer last names, gross and commission values, days off, deleted records, settings, and activity.

## Manual backup routine

1. Open **Settings → Download full backup** at least weekly and after major imports or corrections.
2. Confirm the browser saved the `.json` file, then move it to an approved, access-controlled location. A download start is not proof that the file exists.
3. Keep more than one recent copy so an accidental overwrite is recoverable.
4. Treat backups as confidential: they contain last names, stock numbers, gross/payroll values, exact saved days off, settings, activity, and soft-deleted rows.
5. Test restore using a separate browser profile or test device before depending on the process.

JSON is the only complete recovery format. Excel, CSV, and PDF files are reports and cannot recreate the full activity history and settings. The report option to omit last names does not change complete JSON backups. Backup JSON is unencrypted plaintext. Its checksum detects accidental alteration; it is not encryption, authentication, or a tamper-proof signature.

Delete and **Remove demo data** are recoverable soft deletes. The records stop appearing in active views and calculations but remain in IndexedDB and complete backups. There is no permanent purge or retention scheduler; decide and document an approved purge/retention process before a centrally shared rollout.

Do not rely on private/incognito browsing for durable storage. Browser storage is scoped to the exact origin and browser profile, so a different hostname, port, device, or profile needs an explicit JSON migration.

## Sharing reports

The report screen includes an option to omit customer last names. Use the summary/last-name-omitted form when deal-level identity is unnecessary. Stock numbers and gross/commission figures are still internal operational data; share them only with authorized coworkers through an approved channel.

## Restore safety

Restore validates file type, size, schema version, allowed values, and checksum. A folder recovery copy can be reviewed through **Folder options** and enters the same restore-safety flow as a manually selected file. Because restore replaces the current local workspace, the interface starts a current safety-backup download and requires the user to confirm that the file exists and can be opened before the final replace action.

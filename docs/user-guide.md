# Sales Ledger user guide

## Open the app

For the packaged local app, double-click **Start Maxey Sales Ledger.command** on macOS or **Start Maxey Sales Ledger.cmd** on Windows. Leave that window open while using Sales Ledger. Both starters use the exact address `http://127.0.0.1:4180/`.

Do not open `index.html` directly. If you do, follow the recovery instructions shown on that page.

Always use the same address and the same browser on the same computer. A different address, browser, or computer opens a separate workspace. Move sales between workspaces only with a checked full backup and restore.

## First use

1. Open **Settings** and enter the salesperson name. Set the selected month’s delivery goal and, if useful, its optional commission goal. A saved month can override the profile defaults without changing another month.
2. Review the pay-plan settings. Milestone bonuses stack into the running monthly total included in Estimated Commission.
3. In **Work schedule**, open **Choose days off**, select any Monday–Saturday dates you expect to take off, then save. Sundays are already excluded.
4. Select **Protect saved sales** to ask the browser for extra storage protection.
5. In current desktop Edge or Chrome, select **Automatic backup folder** and choose a private Documents, OneDrive, or already-installed Google Drive folder.
6. If a synced folder is unavailable, use **Google Drive backup** to create a checked download and open Google Drive for a manual upload.
7. Download a full backup after entering initial records so the manual recovery path is also confirmed.

For training, **Load demo data** adds clearly labeled fictional sales. The public GitHub Pages link opens with two years of fictional history automatically for a new visitor. Changes and removals stay in that visitor's browser; use **Settings → Refresh 2-year demo** to reload the samples.

## Add a sale

Select **Add sale** from any page. The form opens on customer last name and keeps the most-used fields large and close together:

1. Choose Delivered or Pending. If the deal does not deliver, delete it from the log.
2. Enter the delivery/expected date.
3. Enter customer last name, stock number, credited front gross, and total eligible F&I gross.
4. Check the products sold—**Service contract / warranty**, **Tire & Wheel**, and **GAP**—and select **Finance**, **Cash**, or **Outside Finance**. Payment method is separate from product sales. Leave F&I gross blank until your F&I manager supplies it.
5. Vehicle and Notes stay visible. Use the small **Split deal** checkbox for a half deal. If a manager sets a specific payout, enable **Spiff / manual front commission** and enter your personal front payout, not an add-on or the whole shared deal's payout.
6. Review **Front**, **F&I**, and **Sale total**, then select **Save sale** or **Save & add another**. The second option focuses a clean last-name field and resets the manual payout option for the next deal.

Currency fields accept values such as `2500`, `$2,500`, or `2500.00`. Stock numbers are preserved as entered, including leading zeroes.

**Settings → Pay plan → Mini** controls the automatic minimum, initially $300 ($150 for half deals). The plan's effective-month range applies. Manual/spiff payouts stay as entered regardless of Mini changes. Negative front gross still appears in gross totals, but does not create negative front commission or reduce pay on other sales.

Only one total F&I gross amount is stored for the deal. Do not estimate or invent a dollar amount for any individual product or financing outcome. An older record whose outcome was never entered can remain **Not marked** until reviewed.

## Change the month

Use the single period control in the top header:

- Left/right arrows move one month.
- Selecting the month label opens a 12-month grid and year arrows.
- **This month** returns to the current calendar month.

The selected period stays synchronized across Dashboard, Sales, and Reports in that browser tab. Each open tab keeps its own month and page selection for the session, so changing a report in one tab does not silently move another tab.

To adjust pacing for that period, open **Settings → Work schedule → Choose days off**, select personal days off, and save before changing months. Past months show the final delivered total, the current month shows a projection after the first scheduled workday, and future months stay **Not started**.

The picker will not move before the earliest configured pay-plan month. To enter or import older sales, add a historical effective-dated plan in Settings first. A partial-coverage year shows only the months the configured plan covers.

## Review and correct sales

Open **Sales** to search by last name, stock number, or vehicle and filter by status, **Needs attention**, or **Deleted**. Sort by date, customer, attention status, pending status, front gross, F&I gross, or core commission. A filtered view shows its matching totals and one **Clear** action. Product badges show recorded deal outcomes. Select a row to edit it.

Records may need attention for duplicate delivered stock, missing stock, invalid/future date, missing front gross without a manual payout, a negative F&I correction, or a Pending date that has passed. Zero/negative front gross with a Mini is not an error. Dashboard, Sales, and Reports use the same record-based count. Duplicate delivered records are excluded from delivered count and commission until corrected. Normally edit an existing Pending record to Delivered instead of creating a second record.

Delete is a soft delete and first offers **Undo**. If that message is gone, open **Deleted** for the selected month and restore the record there. Deleted rows remain in full backups and Sales Ledger does not permanently erase them.

If the same sale changed in another tab after you opened it, Sales Ledger refuses to overwrite the newer saved revision. Your form stays open; use **Load latest**, review the current record, and apply your change again.

## Understand the dashboard

- **Delivered** counts valid unique delivered stock numbers for the selected month.
- **Cumulative volume bonus** shows the running total earned across reached milestones.
- **Estimated commission** includes front commission, F&I commission, and the earned cumulative volume bonus.
- **Front rate** shows 30% at exactly 10 and 35% after the month exceeds 10, retroactive to the first qualifying sale.
- **Workday pace** uses valid delivered vehicles divided by scheduled workdays completed, then projects that rate across the month's remaining Monday–Saturday workdays. Personal days off saved for that month are excluded.
- **This week** converts the monthly delivery goal into a cumulative, workday-weighted checkpoint and shows how many more valid deliveries are needed by the current Saturday. It does not pretend future sales have already happened.
- **Commission pace and projection** uses workday pace, the observed automatic-pay mix, the effective front rate, Mini, and cumulative bonuses. Existing manual payouts are included once, not repeated on future sales. It shows low/high whole-delivery scenarios and is a planning estimate, not guaranteed payroll.
- When a month closes, the commission panel switches to **Final recorded commission** and stops describing the saved result as an active projection.
- **F&I outcomes** shows product results for service contract/warranty, Tire & Wheel, and GAP, plus dealer financing as a separate operational outcome. Each valid delivered deal is one denominator deal, including a half deal; credited units remain separate. Yes, No, and Not marked remain distinct so incomplete entries do not look like confirmed No results.
- **Performance insights** shows front and F&I gross per valid delivery, F&I entry coverage, the previous-three-covered-month average, selected-year totals, and progress to the higher front rate.
- **Attention needed** lists the same affected records used by Sales and Reports. Select an item or recent sale to edit it directly.
- **Previous month** and the selected-year trend provide quick context without changing tabs.

When demo records are active, a persistent notice appears above every page. Demo records are included in the displayed totals and exported reports until they are removed in **Settings → Data**.

## Reports and exports

Open **Reports** for:

- Monthly detail and commission breakdown
- A week-by-week selector for the selected month, with one week’s sold count, credited units, gross, core commission, pace-versus-checkpoint, outcome rates, and deals
- The current week’s cumulative checkpoint and the exact number still needed by week end
- Monthly unit pace, commission projection, and optional earnings-goal progress
- Selected-year totals and month-by-month results
- Actual-paid versus estimated payroll reconciliation
- CSV detail, Excel workbook, and print/PDF report exports

Use the **Month / Week / Year / Payroll** tabs to choose the report scope:

- **Month** shows the selected calendar month.
- **Week** shows one selected Monday-through-Saturday window clipped to that month. Past weeks show final recorded results, the current week shows its required checkpoint, and future weeks show targets without projecting unrecorded sales. A Sunday-dated valid delivery stays in the Month total but is called out and excluded from weekly pace.
- **Year** shows the selected calendar year. Its YTD figures run from January through the selected month, even when later months remain visible for full-year context. Later historical months are labeled outside the selected period; only calendar-future months are labeled Upcoming.
- **Payroll** compares the selected month's estimate with the actual-paid amount entered for that month.

The report heading and controls show the active scope. On a narrow screen, cards replace wide tables but keep the same period, record order, labels, values, and actions.

The Year view marks future months **Upcoming** and leaves not-yet-meaningful result fields blank. Closed months retain their final recorded estimates; only the active month uses planning projection language.

Outcome reporting keeps **Yes**, **No**, and **Not marked** separate. Service contract/warranty, Tire & Wheel, and GAP are products; Dealer financed is a separate financing outcome. A matching-outcome cohort may sum the one total F&I gross for its deals, with each deal counted once inside that cohort. Because the same deal can match more than one outcome, cohort gross overlaps and must not be added across rows or read as gross earned by an individual product or financing choice.

Reports use records in this browser profile and remain personal estimates and reconciliation aids. The Payroll report is not an official pay statement, and exporting a report does not send it to payroll or prove approval.

Turn off **Include customer last names** for a more share-safe report. This option affects Print/PDF, monthly CSV, and Excel only; stock numbers remain included. Browser **Print / Save PDF** creates the PDF and the app does not upload it.

**Private backup** is intentionally separate from the Export menu and opens the Data section in Settings. A full recovery backup always includes last names, deleted rows, gross/payroll values, goals, work schedules, settings, and activity, regardless of the report’s name option.

## Import the prior Excel tracker

Open **Settings → Import prior Excel tracker**, select the workbook, and review added/rejected counts before applying. The importer does not execute macros and ignores workbook commission/calculation columns. It imports displayed values from recognized entry columns, preserves stock text, and recalculates commissions using this app's pay plan. When recognized service-contract/warranty, Tire & Wheel, GAP, or dealer-financing columns exist, their recorded outcomes are imported; missing outcome columns remain **Not marked**, distinct from a confirmed No result.

## Change goals or the pay plan

The goal fields apply to the month selected in the header. Saving an override for one month does not rewrite a different month; months without an override continue to use the profile defaults.

Before saving a pay-plan change, review **Impact before saving**. It shows the effective date range, the number of saved sale months affected, and the resulting estimated-commission difference across those months. **Saved pay-plan history** preserves the effective-dated schedule, while **Activity** records the plan identity, effective month, rates, and threshold before and after a calculation change. These are local review aids, not an official payroll audit ledger.

## Restore a backup

Open **Settings → Restore full backup** and review the salesperson, record count, and creation time. Restore replaces the current profile, settings, sales, and activity; it does not merge workspaces. Download a current safety backup, confirm that the file exists and opens, then approve replacement. Original record-source labels and deleted rows are preserved.

If automatic folder backups are on, select **Folder options → Review folder backup** to open the same checked restore preview. Sales Ledger will not silently pull another computer's changes into the current workspace.

## Automatic backup folder

- **Automatic backups on** means Sales Ledger successfully wrote and reread the local recovery file. It does not mean OneDrive or Google Drive finished uploading it.
- Backups run after completed changes while Sales Ledger is open. Unsaved form or Settings changes are not included.
- If the folder needs permission after restarting the browser, select **Reconnect folder** and allow access.
- If the folder copy changed elsewhere, review it before deciding whether to restore it; Sales Ledger will not overwrite it automatically.
- **Turn off automatic backups** leaves existing files in the folder and keeps all current sales in the browser.
- Full recovery files contain last names, gross and commission values, saved days off, deleted records, settings, and activity. Never use a shared Teams or department folder.

## Google Drive backup

Select **Settings → Google Drive backup → Save to Google Drive**. Wait for **Backup checked and ready**, then select **Download & open Google Drive**. Google Drive opens in another tab. Sign in there if needed, select **New → File upload**, and choose the exact filename shown by Sales Ledger.

Google handles the account sign-in. Sales Ledger never receives the Google account, password, access token, or permission to browse Drive. This is a manual recovery copy—not live sync—and the salesperson must confirm that the file appears in the intended private Google Drive location.

## Install and offline use

When using an approved secure web address, use the browser's **Install app** or **Add to Home Screen** option. After one successful online load, the app is designed to reopen offline. Export a fresh full backup before browser or device maintenance, and confirm the downloaded file exists before relying on it.

The packaged local starter requires Node.js 22 or newer and must remain open while you use Sales Ledger. A stable secure hosted link is the recommended way to share the app with coworkers because they only need the link; automatic folder backup handles recovery data but does not host or distribute the application itself.

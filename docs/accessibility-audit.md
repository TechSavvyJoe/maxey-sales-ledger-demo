# Accessibility audit

**Audit target:** Maxey Sales Ledger 1.6\\
**Standard:** WCAG 2.2 Level A and AA\\
**Automated coverage:** Desktop, mobile, and tablet Chromium viewports

## Summary

The release is designed for keyboard, mouse, and touch users, with larger sales-entry controls and straightforward labels for salespeople who are not comfortable with complex software. Automated Axe scans cover the fresh Dashboard, Settings, Reports, and open month picker plus demonstration-data Dashboard and Sales states across desktop, mobile, and tablet Playwright projects. Browser workflows also exercise the fast-entry disclosure, every unsaved-close path, and backup-restore safety. They do not cover every dialog or assistive-technology combination.

Automated scans do not replace assistive-technology and human usability testing. VoiceOver, NVDA, browser-native 200% zoom, Windows high-contrast mode, and a novice-salesperson task walkthrough remain release-acceptance checks on the actual hosted URL.

## Findings addressed

- The goal-scale caption initially used a low-contrast gray. It was changed to the darker neutral text color and the automated scan then passed.
- Statuses pair color with explicit Delivered, Pending, Void, Ready, Warning, or Needs review text.
- All sales-entry fields use persistent visible labels and field-level error text.
- Focusable controls have a high-contrast visible focus outline and offset.
- Dialog and sheet primitives provide focus containment, Escape close, accessible titles, and focus return.
- Icon-only period arrows and utility controls have accessible names.
- The monthly chart has a visible, collapsible, keyboard-reachable month-by-month data table.
- Reduced-motion preferences disable animation and smooth scrolling.
- Mobile actions and primary inputs use approximately 44–48 px targets.
- Work-schedule dates are native buttons with 48–52 px targets, visible **Off** text, `aria-pressed`, keyboard operation, and polite change announcements.
- The layout reflows into stacked mobile summaries instead of requiring a wide spreadsheet table.
- Loading, online/offline, review, and save states use text rather than relying on color alone.
- The official dealership logo is a labeled 44px-or-larger link with visible keyboard focus, and the Google Drive action uses text alongside the unmodified provider icon.
- Google backup preparation, ready, error, and download-started states use explicit status text and live-region semantics.

## Detailed checklist

| Area | Result | Evidence / note |
|---|---|---|
| Page structure and landmarks | Pass | Skip link, `main`, navigation labels, page headings |
| Keyboard focus visibility | Pass in implementation | Global 3 px outline with white separation ring |
| Form labels and instructions | Pass | Persistent labels, descriptions, validation summary, inline errors |
| Dialog/sheet semantics | Pass in implementation | Radix accessible primitives and named titles |
| Status identification | Pass | Text labels plus color/icon treatment |
| Color contrast | Automated pass | Axe WCAG A/AA desktop and mobile; manual final production review still advised |
| Touch target sizing | Pass in primary workflows | Large entry, navigation, month, save, and filter controls |
| Chart alternative | Pass | Screen-reader-only month-by-month data table |
| Reduced motion | Pass | `prefers-reduced-motion` CSS override |
| Responsive phone layout | Automated task pass | Add sale, calculate, export, month navigation, and Axe flow |
| 200% browser zoom | Needs hosted manual acceptance | CSS is responsive; verify in each supported browser before broad rollout |
| VoiceOver and NVDA | Needs hosted manual acceptance | Native semantics implemented; real screen-reader smoke test required |
| Windows high contrast | Needs hosted manual acceptance | Verify focus, status, buttons, and report tabs on deployment hardware |

## Recommended human acceptance script

1. At 200% browser zoom, add a delivered sale without horizontal page scrolling or clipped actions.
2. With keyboard only, follow the skip link, switch months, open Add sale, complete required fields, save, edit, and close dialogs with Escape.
3. With VoiceOver on Safari and NVDA on Edge, confirm page title, period, field labels/errors, commission preview, tabs, and save confirmation are understandable.
4. On an iPhone-sized viewport, complete the same task and confirm the sticky form actions remain reachable above the software keyboard.
5. Enable reduced motion and Windows high contrast/relevant macOS contrast settings, then repeat the primary task.

No known automated accessibility blocker remains. The manual checks above should be performed on the real deployment because browser, assistive technology, fonts, and hosting behavior can change the result.

# Responsive design review — September 3, 2026

## Scope and design contract

This pass preserves Sales Ledger's navy-and-blue visual language and improves the existing workspace, not a replacement design. Product Grammar, Frontend Design, Design System, Design Critique, Accessibility Review, and the Software Engineering UX reference guided the review.

- The main object is a delivered sale. Customer name is the first recognition cue, followed by vehicle, then stock number and delivery date.
- A page's primary action remains **Add sale**. Report scope, report subject, and individual-sale drill-down are distinct controls.
- Reporting results, missing sales details, and cloud-save status must not imply the same state. “No sales need review” is a data-review result, not a claim that cloud synchronization has completed.
- 320–720px uses bottom navigation; 721–1040px uses a labeled navigation rail; larger screens use the full sidebar. The centered content workspace grows to 1840px, expands to 2160px on ultrawide displays, and reaches a readable 2400px cap on 4K/5K windows while staying aligned with header controls.
- Date arrows stay 44px wide. They do not stretch to fill available header space. Narrow phones show an abbreviated month and full year; the accessible name always includes the full month.
- Do not hide customer and vehicle recognition behind stock-number emphasis, oversized status pills, or truncation on phone cards.
- Settings categories retain a stable position. At tablet widths the five categories form balanced rows of three and two; profile and goal inputs pair naturally in two columns.

## Observed problems and fixes

| Problem observed in isolated local browser | Change | Verification |
| --- | --- | --- |
| At 768px, Export overlapped Paid vs estimate even though the page did not overflow horizontally. | Explicit two-track report command layout; bounded tab area and separate action column. | Regression compares the actual tab/action rectangles, not only page width. |
| Tablet sidebar consumed 188px and five Settings categories were squeezed into one row. | 96px labeled rail at intermediate widths; balanced three-plus-two category grid. | Inspected 768px and 1024px screenshots. |
| Wide reports retained a legacy narrow document width and header controls drifted away from centered content. | Staged 1840px, 2160px, and 2400px workspace caps with aligned header padding; report documents fill their workspace without producing excessively long text lines. | Inspected and measured ultrawide, 4K, and 5K widths. |
| Phone sales cards gave stock numbers priority over the vehicle and truncated a long vehicle name. | Customer, vehicle, and stock are separate lines, with stronger customer/vehicle hierarchy and wrapping. | Synthetic long-name/vehicle/stock fixture at 320px and 390px. |
| September was ellipsized at 360px, hiding part of the reporting period. | Abbreviated month display through 420px; keep full year and accessible full month. | Text-width checks at 320, 360, 375, 390, 520, 640, and 721px. |
| “Everything is up to date” could be mistaken for cloud-save confirmation. | Replaced with “No sales need review.” | Dashboard review state and existing expectation updated. |
| On-pace indicators retained the green capsule appearance the user disliked. | Compact 6px corners and quiet blue treatment. | Dashboard captures at phone and ultrawide widths. |

Shared focus targets also receive scroll margins to account for the sticky header and bottom navigation. Existing reduced-motion support remains in place.

## Automated and visual evidence

Test file: `e2e/responsive-workspace.spec.ts`.

The isolated local preview runs on port 4196. Test data belongs only to a fresh automated-browser context; the user's port 4192 database and private Firebase account were not used.

The final bounded run passed both tests in 55.9 seconds:

- Widths: **320, 390, 720, 721, 768, 844, 1024, 1041, 1280, 1440, 1920, 2560, 3440, 3840, and 5120** CSS pixels. The 844px case uses a 390px landscape height.
- Dashboard, Sales, Reports, and Settings: no document-level horizontal overflow, Add sale visible, 44px date arrows.
- All five F&I report subjects at every width; weekly, yearly, and paid-versus-estimate reports plus every Settings category at representative widths.
- Report range tabs and Export are checked for actual overlap.
- A fictional long customer name, vehicle description, and stock number exercise wrapping and hierarchy.
- Four phone-page axe checks produced no violations for the selected WCAG A/AA rule tags.
- Reduced motion is emulated throughout. Keyboard Enter opens the period selector, Escape closes it and restores focus, and Left/Right changes reporting months at seven widths.

Actual rendered captures were inspected for the 320px sales hierarchy, 320px pay plan and payroll report, 768px weekly report and volume bonuses, 1280px annual report and profile settings, and ultrawide dashboard and report layouts. Automated bounds checks extend through 5120px.

## Limits and release acceptance

This is evidence of the tested local build, not a blanket guarantee of every device or browser. Actual browser text-only enlargement, browser-menu 200% zoom, physical phones/tablets, assistive-technology behavior, and live authenticated cloud saving still need their separate acceptance checks. The parent task owns integrated tests, live deployment verification, and final browser inspection.

The 320 CSS-pixel case supports a reflow check; it is not described as a physical browser zoom test. Automated accessibility checks supplement visual and keyboard review and are not accessibility certification.

### Standards references

- [W3C: Understanding Reflow](https://www.w3.org/WAI/WCAG22/Understanding/reflow.html)
- [W3C: Understanding Target Size (Minimum)](https://www.w3.org/WAI/WCAG22/Understanding/target-size-minimum.html). The 44px control size is this product's design target; WCAG 2.2 AA's minimum target requirement is not generally 44px.
- [W3C: Understanding Focus Not Obscured (Minimum)](https://www.w3.org/WAI/WCAG22/Understanding/focus-not-obscured-minimum.html)

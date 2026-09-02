# Sales Ledger brand assets

The Sales Ledger product identity uses one concept: a ledger page with a vehicle-inspired roofline whose lower edge resolves into a completed-sale check. The product mark remains the installed-app, report, and file identity. The application shell also uses the actual, unmodified dealership logo as a separate link to the official Howell website.

## Core vector files

- `public/brand/sales-ledger-mark.svg` — primary icon for light backgrounds.
- `public/brand/sales-ledger-mark-reversed.svg` — reversed icon for navy backgrounds.
- `public/brand/sales-ledger-mark-monochrome.svg` — one-color print treatment.
- `public/brand/sales-ledger-lockup.svg` — horizontal combination mark.
- `docs/brand/sales-ledger-brand-sheet.svg` — palette, lockup, and usage presentation sheet.
- `docs/brand/exports/` — transparent PNG exports of every vector treatment.

## Official organization and provider assets

- `public/brand/bob-maxey-ford-howell.png` — unmodified 790×330 transparent PNG fetched from the [official Bob Maxey Ford of Howell website](https://www.bobmaxeyfordhowell.com/static/dealer-21521/logo.png), SHA-256 `416f17bd47bbcbbf28ed72216d6bb6c27c6700aa2028ee48a40b0c6893920bca`. It is displayed on a white backing and links only to the [Howell homepage](https://www.bobmaxeyfordhowell.com/).
- `public/brand/google-drive.png` — unmodified 128×128 Google Drive product logo from [Google's official branding guidance](https://developers.google.com/workspace/drive/api/guides/branding), SHA-256 `39e2c15449e7fa75ebe3a29f3f99e2e9ee11b5ef36aebf4dda3d30e484635495`.

These downloaded assets are bundled for offline reliability rather than hotlinked. Do not crop, recolor, distort, or combine them into a new logo. Public distribution should retain the unmodified files and appropriate dealership/brand authorization. Google Drive is a trademark of Google LLC; use of the mark is subject to Google's permissions and Drive API terms.

## Installed-app artwork

The dimensional PWA icon was created with the built-in image-generation tool, then normalized into opaque PNG assets. The standard and mask-safe source renders are retained in `docs/brand/source/` so they are not shipped or precached at runtime; the manifest-ready files remain at the existing public paths so upgrades do not break installed-app references.

- `public/app-icon-192.png` — standard PWA icon.
- `public/app-icon-512.png` — large PWA icon.
- `public/app-icon-maskable-512.png` — mask-safe PWA icon.
- `public/apple-touch-icon.png` — opaque 180px Apple touch icon.
- `public/favicon-64.png` — small browser icon.

Final image-generation prompt direction: a professional dimensional ledger page with a subtle vehicle-roof contour and an integrated completed-sale check; deep navy-to-cobalt full-bleed background; porcelain-white page; restrained emerald accent; no text, currency symbols, trademarks, dealership/manufacturer logos, rounded outer mask, chrome, neon, or lens flare. The mask-safe companion keeps the complete hero inside the central safe circle.

## Usage rules

- Keep at least one ledger-line height of clear space around the mark.
- Use the mark at 24px or larger; use the simplified favicon at 16px.
- Keep the product wordmark as real text in application UI for accessibility.
- Use the monochrome mark for printing when background graphics may be disabled.
- Keep the Sales Ledger product mark visually separate from the official dealership link; never create a simulated Bob Maxey or Ford badge.

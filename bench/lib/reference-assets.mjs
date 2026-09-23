// Official Nord Stage 4 reference asset URLs (Clavia DMI AB).
// Shared by `pnpm bench fetch` and the production /reference proxy so the
// two cannot drift. Product JPGs are committed under reference/ (and
// public/reference/) for overlay reliability; the manual PDF stays
// gitignored. Middleware serves local files first, then these CDN URLs.
//
// Nord moved CDN paths from /nord-assets-prod/media/... to /media/...;
// the old prefix now returns 403.

export const REFERENCE_PHOTO_NAME = /^nord-stage-4[\w.-]*\.jpg$/

/** filename in ./reference -> official Clavia/Nord source URL */
export const REFERENCE_PHOTOS = {
  'nord-stage-4.jpg':
    'https://assets.nordkeyboards.com/media/original_images/lyDePXcG/NS4_HA88_TopDown-01_241008.jpg',
  'nord-stage-4-73.jpg':
    'https://assets.nordkeyboards.com/media/original_images/2jnZVaTL/NS4_HA73_TopDown-01_241008.jpg',
  'nord-stage-4-compact.jpg':
    'https://assets.nordkeyboards.com/media/original_images/NS4_Compact73_TopDown-01_231020.jpg',
}

export const REFERENCE_MANUAL = {
  file: 'manual.pdf',
  url: 'https://www.nordkeyboards.com/wt/documents/951/Nord%20Stage%204%20User%20Manual%20v1.6X-Edition-N.pdf',
}

/** Ordered list for `pnpm bench fetch` (manual + photos). */
export const REFERENCE_ASSETS = [
  REFERENCE_MANUAL,
  ...Object.entries(REFERENCE_PHOTOS).map(([file, url]) => ({ file, url })),
]

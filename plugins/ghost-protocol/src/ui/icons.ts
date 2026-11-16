/**
 * The page's entry in navigation and search: a ghost. It is one shape in one colour on purpose: Buzz draws a page's icon as an `<img>`,
 * which cannot take the theme's colour, so `CSS` (ui/styles) paints this shape in the entry's own text colour instead and uses this
 * image only as the mask. The eyes are holes in the shape (even-odd), so they show the entry's background.
 */
export const PAGE_ICON =
  "data:image/svg+xml," +
  encodeURIComponent(
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><path fill-rule="evenodd" d="M12 3a7 7 0 0 0-7 7v10.5l2.33-1.75L9.67 20.5 12 18.75l2.33 1.75 2.34-1.75L19 20.5V10a7 7 0 0 0-7-7zM9.5 9.3a1.2 1.2 0 1 0 0 2.4 1.2 1.2 0 0 0 0-2.4zm5 0a1.2 1.2 0 1 0 0 2.4 1.2 1.2 0 0 0 0-2.4z"/></svg>',
  );

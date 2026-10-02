# TODO: PDF height auto-grow with fixed A4 width

## What we found
- `public/script.js` contains PDF generation logic using jsPDF + html2canvas.
- Current behavior tries to fit content onto a single A4 height by computing a `scaleFactor` and calling `fitOrPaginateBlocks(...)`.
- It also draws a fixed A4 rectangle: `pdf.rect(0, 0, pdfW, pdfH, 'F')`, which contributes to empty bottom space.

## Required change
Implement a new PDF rendering approach that:
- Keeps A4 width fixed (210mm)
- Removes fixed A4-height constraint entirely
- No font scaling/shrinking (must keep exact UI font size/spacing)
- PDF height should grow based on content length
- No forced/blank bottom space
- Do not break app logic (Firebase/UI/routing)
- Modify ONLY PDF rendering logic

## Steps
1. Remove/ignore `fitOrPaginateBlocks` and `scaleFactor` usage.
2. Build ONE tall “PDF page” DOM whose height equals the content height (no max height).
3. Capture that DOM to canvas with `html2canvas` using width corresponding to A4 capture width.
4. Compute PDF page height in mm proportionally from captured canvas height, using the mapping between capture width and A4 width.
5. Create jsPDF with format `[210, computedHeightMm]` and add the image to fill the whole page.
6. Ensure no `pdf.rect(...)` with fixed 297mm height is used.
7. Ensure header/footer remain attached to content, and footer is only included once (no per-page numbering unless pagination is still used).

## Notes / risks
- jsPDF format with custom height may create a non-standard “page size” but should render as a single continuous sheet.
- If jsPDF cannot handle extremely tall custom height, we may need natural pagination fallback, but only if absolutely impossible.


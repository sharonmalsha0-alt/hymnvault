# TODO_OPTIMIZATIONS_LH_SINGLE_VIEW (Lighthouse single hymn view)

- [ ] Update `style.css` with dedicated skeleton placeholders for the single hymn detail view:
  - [ ] Fixed-height skeleton for title/meta + transpose control area
  - [ ] Fixed-height skeleton for lyrics sheet area

- [x] Refactor `script.js`:
  - [x] Add chunked / idle-render lyrics logic to avoid long main-thread blocking
  - [x] Replace current `songsDiv.innerHTML = hugeHtmlString` approach in `loadSingleSongView`
  - [x] Render skeleton immediately, then patch in Firestore data
  - [x] Cache transposed chord results per hymn view


- [ ] Verify visually (manual) that:
  - [ ] Layout does not jump (CLS)
  - [ ] Transpose buttons still work
  - [ ] PDF generator still finds `#lyrics-content-area`, `#currentKeyDisplay`, `#heroTitle`

- [ ] Re-run Lighthouse on `index.html?hymn=...` under Slow 4G.


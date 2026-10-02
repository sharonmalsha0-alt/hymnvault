# TODO - HymnVault Performance Optimizations

## CSS (low-end friendly, same cinematic look)
- [ ] Replace hard-coded `backdrop-filter: blur(25px)` with `blur(var(--blur-amount))` across major components.
- [ ] Disable/limit animated background when `prefers-reduced-motion` is enabled.

## DOM / Rendering
- [ ] Debounce `loadSongs()` calls from the search input (avoid Firestore calls per keystroke).
- [ ] Reduce expensive full-grid re-renders (batch render helper or virtual list if needed).

## Firebase (fetch only needed data)
- [ ] Create/query lightweight Firestore collections:
  - [ ] `artists` (small list for dropdowns)
  - [ ] `hymns_cards` (card-only fields for list view)
- [ ] Modify `loadSongs()` to read from `hymns_cards` with indexed queries.
- [ ] Modify `loadArtistsDropdown()` to read from `artists`.
- [ ] Modify `loadSingleSongView(id)` to keep using full `hymns/{id}` document for lyrics + transpose/PDF.

## Manual Testing
- [ ] Test on low-end device or throttled CPU/network.
- [ ] Verify UI still looks correct (glass/cinematic look preserved on capable devices).
- [ ] Verify list rendering, search/filter, and hymn open/PDF still work.


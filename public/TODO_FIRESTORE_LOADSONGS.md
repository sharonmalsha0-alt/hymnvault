# TODO - Fix loadSongs Firestore permissions (localhost vs deployed)

- [x] Inspect and rewrite `loadSongs()` in `script.js`.
- [x] Ensure `loadSongs()` uses the exact lowercase Firestore collection path: `hymns`.
- [x] Ensure `loadSongs()` handles localhost safely when unauthenticated.
  - [x] Prefer `hymns_cards` query for performance.
  - [x] If `hymns_cards` query fails (incl. missing permissions), fall back to reading from `hymns`.
  - [x] If `hymns` read fails with permission error, show a clear UI message.
- [ ] Keep existing JS filtering/rendering behavior intact.
- [ ] Update UI strings for “no hymns found” and “failed to load”.
- [ ] Test locally: reload with Go Live and verify console has no unhandled permission errors.
- [ ] Test deployed site to ensure no regression.



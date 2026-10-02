# TODO - Hymnvault chord sheet/lyrics perfection

- [x] Step 1: Implement a shared lyrics tokenizer in `public/script.js` that supports:
  - line-based `{Section}` labels
  - inline `[Chord]` tokens
  - correct spacing/newline behavior for chord+lyric display
- [x] Step 2: Update **single-song view** (chunked renderer inside `loadSingleSongView`) to use the shared tokenizer (no duplicated parsing).
- [ ] Step 3: Update **PDF rendering** to use the same tokenizer output (replaces current `parseLyrics()` usage for PDF).
- [ ] Step 4: Keep transpose logic consistent: chords shown should transpose using existing `transposeChord()` + currentTransposeSteps.
- [ ] Step 5: Quick sanity check by running a local build/run and validating rendering with admin textarea sample format.



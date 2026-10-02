# Fix: Preserve whitespace around inline chords in lyric rendering

## Steps

- [x] Read and analyze `public/script.js` and `public/style.css`
- [x] Read `public/admin.html` for context
- [x] Develop fix plan and get user approval
- [x] **Step 1: Fix `parseLyrics()`** — Changed `forEach` to `for` loop with lookahead; extracts leading/trailing whitespace around chords into dedicated space-only `<span class="token-wrapper"><span class="lyric-text"> </span></span>` elements
- [x] **Step 2: Fix chunked DOM parser in `loadSingleSongView()`** — Applied same whitespace-preserving logic using DOM element creation
- [ ] Test: Verify whitespace is preserved in rendered output


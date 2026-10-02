/*
  Hymnvault app script.
  Loads Firebase hymns, supports search + filters, single-song view, chord transpose,
  daily verse rotation, PDF generation, and contact modal.
*/


/* ===== Firebase setup ===== */
// firebase-init.js initializes Firebase and exposes window.__DB__.
// If initialization fails, db will be undefined.
var db = window.__DB__;

/* ===== IndexedDB small cache for hymn documents ===== */
const IDB_DB_NAME = 'hymnvault-db';
const IDB_STORE = 'hymns';

function idbOpen() {
  return new Promise((resolve, reject) => {
    if (!('indexedDB' in window)) return resolve(null);
    const r = indexedDB.open(IDB_DB_NAME, 1);
    r.onupgradeneeded = (e) => {
      try {
        e.target.result.createObjectStore(IDB_STORE);
      } catch (err) {}
    };
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => resolve(null);
  });
}

async function idbGet(key) {
  try {
    const dbi = await idbOpen();
    if (!dbi) return null;
    return await new Promise((res) => {
      const tx = dbi.transaction(IDB_STORE, 'readonly');
      const store = tx.objectStore(IDB_STORE);
      const req = store.get(key);
      req.onsuccess = () => res(req.result || null);
      req.onerror = () => res(null);
    });
  } catch (e) {
    return null;
  }
}

async function idbPut(key, value) {
  try {
    const dbi = await idbOpen();
    if (!dbi) return false;
    return await new Promise((res) => {
      const tx = dbi.transaction(IDB_STORE, 'readwrite');
      const store = tx.objectStore(IDB_STORE);
      const req = store.put(value, key);
      req.onsuccess = () => res(true);
      req.onerror = () => res(false);
    });
  } catch (e) {
    return false;
  }
}

// Convenience keys for cached card lists
function cardsCacheKey(search, lang, chord, artist) {
  return ['cards', search || '', lang || '', chord || '', artist || ''].join('|');
}

async function idbGetCards(search, lang, chord, artist) {
  try {
    const key = cardsCacheKey(search, lang, chord, artist);
    return await idbGet(key);
  } catch (e) { return null; }
}

async function idbPutCards(search, lang, chord, artist, arr) {
  try {
    const key = cardsCacheKey(search, lang, chord, artist);
    return await idbPut(key, arr);
  } catch (e) { return false; }
}

// Small toast helper for status messages (cached etc.)
function showToast(msg, timeout) {
  timeout = typeof timeout === 'number' ? timeout : 2200;
  let t = document.getElementById('hv-toast');
  if (!t) {
    t = document.createElement('div');
    t.id = 'hv-toast';
    t.className = 'hv-toast';
    document.body.appendChild(t);
  }
  t.textContent = msg;
  t.classList.add('show');
  clearTimeout(t._hideTimer);
  t._hideTimer = setTimeout(() => {
    t.classList.remove('show');
  }, timeout);
}
function renderSongData(s, id) {
  const songsDiv = document.getElementById('songs');
  const heroTitle = document.getElementById('heroTitle');
  if (heroTitle) heroTitle.innerText = s.title || 'Worship Him';
  window.__currentHymn = {
    id,
    title: s.title || 'Worship Him',
    singlishTitle: s.singlish_title || '',
    artist: s.artist || 'Unknown Artist',
    chord: s.chord || 'C',
    beat: s.beat || '4/4',
    lyrics: s.lyrics || ''
  };

  const titleEl = songsDiv.querySelector('.s-v-title');
  if (titleEl) titleEl.textContent = s.title || 'Worship Him';

  const metaEl = songsDiv.querySelector('.s-v-meta');
  if (metaEl) {
    metaEl.innerHTML =
      'By ' + (s.artist || 'Unknown Artist') +
      ' &nbsp;|&nbsp; Original Key: <span class="key-badge">' + (s.chord || 'N/A') +
      '</span> &nbsp;|&nbsp; Beat: ' + (s.beat || '4/4');
  }

  const currentKeyDisplay = document.getElementById('currentKeyDisplay');
  if (currentKeyDisplay) {
    currentKeyDisplay.setAttribute('data-initial', s.chord || 'C');
    currentKeyDisplay.textContent = s.chord || 'C';
  }

  const lyricsArea = document.getElementById('lyrics-content-area');
  if (lyricsArea) {
    lyricsArea.innerHTML = parseLyrics(s.lyrics || '');
  }
}


/* ===== Transpose + parsing utilities ===== */
let currentTransposeSteps = 0;

const scaleMajor = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"];
const scaleMinor = ["Cm", "C#m", "Dm", "D#m", "Em", "Fm", "F#m", "Gm", "G#m", "Am", "A#m", "Bm"];

function transposeChord(chordString, steps) {
  if (!chordString) return chordString;

  return chordString.replace(
    /([A-G][#b]?)([^\/\s]*)(\/[A-G][#b]?)?/g,
    (match, root, suffix, slash) => {

      // --- Flats → Sharps normalize ---
      const normalize = (note) =>
        note
          .replace("Db", "C#")
          .replace("Eb", "D#")
          .replace("Gb", "F#")
          .replace("Ab", "G#")
          .replace("Bb", "A#");

      root = normalize(root);

      const scale = ["C","C#","D","D#","E","F","F#","G","G#","A","A#","B"];
      let index = scale.indexOf(root);

      if (index === -1) return match;

      let newIndex = (index + steps) % 12;
      if (newIndex < 0) newIndex += 12;

      let newRoot = scale[newIndex];

      // --- Handle slash chord bass note ---
      if (slash) {
        let bass = slash.replace("/", "");
        bass = normalize(bass);

        let bassIndex = scale.indexOf(bass);
        if (bassIndex !== -1) {
          let newBassIndex = (bassIndex + steps) % 12;
          if (newBassIndex < 0) newBassIndex += 12;
          slash = "/" + scale[newBassIndex];
        }
      }

      return newRoot + suffix + (slash || "");
    }
  );
}

function runTranspose(steps) {
  currentTransposeSteps += steps;

  const currentKeyEl = document.getElementById("currentKeyDisplay");
  if (currentKeyEl) {
    const initialKey = currentKeyEl.getAttribute("data-initial");
    currentKeyEl.innerText = transposeChord(initialKey, currentTransposeSteps);
  }

  document.querySelectorAll(".live-chord").forEach((el) => {
    const original = el.getAttribute("data-orig");
    el.innerText = transposeChord(original, currentTransposeSteps);
  });
}

function parseLyrics(rawLyrics) {
  if (!rawLyrics) return "";

  const lines = rawLyrics.split("\n");
  let outputHTML = `<div class="chord-sheet-container">`;

  lines.forEach((line) => {
    const rawLine = line.replace("\r", "");
    const trimmed = rawLine.trim();

    if (trimmed === "") {
      outputHTML += "<div style='height:15px;'></div>";
      return;
    }

    if (trimmed.startsWith("{") && trimmed.endsWith("}")) {
      outputHTML += `<span class="section-label">${trimmed.replace(/[{}]/g, "")}</span>`;
      return;
    }

    const chordSplitRegex = /(\[[^\]]+\])/g;
    const parts = rawLine.split(chordSplitRegex);

    let lineHTML = `<div class="line-wrapper">`;
    let currentChord = "";

    parts.forEach((part) => {
      if (part.startsWith("[") && part.endsWith("]")) {
        currentChord = part.substring(1, part.length - 1);
      } else {
        if (currentChord !== "" || part !== "") {
          const transposedChord = currentChord !== "" ? transposeChord(currentChord, currentTransposeSteps) : "";
          
          lineHTML += `<span class="token-wrapper">`;
          if (currentChord !== "") {
            lineHTML += `<span class="live-chord" data-orig="${currentChord}">${transposedChord}</span>`;
            currentChord = "";
          } else {
            lineHTML += `<span class="live-chord" style="visibility: hidden;">&nbsp;</span>`;
          }
          const formattedPart = part.replace(/ /g, "&nbsp;");
          lineHTML += `<span class="lyric-text">${formattedPart}</span></span>`;
        }
      }
    });

    if (currentChord !== "") {
      const transposedChord = transposeChord(currentChord, currentTransposeSteps);
      lineHTML += `<span class="token-wrapper">`;
      lineHTML += `<span class="live-chord" data-orig="${currentChord}">${transposedChord}</span>`;
      lineHTML += `<span class="lyric-text">&nbsp;</span></span>`;
    }

    lineHTML += `</div>`;
    outputHTML += lineHTML;
  });

  outputHTML += `</div>`;
  return outputHTML;
}

/* ===== Daily verse + UI helpers ===== */
const worshipVerses = [
  { text: "Sing to the LORD, praise his name; proclaim his salvation day after day.", ref: "Psalm 96:2" },
  { text: "Come, let us sing for joy to the LORD; let us shout aloud to the Rock of our salvation.", ref: "Psalm 95:1" },
  { text: "I will praise God’s name in song and glorify him with thanksgiving.", ref: "Psalm 69:30" },
  {
    text: "Praise the LORD. How good it is to sing praises to our God, how pleasant and fitting to praise him!",
    ref: "Psalm 147:1",
  },
  {
    text: "About midnight Paul and Silas were praying and singing hymns to God, and the other prisoners were listening to them.",
    ref: "Acts 16:25",
  },
  { text: "Great is the LORD and most worthy of praise; his greatness no one can fathom.", ref: "Psalm 145:3" },
  { text: "Let everything that has breath praise the LORD. Praise the LORD.", ref: "Psalm 150:6" },
  { text: "The LORD is my strength and my shield; my heart trusts in him, and he helps me.", ref: "Psalm 28:7" },
  { text: "I will bless the LORD at all times; his praise shall continually be in my mouth.", ref: "Psalm 34:1" },
  { text: "Enter his gates with thanksgiving and his courts with praise; give thanks to him and praise his name.", ref: "Psalm 100:4" },
];

function updateDailyVerse() {
  const now = new Date();
  const totalMinutes = now.getHours() * 60 + now.getMinutes();
  const verseIndex = Math.floor(totalMinutes / 10) % worshipVerses.length;
  const selectedVerse = worshipVerses[verseIndex];

  const verseBox = document.getElementById("dailyVerseBox");
  if (verseBox) {
    verseBox.innerHTML = `
      "${selectedVerse.text}"
      <br><span style="color:var(--accent); display:block; margin-top:8px; font-size:0.82rem; font-weight:600;">- ${selectedVerse.ref} -</span>
    `;
  }
}

function toggleFilterDrawer(open) {
  const drawer = document.getElementById("mobileFilterDrawer");
  const overlay = document.getElementById("drawerOverlay");
  if (!drawer || !overlay) return;

  if (open) {
    drawer.classList.add("active");
    overlay.classList.add("active");
  } else {
    drawer.classList.remove("active");
    overlay.classList.remove("active");
  }
}

// Ensure the nav drawer closes for any navigation actions within it
function closeMobileNavImmediately() {
  const drawer = document.getElementById('mobileSideDrawer');
  const overlay = document.getElementById('drawerOverlay');

  // Close drawer + unlock scroll immediately
  if (drawer) drawer.classList.remove('open');
  if (drawer) drawer.setAttribute('aria-hidden', 'true');
  if (overlay) {
    overlay.classList.remove('active');
    overlay.setAttribute('aria-hidden', 'true');
  }
  document.body.classList.remove('drawer-open');
}

function bindMobileDrawerAutoClose() {
  const drawer = document.getElementById('mobileSideDrawer');
  if (!drawer) return;

  // Use capture so it happens before any inline navigation handlers block UI.
  drawer.addEventListener('click', (e) => {
    if (!drawer.classList.contains('open')) return;

    // If a hymn card is clicked in Trending This Week, close immediately.
    // This avoids cases where the inline onclick handler triggers before auto-close logic.
    const trendingItem = e.target && e.target.closest('.mobile-trending-inline .trending-item');
    if (trendingItem) {
      closeMobileNavImmediately();
      return;
    }

    // Only close on real navigation actions.
    // - Go Home
    // - Contact
    // - Trending This Week items (loadSingleSongView)
    // - Any explicit anchors/buttons that are intended for navigation
    const actionable = e.target && e.target.closest('a, button');
    if (!actionable || !drawer.contains(actionable)) return;

    const href = actionable.getAttribute && actionable.getAttribute('href');
    const onclick = actionable.getAttribute && actionable.getAttribute('onclick');

    const isNavLink =
      (href && href.startsWith('#')) ||
      (onclick && /^(\s*)?(goHome\(|openContact\(|loadSingleSongView\()/i.test(onclick));

    // Also close for any element inside the trending section.
    const isTrendingItem = Boolean(e.target && e.target.closest('.mobile-trending-inline .trending-item'));

    if (isNavLink || isTrendingItem || (href && href !== '#')) {
      closeMobileNavImmediately();
    }
  }, true);
}

// Close drawer when a navigation happens via the URL hash.
function bindMobileDrawerHashAutoClose() {
  window.addEventListener('hashchange', () => {
    const drawer = document.getElementById('mobileSideDrawer');
    if (drawer && drawer.classList.contains('open')) closeMobileNavImmediately();
  });
}





function syncMobileFilters(type) {
  if (type === "artist") {
    const d = document.getElementById("artist");
    const m = document.getElementById("m-artist");
    if (d && m) d.value = m.value;
  }
  if (type === "language") {
    const d = document.getElementById("language");
    const m = document.getElementById("m-language");
    if (d && m) d.value = m.value;
  }
  if (type === "chord") {
    const d = document.getElementById("chord");
    const m = document.getElementById("m-chord");
    if (d && m) d.value = m.value;
  }
  loadSongs();
}

function openContact() {
  const modal = document.getElementById("contactModal");
  if (modal) modal.style.display = "flex";
}

// Used by the mobile side drawer "Contact Us" action:
// 1) close drawer
// 2) smoothly scroll to CONNECT section
function contactFromDrawerScrollToConnect() {
  // Close drawer first so it doesn't overlap the scroll target.
  // closeMobileNavImmediately() also unlocks body scroll.
  if (typeof closeMobileNavImmediately === 'function') closeMobileNavImmediately();
  else if (typeof toggleMobileNav === 'function') toggleMobileNav(false);

  // Open contact modal (as per existing Contact Us behavior).
  openContact();

  // Scroll to footer CONNECT section.
  const connectEl = document.getElementById('connectSection');
  if (connectEl) connectEl.scrollIntoView({ behavior: 'smooth', block: 'start' });
}


function closeContact() {
  const modal = document.getElementById("contactModal");
  if (modal) modal.style.display = "none";
}

function goHome(isPopState) {
  disableZoomForHome();
  
  if (isPopState !== true) {
    history.pushState({ page: 'home' }, "", "/");
  }

  const elSearch = document.getElementById("search");
  if (elSearch) elSearch.value = "";

  const elArtist = document.getElementById("artist");
  const elLang = document.getElementById("language");
  const elChord = document.getElementById("chord");

  if (elArtist) elArtist.value = "";
  if (elLang) elLang.value = "";
  if (elChord) elChord.value = "";

  const mArtist = document.getElementById("m-artist");
  const mLang = document.getElementById("m-language");
  const mChord = document.getElementById("m-chord");

  if (mArtist) mArtist.value = "";
  if (mLang) mLang.value = "";
  if (mChord) mChord.value = "";

  const heroTitle = document.getElementById("heroTitle");
  if (heroTitle) heroTitle.innerText = "Praise the LORD";

  loadSongs();
}

/* ===== Firebase data loading ===== */
async function loadArtistsDropdown() {
  if (!db) return;

  // Fast path: fetch from a small `artists` collection instead of scanning all hymns.
  // Expected doc shape: { name: string }
  try {
    const data = await db.collection("artists").orderBy("name").get();

    const artistNames = [];
    data.forEach((doc) => {
      const s = doc.data();
      const name = s && s.name ? s.name.toString().trim() : "";
      if (name) artistNames.push(name);
    });

    // Deduplicate + stable sort
    const uniq = Array.from(new Set(artistNames)).sort((a, b) => a.toLowerCase().localeCompare(b.toLowerCase()));

    const dSelect = document.getElementById("artist");
    const mSelect = document.getElementById("m-artist");
    const current = dSelect?.value;

    let html = `<option value="">🎤 Artists Name</option><option value="All Artists">All Artists</option>`;
    uniq.forEach((name) => {
      html += `<option value="${name}">${name}</option>`;
    });

    if (dSelect) dSelect.innerHTML = html;
    if (mSelect) mSelect.innerHTML = html;

    if (dSelect && dSelect.value !== current && current) dSelect.value = current;
    if (mSelect && mSelect.value !== current && current) mSelect.value = current;

    return;
  } catch (e) {
    // Fallback: older deployments without `artists` collection.
  }

  db.collection("hymns").get().then((data) => {
    const artistsSet = new Set();
    data.forEach((doc) => {
      const s = doc.data();
      if (s.artist && s.artist.toString().trim() !== "") {
        artistsSet.add(s.artist.toString().trim());
      }
    });

    const dSelect = document.getElementById("artist");
    const mSelect = document.getElementById("m-artist");
    const current = dSelect?.value;

    const uniqArtists = Array.from(artistsSet).sort((a, b) => a.toLowerCase().localeCompare(b.toLowerCase()));

    let html = `<option value="">🎤 Artists Name</option><option value="All Artists">All Artists</option>`;
    uniqArtists.forEach((name) => {
      html += `<option value="${name}">${name}</option>`;
    });

    if (dSelect) dSelect.innerHTML = html;
    if (mSelect) mSelect.innerHTML = html;
    if (dSelect && dSelect.value !== current && current) dSelect.value = current;
    if (mSelect && mSelect.value !== current && current) mSelect.value = current;
  });
}

let loadSongsTimer = null;

function scheduleLoadSongs() {
  clearTimeout(loadSongsTimer);
  loadSongsTimer = setTimeout(() => {
    // Avoid running while user is actively transposing/opening other views
    loadSongs();
  }, 250);
}

async function loadSongs() {
  currentTransposeSteps = 0;

  const searchArea = document.getElementById("searchArea");
  if (searchArea) searchArea.style.display = "flex";

  const search = document.getElementById("search").value.toLowerCase().trim();
  const lang = document.getElementById("language").value.toLowerCase().trim();
  const chord = document.getElementById("chord").value.toLowerCase().trim();
  const artist = document.getElementById("artist").value.toLowerCase().trim();

  const songsDiv = document.getElementById("songs");
  songsDiv.className = "songs-grid";
  // CLS-safe skeleton while Firestore is fetching.
  const skeletonCount = 12;
  const skeletonGrid = document.createElement('div');
  skeletonGrid.className = 'skeleton-grid';

  // Pre-create nodes to keep main-thread work low.
  const frag = document.createDocumentFragment();
  for (let i = 0; i < skeletonCount; i++) {
    const card = document.createElement('div');
    card.className = 'skeleton-card';
    card.innerHTML = `
      <div class="skeleton-line"></div>
      <div class="skeleton-line small" style="width:72%"></div>
    `;
    frag.appendChild(card);
  }
  skeletonGrid.appendChild(frag);

  songsDiv.innerHTML = '';
  songsDiv.appendChild(skeletonGrid);

  // Fast path: show cached cards for the exact filter/search combination
  try {
    const cached = await idbGetCards(search, lang, chord, artist);
    if (cached && Array.isArray(cached) && cached.length) {
      renderFromCacheArray(cached);
      // background refresh: continue to load fresh network data and update cache/UI
    }
  } catch (e) {
    // ignore cache errors
  }

  if (!db) {
    songsDiv.innerHTML =
      "<div style='grid-column:1/-1; text-align:center; padding:20px; color:var(--text-muted);'>Offline mode: Firestore not ready (Firebase init failed).</div>";
    return;
  }

  const isLocalDev = (() => {
    const host = (window.location.hostname || "").toLowerCase();
    return host === "localhost" || host === "127.0.0.1";
  })();



  const isPermissionError = (err) => {
    if (!err) return false;
    const code = err.code ? String(err.code) : "";
    const msg = err.message ? String(err.message) : "";
    return (
      code.includes("permission") ||
      code.includes("unauthenticated") ||
      msg.toLowerCase().includes("missing or insufficient permissions") ||
      msg.toLowerCase().includes("permission-denied")
    );
  };

  // Render helper: expects doc snapshots where each doc.data() contains at least:
  // { title, singlish_title, artist, language, chord }
  const renderFromSnapshot = (data) => {
    // Use DocumentFragment + single DOM write to minimize main-thread work and layout thrash.
    const frag = document.createDocumentFragment();

    data.forEach((doc) => {
      const s = doc.data() || {};

      const sTitle = s.title ? s.title.toLowerCase().trim() : "";
      const sSinglishTitle = s.singlish_title
        ? s.singlish_title.toLowerCase().trim()
        : "";

      const sLang = s.language ? s.language.toLowerCase().trim() : "";
      const sChord = s.chord ? s.chord.toLowerCase().trim() : "";
      const sArtist = s.artist ? s.artist.toString().toLowerCase().trim() : "";

      const matchSearch =
        search === "" || sTitle.includes(search) || sSinglishTitle.includes(search);

      const matchLang = lang === "" || sLang === lang || sLang.includes(lang);

      const matchArtist = artist === "" || artist === "all artists" || sArtist === artist;

      let matchChord = false;
      if (chord === "") {
        matchChord = true;
      } else {
        if (chord.endsWith("m")) {
          matchChord = sChord === chord;
        } else {
          matchChord = sChord === chord && !sChord.endsWith("m");
        }
      }

      if (matchSearch && matchLang && matchChord && matchArtist) {
        const card = document.createElement('a');
        // අලුත්: Slug එකක් ඇත්නම් එය භාවිතා කිරීම, නැත්නම් පරණ ID එක ගැනීම
        let linkId = s.slug ? s.slug : doc.id; 
        
        card.className = 'song-title-card';
        card.href = `/hymn/${linkId}`;
        
        // SEO Fix: Removed inline onclick attribute and added event listener
        card.addEventListener('click', (e) => {
            e.preventDefault();
            loadSingleSongView(linkId);
        });
        
        card.innerHTML = `<div><h3>${s.title || "Untitled"}</h3><span class="song-meta">${s.artist || "Unknown Artist"} | Key: ${s.chord || "N/A"}</span></div><span>➔</span>`;

        frag.appendChild(card);
      }
    });

    if (!frag.childNodes.length) {
      songsDiv.innerHTML =
        "<div style='grid-column:1/-1; text-align:center; padding:20px; color:var(--text-muted);'>No hymns found.</div>";
      return;
    }

    // Replace content in one shot.
    songsDiv.innerHTML = "";
    songsDiv.appendChild(frag);
  };

  // Render helper for cached arrays: expects [{ id, data }] where data is plain object
  const renderFromCacheArray = (arr) => {
    const frag = document.createDocumentFragment();
    arr.forEach((item) => {
      const s = item.data || {};
      const card = document.createElement('a');
      card.className = 'song-title-card';
      card.href = `/hymn/${item.id}`;
      
      // SEO Fix: Removed inline onclick attribute
      card.addEventListener('click', (e) => {
          e.preventDefault();
          loadSingleSongView(item.id);
      });
      
      card.innerHTML = `<div><h3>${s.title || 'Untitled'}</h3><span class="song-meta">${s.artist || 'Unknown Artist'} | Key: ${s.chord || 'N/A'}</span></div><span>➔</span>`;
      frag.appendChild(card);
    });
    if (!frag.childNodes.length) {
      songsDiv.innerHTML = "<div style='grid-column:1/-1; text-align:center; padding:20px; color:var(--text-muted);'>No hymns found.</div>";
      return;
    }
    songsDiv.innerHTML = '';
    songsDiv.appendChild(frag);
  };

  // Always use exact lowercase collection path for hymns.
  const hymnCollection = db.collection("hymns");

  // Fast path (indexed): fetch only card fields from `hymns_cards`.
  const cardCollection = db.collection("hymns_cards");

  const showPermissionMessage = (err) => {
    console.error("[Firestore] loadSongs permission error:", err);
    songsDiv.innerHTML =
      "<div style='grid-column:1/-1; text-align:center; padding:20px; color:var(--text-muted);'>" +
      (isLocalDev
        ? "Local development is blocked by Firestore security rules. Refreshing as unauthenticated may not be allowed. Open console for details."
        : "Firestore security rules blocked hymn loading.") +
      "</div>";
  };

  // Conservative limit to avoid huge reads when falling back.
  // Tune for Lighthouse on low-end devices: keep DOM small.
  const MAX_DOCS = 120;

  // 1) Try cards (for performance)
  const tryLoadFromCards = async () => {
    // During skeleton render, keep layout stable.
    // If a permission error happens, callers will show a message.

    // Ensure we never block rendering with huge reads.
    // If the query is blocked by rules, the caller will fall back.

    try {
      let q = cardCollection;
      if (lang) q = q.where("language", "==", lang);
      if (artist && artist !== "all artists") q = q.where("artistNormalized", "==", artist);
      if (chord) q = q.where("chordNormalized", "==", chord);
      q = q.limit(MAX_DOCS);

      const snap = await q.get();
      return snap;
    } catch (err) {
      if (isPermissionError(err)) {
        // If cards are blocked, fall through to hymns.
        throw err;
      }
      // Index missing / query constraints missing etc => fall back.
      throw err;
    }
  };

  // 2) Fall back to hymns (public collection path)
  const tryLoadFromHymns = async () => {
    // Note: Without knowing your rules, we can't reliably filter server-side for unauth users.
    // We still avoid very large reads with a limit.
    let q = hymnCollection.limit(MAX_DOCS);
    const snap = await q.get();
    return snap;
  };

  (async () => {
    try {
      const snap = await tryLoadFromCards();
      renderFromSnapshot(snap);

      // Cache the card list for these filters
      try {
        const arr = [];
        snap.forEach((doc) => { arr.push({ id: doc.id, data: doc.data() }); });
        if (arr.length) await idbPutCards(search, lang, chord, artist, arr);
      } catch (e) {}

      return;
    } catch (errCards) {
      // If card query fails, attempt hymns read.
      try {
        const snap = await tryLoadFromHymns();
        renderFromSnapshot(snap);

        // Cache fallback hymn list
        try {
          const arr = [];
          snap.forEach((doc) => { arr.push({ id: doc.id, data: doc.data() }); });
          if (arr.length) await idbPutCards(search, lang, chord, artist, arr);
        } catch (e) {}

        return;
      } catch (errHymns) {
        if (isPermissionError(errHymns) || isPermissionError(errCards)) {
          showPermissionMessage(errHymns || errCards);
          return;
        }

        console.error("[Firestore] loadSongs fallback failed:", errHymns);
        songsDiv.innerHTML =
          "<div style='grid-column:1/-1; text-align:center; padding:20px; color:var(--text-muted);'>Failed to load hymns from Firebase. Check console for details.</div>";
      }
    }
  })();

  return;
}


function toggleMobileNav(open) {
  const drawer = document.getElementById('mobileSideDrawer');
  const overlay = document.getElementById('drawerOverlay');
  if (!drawer) return;

  if (open) {
    document.body.classList.add('drawer-open');

    drawer.classList.add('open');
    drawer.setAttribute('aria-hidden', 'false');

    if (overlay) {
      overlay.classList.add('active');
      overlay.setAttribute('aria-hidden', 'false');
    }
  } else {
    drawer.classList.remove('open');
    drawer.setAttribute('aria-hidden', 'true');

    if (overlay) {
      overlay.classList.remove('active');
      overlay.setAttribute('aria-hidden', 'true');
    }

    document.body.classList.remove('drawer-open');
  }
}


function closeMobileNav() {
  toggleMobileNav(false);
}

function closePrivacyTerms() {
  hideLegalView();
}

function showPrivacy() {
  showLegalView('privacyView');
}

function showTerms() {
  showLegalView('termsView');
}

function hideLegalView() {
  const overlay = document.getElementById('legalOverlay');
  const privacyView = document.getElementById('privacyView');
  const termsView = document.getElementById('termsView');

  if (overlay) overlay.classList.remove('open');
  if (privacyView) privacyView.classList.remove('open');
  if (termsView) termsView.classList.remove('open');

  if (privacyView) privacyView.setAttribute('aria-hidden', 'true');
  if (termsView) termsView.setAttribute('aria-hidden', 'true');
}

function showLegalView(viewId) {
  const overlay = document.getElementById('legalOverlay');
  const privacyView = document.getElementById('privacyView');
  const termsView = document.getElementById('termsView');

  if (!overlay || !privacyView || !termsView) return;

  overlay.classList.add('open');

  privacyView.classList.remove('open');
  termsView.classList.remove('open');

  if (viewId === 'privacyView') {
    privacyView.classList.add('open');
    privacyView.setAttribute('aria-hidden', 'false');
    termsView.setAttribute('aria-hidden', 'true');
  } else {
    termsView.classList.add('open');
    termsView.setAttribute('aria-hidden', 'false');
    privacyView.setAttribute('aria-hidden', 'true');
  }
}

// Click outside (overlay) closes privacy/terms views
window.addEventListener('DOMContentLoaded', () => {
  const overlay = document.getElementById('legalOverlay');
  if (!overlay) return;
  overlay.addEventListener('click', () => {
    closePrivacyTerms();
  });
});


// Register service worker for offline caching & fast repeat loads
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/service-worker.js').then((reg) => {
      console.log('[SW] Registered', reg.scope);
    }).catch((err) => {
      console.warn('[SW] Registration failed', err);
    });
  });
}





function allowZoomForHymnView() {
  const meta = document.querySelector('meta[name="viewport"]');
  if (meta) meta.setAttribute('content', 'width=device-width, initial-scale=1.0');
}

function disableZoomForHome() {
  const meta = document.querySelector('meta[name="viewport"]');
  if (meta) meta.setAttribute('content', 'width=device-width, initial-scale=1.0, user-scalable=no');
}

async function loadSingleSongView(id, isPopState) {
  allowZoomForHymnView();
  currentTransposeSteps = 0;

  // Mark current hymn id for hymn-scoped lyric sizing.
  window.__currentHymn = window.__currentHymn || {};


  const songsDiv = document.getElementById("songs");
  const searchArea = document.getElementById("searchArea");
  if (searchArea) searchArea.style.display = "none";

  songsDiv.className = "";

  // CLS-safe skeleton immediately (keeps the card structure stable)
  songsDiv.innerHTML = `
    <div class="card single-view-skeleton">
      <!-- METHANA WENAS KALA: flex-wrap: wrap; add kala phone walata hoda wenna -->
      <div style="display: flex; gap: 10px; margin-bottom: 20px; flex-wrap: wrap;">
        <a href="/" class="back-btn" onclick="event.preventDefault(); goHome();" style="margin-bottom:0; display:inline-block; text-decoration:none; text-align:center;">➔ Back to Hymns</a>
        <button class="back-btn" onclick="downloadPDF()" style="margin-bottom:0; background: var(--accent); color: #000; font-weight: 600; border-color: var(--accent);">📥 Download PDF</button>
        <button class="back-btn" id="pngBtn" onclick="downloadPNG()" style="margin-bottom:0; background: transparent; color: var(--accent); font-weight: 600; border: 1px solid var(--accent);">
  <span id="pngBtnText">Download PNG</span>
</button>
        <!-- ALUTH BUTTON EKA -->
        <button id="toggleChordsBtn" class="back-btn" onclick="toggleChords()" style="margin-bottom:0; background: #444; color: #fff; font-weight: 600; border-color: #444;">👁 Hide Chords</button>
      </div>

      <div class="s-v-title" style="margin-top:0; font-family:'Cinzel', serif; letter-spacing:1px; font-size:1.6rem; font-weight:bold;">&nbsp;</div>
      <p class="s-v-meta" style="color:var(--text-muted); margin-bottom:25px; font-size:0.92rem;">&nbsp;</p>

      <div class="transpose-control s-v-transpose">
        <span>Key Transpose:</span>
        <button class="btn-trans" onclick="runTranspose(-1)" type="button">-</button>
        <span class="key-badge" id="currentKeyDisplay" data-initial="C">C</span>
        <button class="btn-trans" onclick="runTranspose(1)" type="button">+</button>
      </div>

      <div id="lyrics-content-area" class="s-v-lyrics-wrap">
        <div class="s-v-lyrics-line"><div class="inner"><div class="bar"></div><div class="bar small"></div></div></div>
        <div class="s-v-lyrics-line"><div class="inner"><div class="bar"></div><div class="bar small"></div></div></div>
        <div class="s-v-lyrics-line"><div class="inner"><div class="bar"></div><div class="bar small"></div></div></div>
        <div class="s-v-lyrics-line"><div class="inner"><div class="bar"></div><div class="bar small"></div></div></div>
      </div>
    </div>

    <div id="pdf-container-wrapper" style="display: none;">
      <div id="pdf-printable-content"></div>
    </div>
  `;

  if (isPopState !== true) {
    history.pushState({ page: 'song', id: id }, "", "/hymn/" + id);
  }

  // --- අලුතින් එකතු කළ කොටස ආරම්භය ---
  // ලින්ක් එකේ තියෙන්නේ Slug එකක් නම්, ඒකෙන් නියම Database ID එක හොයාගැනීම
  if (id.length !== 20) { // Firebase ID එකක අකුරු 20ක් ඇත
      try {
          const snap = await db.collection("hymns").where("slug", "==", id).limit(1).get();
          if (!snap.empty) {
              id = snap.docs[0].id; // id අගය නියම Database ID එකෙන් replace වේ
          }
      } catch(e) { console.error(e); }
  }
  // --- අලුතින් එකතු කළ කොටස අවසානය ---

  // Try fast local cache first (IndexedDB). If present, render immediately
  try {
    const cached = await idbGet(id);
    if (cached) {
      renderSongData(cached, id);

      // Fetch fresh copy in background and update cache/UI if changed
      if (db) {
        db.collection("hymns").doc(id).get().then(async (doc) => {
          if (!doc || !doc.exists) return;
          const s = doc.data();
          try {
            const putOk = await idbPut(id, s);
            if (putOk) {
              // do not show toast for background refresh (avoids noise)
            }
          } catch (e) {}
          try {
            if (JSON.stringify(s) !== JSON.stringify(cached)) {
              renderSongData(s, id);
            }
          } catch (e) {
            renderSongData(s, id);
          }
        }).catch(() => {});
      }

      return; // cached response shown immediately
    }
  } catch (e) {
    // ignore idb errors and continue to network path
  }

  if (!db) {
    songsDiv.innerHTML = "<div style='text-align:center; padding:20px;'>Offline mode: Firestore not ready.</div>";
    return;
  }

  // Prevent out-of-order renders when user taps quickly
  const viewToken = (loadSingleSongView._token = (loadSingleSongView._token || 0) + 1);

  db.collection("hymns")
    .doc(id)
    .get()
    .then(async (doc) => {
      if (viewToken !== loadSingleSongView._token) return;

      if (!doc.exists) {
        songsDiv.innerHTML = "<div style='text-align:center; padding:20px;'>Hymn not found.</div>";
        return;
      }

      const s = doc.data();
      
      // සින්දුවේ දත්ත වෙන් කරගැනීම (Singlish නමක් නැත්නම් හිස්ව තබයි)
      let mainTitle = s.title || "Worship Hymn";
      let singlishTitle = s.singlish_title ? " | " + s.singlish_title : "";
      let artistName = s.artist || "Unknown Artist";

      // SEO Fix: Page Title එකට Sinhala, Singlish සහ "Chords & Lyrics" එකතු කිරීම
      document.title = mainTitle + singlishTitle + " - Chords & Lyrics | HymnVault";

      // SEO Fix: Meta Description එකට Singlish සහ සෙවුම් වචන (Keywords) එකතු කිරීම
      let metaDesc = document.querySelector('meta[name="description"]');
      if (metaDesc) {
          let descText = mainTitle + singlishTitle + " ගීතිකාවේ chords සහ පදමාලාව (lyrics). ගායනය: " + artistName + ". සිංහල සහ Singlish වලින් HymnVault වෙතින් ලබාගන්න.";
          metaDesc.setAttribute("content", descText);
      }
      
      let canonicalTag = document.querySelector("link[rel='canonical']");
      if(canonicalTag) {
          canonicalTag.href = window.location.origin + "/?hymn=" + id;
      }

      /* ===== අලුතින් එකතු කරන Schema Markup (JSON-LD SEO) ===== */
      let existingSchema = document.getElementById("hymn-schema");
      if (existingSchema) {
          existingSchema.remove(); // කලින් සින්දුවක දත්ත තිබුණොත් අයින් කරනවා
      }

      let schemaData = {
          "@context": "https://schema.org",
          "@type": "MusicComposition",
          "name": mainTitle,
          "alternateName": s.singlish_title || "",
          "composer": {
              "@type": "Person",
              "name": artistName
          },
          "lyrics": {
              "@type": "CreativeWork",
              "text": s.lyrics || ""
          },
          "url": window.location.origin + "/hymn/" + id
      };

      let schemaScript = document.createElement("script");
      schemaScript.id = "hymn-schema";
      schemaScript.type = "application/ld+json";
      schemaScript.text = JSON.stringify(schemaData);
      document.head.appendChild(schemaScript);
      /* ======================================================== */
      
      const heroTitle = document.getElementById("heroTitle");
      if (heroTitle) heroTitle.innerText = s.title || "Worship Him";
      let mainH1 = document.querySelector('h1');
      if(mainH1) {
          mainH1.innerText = s.title || "Worship Him";
      }
      window.__currentHymn = {
  id,
  title: s.title || "Worship Him",
  singlishTitle: s.singlish_title || "",
  artist: s.artist || "Unknown Artist",
  chord: s.chord || "C",
  beat: s.beat || "4/4",
  lyrics: s.lyrics || "",
};

      const pdfTitle = s.singlish_title && s.singlish_title.trim() !== "" ? s.singlish_title : s.title;

      // Cache this hymn for offline access (first-time save)
      try {
        const putOk = await idbPut(id, s);
        if (putOk) showToast('Saved for offline use');
      } catch (e) {}

      // Fill small header parts without touching the lyrics container yet
      const titleEl = songsDiv.querySelector(".s-v-title");
      if (titleEl) titleEl.textContent = s.title || "Worship Him";

      const metaEl = songsDiv.querySelector(".s-v-meta");
      if (metaEl) {
        metaEl.innerHTML =
          "By " + (s.artist || "Unknown Artist") +
          " &nbsp;|&nbsp; Original Key: <span class=\"key-badge\">" + (s.chord || "N/A") +
          "</span> &nbsp;|&nbsp; Beat: " + (s.beat || "4/4");
      }

      const currentKeyDisplay = document.getElementById("currentKeyDisplay");
      if (currentKeyDisplay) {
        currentKeyDisplay.setAttribute("data-initial", s.chord || "C");
        currentKeyDisplay.textContent = s.chord || "C";
      }

      // Render PDF markup lazily (still uses parseLyrics, but only when PDF area is populated)
      const pdfContainer = document.getElementById("pdf-container-wrapper");
      const pdfContent = document.getElementById("pdf-printable-content");
      if (pdfContent) {
        pdfContent.innerHTML = `
          <div style="background: #030611; color: #f8fafc; font-family: 'Poppins', sans-serif; padding: 30px; box-sizing: border-box; width: 100%;">
            <div style="border: 2px solid #b45309; padding: 35px; border-radius: 16px; background: #0a0f22; box-shadow: inset 0 0 20px rgba(245, 158, 11, 0.05);">
              <div style="text-align: center; font-family: 'Cinzel', serif; font-size: 13px; color: #f59e0b; letter-spacing: 4px; text-transform: uppercase; margin-bottom: 8px;">Hymnvault Sanctuary</div>
              <h1 style="font-family: 'Cinzel', serif; text-align: center; margin: 0 0 10px 0; color: #ffffff; font-size: 28px; letter-spacing: 1px;">${pdfTitle}</h1>
              <p style="text-align: center; color: #94a3b8; font-size: 14px; margin: 0 0 35px 0; border-bottom: 1px solid rgba(255,255,255,0.08); padding-bottom: 20px;">
                Artist: <strong style="color: #f59e0b;">${s.artist || "Unknown Artist"}</strong> &nbsp;|&nbsp; 
                Key: <strong style="color: #38bdf8;" id="pdfKeyDisplay">${s.chord || "N/A"}</strong> &nbsp;|&nbsp; 
                Beat: <strong style="color: #cbd5e1;">${s.beat || "4/4"}</strong>
              </p>
              <div class="pdf-lyrics-body" style="font-size: 15px; line-height: 1.7;">
                ${parseLyrics(s.lyrics)}
              </div>
              <div style="text-align: center; margin-top: 40px; font-size: 12px; color: #475569; font-style: italic; border-top: 1px solid rgba(255,255,255,0.05); padding-top: 20px; letter-spacing: 1px;">
                Produced beautifully by Hymnvault
              </div>
            </div>
          </div>
        `;
      }

      // Chunked lyrics rendering to reduce TBT
      const lyricsMount = document.getElementById("lyrics-content-area");
      if (lyricsMount) {
        lyricsMount.innerHTML = "";

        const rawLyrics = s.lyrics || "";
        const lines = rawLyrics.split("\n");

        const chordCache = new Map();
        const steps = currentTransposeSteps;

        const container = document.createElement("div");
        container.className = "chord-sheet-container";
        lyricsMount.appendChild(container);

        let idx = 0;
        const chunkSize = 30;

        const schedule = window.requestIdleCallback
          ? (fn) => window.requestIdleCallback(fn, { timeout: 90 })
          : (fn) => setTimeout(fn, 0);

        function renderChunk() {
          const start = performance.now();

          while (idx < lines.length) {
            const rawLine = lines[idx++].replace("\r", "");
            const trimmed = rawLine.trim();

            if (trimmed === "") {
              const gap = document.createElement("div");
              gap.style.height = "15px";
              container.appendChild(gap);
            } else if (trimmed.startsWith("{") && trimmed.endsWith("}")) {
              const label = document.createElement("span");
              label.className = "section-label";
              label.textContent = trimmed.replace(/[{}]/g, "");
              container.appendChild(label);
            } else {
              // Build line DOM
          // Split into alternating lyric/chord tokens.
          // IMPORTANT: We only ever create a new line-wrapper per explicit '\n' in the raw lyrics.
          // This split is ONLY for inline chords in the same physical line.
          // Chords are expected to be in square brackets like: [C] [Am7] etc.
          const chordSplitRegex = /(\[[^\]]+\])/g;
          const parts = rawLine.split(chordSplitRegex);

              const lineEl = document.createElement("div");
              lineEl.className = "line-wrapper";

              let currentChord = "";
              const frag = document.createDocumentFragment();

              for (let i = 0; i < parts.length; i++) {
                const part = parts[i];
                if (part.startsWith("[") && part.endsWith("]")) {
                  currentChord = part.substring(1, part.length - 1);
                  continue;
                }

                if (currentChord !== "" || part !== "") {
                  const tokenWrapper = document.createElement("span");
                  tokenWrapper.className = "token-wrapper";

                  if (currentChord !== "") {
                    let transposed = chordCache.get(currentChord);
                    if (!transposed) {
                      transposed = transposeChord(currentChord, steps);
                      chordCache.set(currentChord, transposed);
                    }

                    const chordEl = document.createElement("span");
                    chordEl.className = "live-chord";
                    chordEl.setAttribute("data-orig", currentChord);
                    chordEl.textContent = transposed;
                    tokenWrapper.appendChild(chordEl);
                    currentChord = "";
                  }

                  const lyricEl = document.createElement("span");
                  lyricEl.className = "lyric-text";
                  lyricEl.textContent = part;
                  tokenWrapper.appendChild(lyricEl);

                  frag.appendChild(tokenWrapper);
                }
              }

              if (currentChord !== "") {
                const tokenWrapper = document.createElement("span");
                tokenWrapper.className = "token-wrapper";

                const chordEl = document.createElement("span");
                chordEl.className = "live-chord";
                chordEl.setAttribute("data-orig", currentChord);

                let transposed = chordCache.get(currentChord);
                if (!transposed) {
                  transposed = transposeChord(currentChord, steps);
                  chordCache.set(currentChord, transposed);
                }
                chordEl.textContent = transposed;

                const spacer = document.createElement("span");
                spacer.className = "lyric-text";
                spacer.textContent = "\u00A0";

                tokenWrapper.appendChild(chordEl);
                tokenWrapper.appendChild(spacer);
                frag.appendChild(tokenWrapper);
              }

              lineEl.appendChild(frag);
              container.appendChild(lineEl);
            }

            if (idx % chunkSize === 0 && performance.now() - start > 14) break;
          }

          if (idx >= lines.length) {
            window.scrollTo({ top: 0, behavior: "smooth" });
            return;
          }
          schedule(renderChunk);
        }

        // After the lyrics chunk has started rendering, defer font fitting so the DOM is complete.
        // (The function is cheap on modern devices; still runs once per view.)
        if (!loadSingleSongView._fitScheduled) {
          loadSingleSongView._fitScheduled = true;
          setTimeout(() => {
            loadSingleSongView._fitScheduled = false;
            tryFitLyricsFontSizes();
          }, 0);
        }

        schedule(renderChunk);
      }
    });
}



/* ===== PDF generator (jsPDF + html2canvas) ===== */

/** Ensure jsPDF and html2canvas libraries are fully loaded (from CDN <script> tags in index.html) */
async function ensurePdfLibsLoaded() {
  if (window.jspdf?.jsPDF && window.html2canvas) return;
  if (window.__pdfLibsLoadingPromise) return window.__pdfLibsLoadingPromise;

  window.__pdfLibsLoadingPromise = new Promise((resolve, reject) => {
    let loaded = 0;
    const checkDone = () => { 
        loaded++; 
        if(loaded === 2) resolve(); 
    };

    // Load jsPDF
    const s1 = document.createElement('script');
    s1.src = "https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js";
    s1.onload = checkDone;
    s1.onerror = reject;
    document.head.appendChild(s1);

    // Load html2canvas
    const s2 = document.createElement('script');
    s2.src = "https://cdnjs.cloudflare.com/ajax/libs/html2canvas/1.4.1/html2canvas.min.js";
    s2.onload = checkDone;
    s2.onerror = reject;
    document.head.appendChild(s2);
  });

  return window.__pdfLibsLoadingPromise;
}

function ensurePdfFontLinks() {
  if (document.getElementById("hv-pdf-font-links")) return;

  const linkWrap = document.createElement("div");
  linkWrap.id = "hv-pdf-font-links";
  linkWrap.style.display = "none";
  linkWrap.innerHTML = `
    <link rel="preconnect" href="https://fonts.googleapis.com">
    <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
    <link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Noto+Sans:wght@400;500;600;700;800&family=Noto+Sans+Sinhala:wght@400;500;600;700;800&family=Noto+Sans+Tamil:wght@400;500;600;700;800&family=JetBrains+Mono:wght@500;700;800&display=swap">
  `;
  document.head.appendChild(linkWrap);
}

async function ensurePdfFontsReady() {
  ensurePdfFontLinks();

  try {
    await Promise.all([
      document.fonts.load("16px 'Noto Sans'"),
      document.fonts.load("16px 'Noto Sans Sinhala'"),
      document.fonts.load("16px 'Noto Sans Tamil'"),
      document.fonts.load("16px 'JetBrains Mono'"),
    ]);
    if (document.fonts && document.fonts.ready) {
      await document.fonts.ready;
    }
  } catch (e) {
    // continue with fallbacks
  }
}

function getPdfMeta() {
  const heroTitle = document.getElementById("heroTitle")?.innerText?.trim() || "HymnVault";
  const key = document.getElementById("currentKeyDisplay")?.innerText?.trim() || window.__currentHymn?.chord || "C";
  const title =
    document.querySelector(".s-v-title")?.innerText?.trim() ||
    window.__currentHymn?.title ||
    heroTitle;

  const artist = window.__currentHymn?.artist || "";
  const beat = window.__currentHymn?.beat || "";

  const safeFile = title
    .toString()
    .trim()
    .replace(/[\\/:*?"<>|]+/g, "")
    .replace(/\s+/g, " ")
    .trim() || "HymnVault";

  return { title, key, artist, beat, safeFile };
}

function extractPdfBlocksFromLiveDom() {
  const source = document.querySelector(".chord-sheet-container");
  if (!source) return [];

  const blocks = [];

  const children = Array.from(source.childNodes);
  for (const node of children) {
    if (node.nodeType === Node.TEXT_NODE) continue;
    if (node.nodeType !== Node.ELEMENT_NODE) continue;

    const el = node;

    if (el.classList.contains("section-label")) {
      blocks.push({
        type: "section",
        text: (el.textContent || "").trim(),
      });
      continue;
    }

    if (el.classList.contains("line-wrapper")) {
      const tokens = [];
      const tokenWrappers = Array.from(el.querySelectorAll(".token-wrapper"));

      for (const tw of tokenWrappers) {
        const chord = tw.querySelector(".live-chord")?.textContent || "";
        const lyric = tw.querySelector(".lyric-text")?.textContent || "";
        tokens.push({ chord, lyric });
      }

      blocks.push({ type: "line", tokens });
      continue;
    }

    if (el.tagName === "DIV" && el.style && el.style.height) {
      blocks.push({ type: "gap" });
      continue;
    }
  }

  return blocks;
}

function createPdfBlockElement(block) {
  if (block.type === "section") {
    const el = document.createElement("div");
    el.className = "hv-pdf-section";
    el.textContent = block.text || "";
    return el;
  }

  if (block.type === "gap") {
    const el = document.createElement("div");
    el.className = "hv-pdf-gap";
    return el;
  }

  const line = document.createElement("div");
  line.className = "hv-pdf-line";

  (block.tokens || []).forEach((tok) => {
    const token = document.createElement("div");
    token.className = "hv-pdf-token";

    const chord = document.createElement("div");
    chord.className = "hv-pdf-chord";
    chord.textContent = tok.chord || "\u00A0";

    const lyric = document.createElement("div");
    lyric.className = "hv-pdf-lyric";
    lyric.textContent = tok.lyric || "\u00A0";

    token.appendChild(chord);
    token.appendChild(lyric);
    line.appendChild(token);
  });

  return line;
}

function buildPdfPageShell(meta, pageBlocks, pageNo, pageCount, scaleFactor) {
  scaleFactor = scaleFactor || 1.0;
  const page = document.createElement("section");
  page.className = "hv-pdf-page";

  const bg = document.createElement("div");
  bg.className = "hv-pdf-bg";

  const border1 = document.createElement("div");
  border1.className = "hv-pdf-border-1";

  const border2 = document.createElement("div");
  border2.className = "hv-pdf-border-2";

  const inner = document.createElement("div");
  inner.className = "hv-pdf-inner";

  // Apply dynamic scaling via CSS transform so content shrinks proportionally
  if (scaleFactor !== 1.0) {
    inner.style.transform = "scale(" + scaleFactor + ")";
    inner.style.transformOrigin = "top left";
    // Counteract the scale so the bounding box remains unscaled (keeps A4 geometry)
    inner.style.width = (100 / scaleFactor) + "%";
  }

  const header = document.createElement("header");
  header.className = "hv-pdf-header";
  header.innerHTML = `
    <div class="hv-pdf-kicker">HYMNVAULT SANCTUARY</div>
    <div class="hv-pdf-title">${meta.title}</div>
    <div class="hv-pdf-key-wrap">
      <div class="hv-pdf-key-badge">KEY: ${meta.key}</div>
    </div>
    <div class="hv-pdf-meta">
      ${meta.artist ? `<span>Artist: ${meta.artist}</span>` : ""}
      ${meta.beat ? `<span>Beat: ${meta.beat}</span>` : ""}
    </div>
  `;

  const body = document.createElement("div");
  body.className = "hv-pdf-body";
  pageBlocks.forEach((b) => body.appendChild(createPdfBlockElement(b)));

  const footer = document.createElement("footer");
  footer.className = "hv-pdf-footer";
  footer.innerHTML = `
    <span>Produced beautifully by HymnVault</span>
    <span class="hv-pdf-page-no">Page ${pageNo} / ${pageCount}</span>
  `;

  inner.appendChild(header);
  inner.appendChild(body);
  inner.appendChild(footer);

  page.appendChild(bg);
  page.appendChild(border1);
  page.appendChild(border2);
  page.appendChild(inner);

  return page;
}

/**
 * Build the full page DOM, measure it, and compute a vertical scale factor
 * so everything fits on a single A4 page. Returns the scale (1.0 or less).
 * No font sizes or spacing are changed — only the entire container is scaled.
 */
function computeSinglePageScale(pageElement) {
  // A4 at 794px capture width with comfortable safety margin (~1080px usable)
  // 794 * (297/210) = 1123, we use 1080 for safety
  var MAX_PAGE_HEIGHT = 1080;
  var totalHeight = pageElement.scrollHeight;
  if (totalHeight <= MAX_PAGE_HEIGHT) return 1.0;
  return Math.max(0.45, MAX_PAGE_HEIGHT / totalHeight);
}

async function capturePageToCanvas(pageEl) {
  await new Promise((r) => requestAnimationFrame(() => r()));
  await new Promise((r) => setTimeout(r, 50));

  return window.html2canvas(pageEl, {
    scale: 2,
    useCORS: true,
    backgroundColor: "#000000",
    logging: false,
    scrollX: 0,
    scrollY: 0,
    windowWidth: 794,
    windowHeight: pageEl.scrollHeight,
  });
}

async function generateHymnPDF() {
  const source = document.querySelector(".chord-sheet-container");
  if (!source) {
    console.error("[PDF] Missing hymn content.");
    return;
  }

  await ensurePdfLibsLoaded();
  await ensurePdfFontsReady();

  const meta = getPdfMeta();
  const blocks = extractPdfBlocksFromLiveDom();

  if (!blocks.length) {
    console.error("[PDF] Empty content detected.");
    return;
  }

  const { jsPDF } = window.jspdf || {};
  const PdfCtor = jsPDF || window.jsPDF;

  if (!PdfCtor) {
    console.error("[PDF] jsPDF runtime missing.");
    return;
  }

  // Fixed A4 width in jsPDF units (mm). Height grows dynamically.
  const pdfW = 210;

  const offscreenRoot = document.createElement("div");
  offscreenRoot.className = "hv-pdf-root";
  document.body.appendChild(offscreenRoot);

  try {
    // Single continuous page: no scaling-to-fit and no fixed A4 height.
    offscreenRoot.innerHTML = "";

    // Build a single page shell with all blocks.
    // Use scaleFactor=1 to keep exact UI font sizes/spacing.
    const pageEl = buildPdfPageShell(meta, blocks, 1, 1, 1.0);
    offscreenRoot.appendChild(pageEl);

    await new Promise((r) => requestAnimationFrame(() => r()));
    await ensurePdfFontsReady();

    const canvas = await capturePageToCanvas(pageEl);
    const imgData = canvas.toDataURL("image/png");

    // Map captured width -> A4 width in mm.
    // capturePageToCanvas uses windowWidth=794.
    const capturedW = canvas.width || 794;
    const capturedH = canvas.height;

    const imgHmm = (capturedH * pdfW) / capturedW;

    // Create a PDF with exact A4 width and dynamic height.
    const pdf = new PdfCtor({
      orientation: "portrait",
      unit: "mm",
      format: [pdfW, imgHmm],
      compress: true,
    });

    // IMPORTANT: Do NOT draw a fixed-height rectangle.
    // Add image to cover full custom page height.
    pdf.addImage(imgData, "PNG", 0, 0, pdfW, imgHmm, undefined, "FAST");

    pdf.save(`${meta.safeFile}.pdf`);
  } catch (err) {
    console.error("[PDF] Failed to generate PDF:", err);
  } finally {
    offscreenRoot.remove();
  }
}

async function downloadPDF() {
  return generateHymnPDF();
}

async function generatePDF() {
  return generateHymnPDF();
}



/* ===== Show / Hide Chords Function (Mobile Specificity Fix) ===== */

// 1. Mobile CSS override karanna puluwan wenna ID eka pawichi karala inject karanawa
if (!document.getElementById("chords-style")) {
    const customStyle = document.createElement('style');
    customStyle.id = "chords-style";
    customStyle.innerHTML = `
        /* Methana #lyrics-content-area damma nisa Mobile CSS eka override wenawa */
        body.hide-my-chords #lyrics-content-area .live-chord,
        .card.hide-my-chords #lyrics-content-area .live-chord,
        .hide-my-chords .live-chord {
            display: none !important;
        }
    `;
    document.head.appendChild(customStyle);
}

// 2. Hide/Show Function eka
var chordsVisible = true;

window.toggleChords = function() {
    chordsVisible = !chordsVisible;
    const toggleBtn = document.getElementById("toggleChordsBtn");
    
    const songCard = toggleBtn ? toggleBtn.closest('.card') : document.querySelector('.card');
    
    if (chordsVisible) {
        document.body.classList.remove("hide-my-chords");
        if (songCard) songCard.classList.remove("hide-my-chords");
        if (toggleBtn) toggleBtn.innerText = "👁 Hide Chords";
    } else {
        document.body.classList.add("hide-my-chords");
        if (songCard) songCard.classList.add("hide-my-chords");
        if (toggleBtn) toggleBtn.innerText = "👁 Show Chords";
    }
};

async function downloadPNG() {
    const btn = document.getElementById('pngBtn');
    const btnText = document.getElementById('pngBtnText');

    // 1. Loading State
    if(btn) btn.disabled = true;
    const originalText = btnText ? btnText.innerText : "Download PNG";
    if(btnText) btnText.innerText = "Downloading..."; 

    try {
        const source = document.querySelector(".chord-sheet-container");
        if (!source) {
            console.error("[PNG] Missing hymn content.");
            throw new Error("Missing content");
        }

        // PDF walata pawichi karana libraries saha fonts load wela kiyala sure karaganna
        await ensurePdfLibsLoaded();
        await ensurePdfFontsReady();

        // PDF ekata ganna Data (Title, Key) saha Blocks (Lyrics/Chords) tika ganna
        const meta = getPdfMeta();
        const blocks = extractPdfBlocksFromLiveDom();

        if (!blocks.length) {
            throw new Error("Empty content detected.");
        }

        // 2. Secret Hidden Container eka hadanna (PDF eka hadana widiyatama)
        const offscreenRoot = document.createElement("div");
        offscreenRoot.className = "hv-pdf-root";
        document.body.appendChild(offscreenRoot);

        // 3. PDF eke lassanata design karapu 'Shell' eka (Header, Border) methanatath ganna
        const pageEl = buildPdfPageShell(meta, blocks, 1, 1, 1.0);
        offscreenRoot.appendChild(pageEl);

        await new Promise((r) => requestAnimationFrame(() => r()));
        await ensurePdfFontsReady();

        // 4. E lassanata hadapu container eken photo eka (canvas) ganna
        const canvas = await capturePageToCanvas(pageEl);
        
        const blob = await new Promise(resolve => canvas.toBlob(resolve, 'image/png'));
        if (!blob) throw new Error("Image generation failed");

        // 5. Wadeta passe hidden container eka ain karanna
        offscreenRoot.remove();

        // 6. Photo eka PWA ekedi Share karanna ho PC ekedi Download karanna
        const fileName = `${meta.safeFile}.png`;
        const file = new File([blob], fileName, { type: 'image/png' });

        if (navigator.canShare && navigator.canShare({ files: [file] })) {
            try {
                await navigator.share({
                    title: fileName,
                    files: [file]
                });
            } catch (err) {
                console.error("Share failed or cancelled:", err);
            }
        } else {
            const blobUrl = URL.createObjectURL(blob);
            const link = document.createElement('a');
            link.href = blobUrl;
            link.download = fileName;
            document.body.appendChild(link);
            link.click();
            document.body.removeChild(link);
            setTimeout(() => URL.revokeObjectURL(blobUrl), 10000);
        }

        // Success message
        if(btnText) btnText.innerText = "Success!";
    } catch (error) {
        console.error("PNG Download failed:", error);
        if(btnText) btnText.innerText = "Failed!";
    } finally {
        // Thathpara 2kin aayeth button eka parana thathwayata genawa
        setTimeout(() => {
            if(btn) btn.disabled = false;
            if(btnText) btnText.innerText = originalText;
        }, 2000);
    }
}
/* ===== Request ===== */
function sendRequest() {
  const n = document.getElementById("reqName").value,
    s = document.getElementById("reqSong").value,
    m = document.getElementById("reqMsg").value;

  if (!n || !s) return alert("Fill Name & Song");

  window.open(
    "https://wa.me/94769272457?text=*Hymn Request*%0A*Name:* " + n + "%0A*Song:* " + s + "%0A*Msg:* " + m
  );
}

/* ===== Startup ===== */
window.addEventListener("DOMContentLoaded", () => {
  // Start background tasks early
  loadArtistsDropdown();
  updateDailyVerse();
  setInterval(updateDailyVerse, 60000);

  const urlParams = new URLSearchParams(window.location.search);
  let hymnId = urlParams.get('hymn');

  if (!hymnId && window.location.pathname.startsWith('/hymn/')) {
      hymnId = window.location.pathname.split('/hymn/')[1];
  }

  // සින්දුවක් ඉල්ලා ඇත්නම් එය පෙන්වීම, නැත්නම් මුල් පිටුව පෙන්වීම
  if (hymnId) {
      loadSingleSongView(hymnId);
  } else {
      loadSongs();
  }
});

window.onload = () => {
  const loader = document.getElementById("loader");
  if (loader) {
    loader.classList.add("slide-out");
    setTimeout(() => {
      loader.style.display = "none";
    }, 600);
  }
};

// Expose required functions for inline handlers
window.updateDailyVerse = updateDailyVerse;
window.toggleFilterDrawer = toggleFilterDrawer;
window.toggleMobileNav = toggleMobileNav;
window.syncMobileFilters = syncMobileFilters;
window.runTranspose = runTranspose;
window.openContact = openContact;
window.closeContact = closeContact;
window.contactFromDrawerScrollToConnect = contactFromDrawerScrollToConnect;
window.goHome = goHome;

window.loadSongs = loadSongs;
window.loadSingleSongView = loadSingleSongView;
window.generatePDF = generatePDF;
window.downloadPDF = downloadPDF;
window.sendRequest = sendRequest;

window.closeMobileNav = closeMobileNav;
window.showPrivacy = showPrivacy;
window.showTerms = showTerms;
window.closePrivacyTerms = closePrivacyTerms;

// ---- Dynamic lyric fitting on mobile ----
// Adjusts CSS var on the current hymn container so lines fit without wrapping.
function tryFitLyricsFontSizes() {
  try {
    const mount = document.getElementById('lyrics-content-area');
    if (!mount) return;
    const container = mount.querySelector('.chord-sheet-container');
    if (!container) return;

    // Only apply on mobile-like screens.
    if (!window.matchMedia('(max-width: 1023px)').matches) return;

    // Set defaults (readable).
    const fontMin = 13; // requested min readable
    const fontMax = 16; // requested comfort max
    const lineHeight = 1.2;

    const availableW = container.clientWidth || window.innerWidth;
    if (!availableW || availableW <= 20) return;

    const lyricEls = Array.from(container.querySelectorAll('.line-wrapper'));
    if (!lyricEls.length) return;

    // Ensure measurements use current computed box model without changing layout significantly.
    const original = container.style.getPropertyValue('--hv-lyrics-font-size');

    const setFontSize = (px) => {
      container.style.setProperty('--hv-lyrics-font-size', px + 'px');
      container.style.setProperty('--hv-lyrics-line-height', lineHeight);
    };

    // Binary search the maximum font size that fits the longest line.
    const testFit = (px) => {
      setFontSize(px);
      let fits = true;
      for (const lineEl of lyricEls) {
        // Measure full scroll width of the line when nowrap is active.
        // If it overflows the container, it will be scrollable.
        const sw = lineEl.scrollWidth;
        if (sw - 0.5 > availableW) {
          fits = false;
          break;
        }
      }
      return fits;
    };

    // If it fits at max, keep it.
    let lo = fontMin;
    let hi = fontMax;
    let best = fontMin;
    if (testFit(hi)) {
      best = hi;
    } else {
      // Binary search integer px.
      while (lo <= hi) {
        const mid = Math.floor((lo + hi) / 2);
        if (testFit(mid)) {
          best = mid;
          lo = mid + 1;
        } else {
          hi = mid - 1;
        }
      }
    }

    setFontSize(best);

    // Enable horizontal scroll only for lines that still overflow at min.
    // First, compute overflow at fontMin.
    setFontSize(fontMin);
    const overflowLines = [];
    for (const lineEl of lyricEls) {
      if (lineEl.scrollWidth - 0.5 > availableW) overflowLines.push(lineEl);
    }

    // Restore to best.
    setFontSize(best);

    // Toggle per-line scrolling.
    for (const lineEl of lyricEls) {
      lineEl.classList.remove('hv-line-scroll');
      lineEl.style.overflowX = 'hidden';
    }
    for (const lineEl of overflowLines) {
      lineEl.classList.add('hv-line-scroll');
      lineEl.style.overflowX = 'auto';
    }

    if (original !== '') {
      // keep our set value; original is not used but prevents lint warnings.
    }
  } catch (e) {
    // fail silently
  }
}

window.tryFitLyricsFontSizes = tryFitLyricsFontSizes;

window.addEventListener('resize', () => {
  // Debounce to avoid thrash.
  clearTimeout(window.__hvLyricFitT);
  window.__hvLyricFitT = setTimeout(() => {
    tryFitLyricsFontSizes();
  }, 180);
});


// Drawer behavior upgrades
window.addEventListener('DOMContentLoaded', () => {
  // If the drawer is open and a hymn is selected in Trending This Week,
  // the inline onclick handler will run as well. Ensure we always close.
  // (This also helps on low-end devices where event ordering can be flaky.)
  const drawer = document.getElementById('mobileSideDrawer');
  const overlay = document.getElementById('drawerOverlay');
  if (!drawer || !overlay) return;

  overlay.addEventListener('click', () => {
    closeMobileNav();
  });

  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') closeMobileNav();
  });

  bindMobileDrawerAutoClose();
  bindMobileDrawerHashAutoClose();

  // Close the side drawer when a hymn in the "🔥 Trending This Week" area is clicked
  // (both desktop and mobile trending markup).
  const trendingRootSelectors = [
    '.sidebar-right .right-panel-box',
    '.mobile-trending-inline'
  ];

  trendingRootSelectors.forEach((rootSel) => {
    const roots = document.querySelectorAll(rootSel);
    roots.forEach((root) => {
      const h3Text = root.querySelector('h3')?.textContent || '';
      const isTrendingThisWeek = h3Text.includes('Trending This Week') || rootSel.includes('mobile-trending-inline');
      if (!isTrendingThisWeek) return;

      root.querySelectorAll('.trending-item').forEach((item) => {
        item.addEventListener('click', () => {
          closeMobileNavImmediately();
        });
      });
    });
  });
});



// Safety: if app code fails before removing loader, hide it after a short delay


setTimeout(() => {
  const loader = document.getElementById('loader');
  if (loader && loader.style.display !== 'none') {
    loader.classList.add('slide-out');
    setTimeout(() => {
      loader.style.display = 'none';
    }, 600);
  }
}, 7000);

/* ===== Browser Back / Forward Button Handler ===== */
window.addEventListener('popstate', (event) => {
  const currentPath = window.location.pathname;

  if (currentPath === "/" || currentPath === "") {
      goHome(true); 
  } 
  else if (currentPath.startsWith("/hymn/")) {
      const id = currentPath.split('/hymn/')[1];
      if (id) {
          loadSingleSongView(id, true);
      }
  }
});
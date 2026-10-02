const functions = require('firebase-functions');
const admin = require('firebase-admin');
const { SitemapStream, streamToPromise } = require('sitemap');

admin.initializeApp();
const db = admin.firestore();

const BASE_URL = 'https://hymnvault.web.app';
const SITEMAP_BUCKET_PATH = 'seo-cache/sitemap.xml';

function toXmlDate(dateLike) {
  try {
    const d = dateLike instanceof Date ? dateLike : new Date(dateLike);
    if (Number.isNaN(d.getTime())) return null;
    const yyyy = d.getUTCFullYear();
    const mm = String(d.getUTCMonth() + 1).padStart(2, '0');
    const dd = String(d.getUTCDate()).padStart(2, '0');
    return `${yyyy}-${mm}-${dd}`;
  } catch (e) {
    return null;
  }
}

function safeLoc(pathOrUrl) {
  // Ensure sitemap <loc> values are valid URLs and URL-encoded where needed.
  // For query-based URLs, encode the query value separately.
  return pathOrUrl;
}

async function listHymnsForSitemap() {
  // Source of truth: collection `hymns`.
  // We intentionally do a full collection scan only when hymn docs change.
  const snap = await db.collection('hymns').get();
  const items = [];

  snap.forEach((doc) => {
    const data = doc.data() || {};

    // Basic hymn URL model matches your existing generator:
    // https://hymnvault.web.app/?hymn=<doc.id>
    items.push({
      id: doc.id,
      loc: `${BASE_URL}/?hymn=${encodeURIComponent(doc.id)}`,
      // lastmod: prefer updateTime; fall back to createTime
      lastmod: toXmlDate(doc.updateTime) || toXmlDate(doc.createTime),
      language: typeof data.language === 'string' ? data.language.trim().toLowerCase() : '',
    });
  });

  // Deduplicate by loc (just in case)
  const seen = new Set();
  const deduped = [];
  for (const it of items) {
    if (seen.has(it.loc)) continue;
    seen.add(it.loc);
    deduped.push(it);
  }

  return deduped;
}

async function buildSitemapXml() {
  const urls = [];

  // Homepage
  urls.push({
    loc: `${BASE_URL}/`,
    changefreq: 'daily',
    priority: 1.0,
  });

  const hymnUrls = await listHymnsForSitemap();
  for (const h of hymnUrls) {
    const u = {
      url: h.loc,
      changefreq: 'weekly',
      priority: 0.8,
    };

    // sitemap library supports lastmod via `lastmod`.
    // Only add lastmod if we have a valid date.
    if (h.lastmod) u.lastmod = h.lastmod;

    urls.push(u);
  }

  // Build XML using `sitemap` stream
  const stream = new SitemapStream({ hostname: BASE_URL });
  for (const u of urls) {
    // `sitemap` expects either relative path or full URL.
    // We will pass full URL by writing `url`.
    // For homepage loc, we used `${BASE_URL}/` which is safe.
    stream.write({
      url: u.url || u.loc,
      changefreq: u.changefreq,
      priority: u.priority,
      lastmod: u.lastmod,
    });
  }

  stream.end();
  const xml = await streamToPromise(stream).then((data) => data.toString());

  // Ensure XML header present (library typically includes it)
  return xml;
}

async function writeSitemapCache(xml) {
  // Cache to Cloud Storage so HTTP reads are fast.
  const bucket = admin.storage().bucket();
  const file = bucket.file(SITEMAP_BUCKET_PATH);

  await file.save(xml, {
    contentType: 'application/xml; charset=utf-8',
    resumable: false,
    metadata: {
      cacheControl: 'public, max-age=300, must-revalidate',
    },
  });
}

async function ensureInitialSitemapCache() {
  try {
    const bucket = admin.storage().bucket();
    const file = bucket.file(SITEMAP_BUCKET_PATH);
    const [exists] = await file.exists();
    if (exists) return;

    const xml = await buildSitemapXml();
    await writeSitemapCache(xml);
  } catch (e) {
    // non-fatal; HTTP endpoint will attempt to build on demand
    console.error('[sitemap] ensureInitialSitemapCache failed:', e);
  }
}

async function getCachedSitemapXml() {
  const bucket = admin.storage().bucket();
  const file = bucket.file(SITEMAP_BUCKET_PATH);

  const [exists] = await file.exists();
  if (!exists) return null;

  const [buf] = await file.download();
  return buf.toString('utf8');
}

function relevantFieldsChanged(beforeData, afterData) {
  // Only rebuild if hymn content that affects indexing changed.
  // Note: language field influences language-specific URLs/behavior.
  // Your app URLs do not include language in the path; however sitemap should list hymn URLs.
  // Still rebuild if language changes because lastmod + content may change.
  const watched = [
    'title',
    'singlish_title',
    'tamil_title',
    'artist',
    'language',
    'chord',
    'beat',
    'lyrics',
  ];

  const b = beforeData || {};
  const a = afterData || {};

  for (const k of watched) {
    if (String(b[k] ?? '') !== String(a[k] ?? '')) return true;
  }
  return false;
}

async function rebuildSitemapForAnyWrite(change) {
  const beforeExists = !!change.before.exists;
  const afterExists = !!change.after.exists;

  // Build on create/update/delete only.
  if (beforeExists && afterExists) {
    const beforeData = change.before.data();
    const afterData = change.after.data();
    if (!relevantFieldsChanged(beforeData, afterData)) return; // cost control
  } else {
    // create or delete
    // (optional) if it's an update where all watched fields are empty, still rebuild.
  }

  const xml = await buildSitemapXml();
  await writeSitemapCache(xml);
}

// Firestore trigger: update sitemap cache when hymns change.
exports.onHymnWrite = functions.firestore
  .document('hymns/{hymnId}')
  .onWrite(async (change, context) => {
    try {
      await rebuildSitemapForAnyWrite(change);
    } catch (e) {
      console.error('[sitemap] rebuild failed:', e);
    }
  });

// Dynamic HTTP endpoint
exports.sitemap = functions.https.onRequest(async (req, res) => {
  try {
    // Only accept GET.
    if (req.method !== 'GET') {
      res.status(405).send('Method Not Allowed');
      return;
    }

    await ensureInitialSitemapCache();

    const xml = await getCachedSitemapXml();

    if (!xml) {
      // Fallback: build on demand (should be rare)
      const built = await buildSitemapXml();
      await writeSitemapCache(built);
      res.set('Content-Type', 'application/xml; charset=utf-8');
      res.set('Cache-Control', 'public, max-age=300, must-revalidate');
      res.status(200).send(built);
      return;
    }

    res.set('Content-Type', 'application/xml; charset=utf-8');
    res.set('Cache-Control', 'public, max-age=300, must-revalidate');
    res.status(200).send(xml);
  } catch (e) {
    console.error('[sitemap] HTTP error:', e);
    res.status(500).send('Internal Server Error');
  }
});


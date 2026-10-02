const admin = require('firebase-admin');
const fs = require('fs');
const path = require('path');
const { SitemapStream, streamToPromise } = require('sitemap');

// 1. Firebase Admin Initialize කිරීම
const serviceAccount = require('./serviceAccountKey.json');
admin.initializeApp({
  credential: admin.credential.cert(serviceAccount)
});

const db = admin.firestore();

async function generateSitemap() {
  try {
    console.log("Fetching hymns from Firestore...");
    
    // 🔴 වැදගත්: ඔයාගේ Firestore එකේ Hymns තියෙන Collection එකේ නම මෙතන 'hymns' වෙනුවට දෙන්න.
    const collectionName = 'hymns'; 
    
    const snapshot = await db.collection(collectionName).get();
    const sitemap = new SitemapStream({ hostname: 'https://hymnvault.web.app' });
    
    // Home Page එක sitemap එකට එකතු කිරීම
    sitemap.write({ url: '/', changefreq: 'daily', priority: 1.0 });
    
    // Firestore එකේ තියෙන හැම ID එකක්ම ලූප් එකක් හරහා sitemap එකට එකතු කිරීම
    snapshot.forEach(doc => {
      let data = doc.data();
      let linkId = data.slug ? encodeURIComponent(data.slug) : doc.id;
      
      sitemap.write({ 
        url: `/hymn/${linkId}`, 
        changefreq: 'weekly', 
        priority: 0.8 
      });
    });
    
    sitemap.end();
    
    // XML එකක් විදිහට data ටික stream කරගැනීම
    const sitemapOutput = await streamToPromise(sitemap).then(data => data.toString());
    
    // public folder එක ඇතුලට sitemap.xml එක save කිරීම
    const outputPath = path.join(__dirname, 'public', 'sitemap.xml');
    fs.writeFileSync(outputPath, sitemapOutput);
    
    console.log(`✅ Sitemap successfully generated at: ${outputPath}`);
    process.exit(0);
  } catch (error) {
    console.error("❌ Error generating sitemap:", error);
    process.exit(1);
  }
}

generateSitemap();
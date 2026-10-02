Build instructions (local)

1. Install dev dependencies (run in the `public` folder):

```bash
npm install
```

2. Produce minified files:

```bash
npm run build
```

This creates `script.min.js` (via esbuild bundling of `script.js` + `firebase-init.js`) and `style.min.css` (via postcss + cssnano). Update deployment to serve these minified files.

Notes:
- Service worker precaches both original and minified assets for compatibility.
- You can adjust esbuild options in `package.json` as needed.

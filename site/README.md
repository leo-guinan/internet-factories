# Internet Factories landing page

This directory is a self-contained GitHub Pages site. It has no build step: GitHub Pages serves `index.html`, `styles.css`, and `script.js` directly.

## Local preview

From the repository root:

```bash
python3 -m http.server 8000 --directory site
```

Open http://localhost:8000.

## Deployment

`.github/workflows/pages.yml` deploys the directory to GitHub Pages on pushes to `main` that change `site/**`. In the repository settings, set Pages → Source to GitHub Actions once.

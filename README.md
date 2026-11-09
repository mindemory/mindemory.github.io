# mindemory.io

Source for [mindemory.io](https://www.mindemory.io), the website of Mrugank Dake, a computational neuroscientist and postdoctoral researcher at Dartmouth College. Plain HTML, CSS and JavaScript with no build step, served by GitHub Pages.

## What's here

- `index.html`: home page (about, news, research)
- `cv.html`: interactive CV, rendered from `cv_data.js`
- `projects.html` and `projects/`: project pages, including the [MCN Alumni Network](https://www.mindemory.io/projects/mcn-network.html), the [library map](https://www.mindemory.io/projects/library-map.html) from the Notion Paperpile Integration, [Proxenos](https://www.mindemory.io/proxenos) and [Thanos](https://www.mindemory.io/thanos)
- `proxenos/`, `thanos/`: short links to those project pages
- `docs/`: the CV, resume, posters and Proxenos slide deck as PDFs
- `mindemory/`: an older blog, kept but no longer linked

## Updating the CV

The interactive CV is generated from the CV PDF.

1. Replace `docs/MrugankDakeCV.pdf`.
2. Run `python update_cv.py` (needs `PyPDF2`). It rewrites `cv_data.js`.
3. Check `cv.html` locally, then commit both files.

The script reads the PDF's text, so it depends on the CV keeping its section titles and layout.

## Updating the library map

`projects/library-map.html` is drawn by the [Notion Paperpile Integration](https://github.com/mindemory/notion_paperpile) from the Paperpile export in that repo, and doesn't update by itself. With both repos side by side, refresh it from `notion_paperpile`:

```bash
git pull
python build_graph.py --out ../mindemory.github.io/projects/library-map.html
```

Then commit the file here.

## Running locally

```bash
python -m http.server 8000
```

Then open http://localhost:8000.

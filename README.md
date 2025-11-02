# YouTube Playlist Batch Deleter

A small React + Vite helper that lets you audit and delete large batches of YouTube playlists using the same headers your browser sends to youtube.com.

## Getting Started

```bash
npm install
npm run dev
```

The dev server runs on <http://localhost:5173> by default.

## Usage

1. In your browser's developer tools, copy the full request headers from an authenticated `https://www.youtube.com` request.
2. Paste the headers (one per line) into the app. The `Authorization` header must include a `SAPISIDHASH …` token and the matching `Cookie` header from the same request.
3. The app validates the headers, fetches your playlists automatically, and locks the header field to prevent accidental edits.
4. Filter or sort the table, tick the playlists you want to remove, and confirm the deletion prompt.

You can unlock the headers at any time with the **Edit token** button to paste new values.

## Commands

- `npm run dev` – start the development server
- `npm run build` – build the production bundle
- `npm run preview` – preview the built app locally
- `npm run lint` – run the ESLint checks

## Deployment

Pushes to `main` automatically build and publish the site to GitHub Pages at <https://alexw00.github.io/youtube-playlist-bach-deleter/>.

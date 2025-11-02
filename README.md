## YouTube Playlist Organizer

A minimal Vite + React app that lets you batch-delete YouTube playlists using your own browser session headers. No backend, no OAuth dance — just paste the authentication headers you already have and manage your playlists with a clean shadcn/ui interface.

### Getting Started

1. Install dependencies:
   ```bash
   npm install
   ```
2. Run the dev server (includes a proxy that forwards `/yt-api/*` to Google):
   ```bash
   npm run dev
   ```
3. Open the printed localhost URL in your browser.

### Collecting the required headers

1. While signed in to YouTube, open DevTools and visit the **Network** tab.
2. Filter for requests to `youtube.com` or `googleapis.com`, then click any authenticated request (e.g. `/youtubei/v1/browse`).
3. Copy the following headers from the **Request headers** panel:
   - `Authorization` (required, starts with either `Bearer` **or** `SAPISIDHASH`)
   - `X-Goog-AuthUser`
   - `X-Origin` (e.g. `https://www.youtube.com` or `https://music.youtube.com`)
   - `Cookie`, `X-Goog-Visitor-Id`, and `X-Youtube-Client-Version` when the `Authorization` header begins with `SAPISIDHASH` (these enable the internal `youtubei` API)
4. Paste each header on its own line in the app:
   ```
   Authorization: Bearer ya29...
   X-Goog-AuthUser: 0
   X-Origin: https://www.youtube.com
   Cookie: VISITOR_INFO1_LIVE=...
   ```
5. Click **Fetch playlists**. If the headers are valid, your playlists will appear in the table.

> ℹ️ The app stores the raw headers in `localStorage` on your device so you don’t have to paste them every time. They are only sent directly to the Google endpoints that you hit (`youtube/v3` for `Bearer …`, `youtubei/v1` for `SAPISIDHASH …`).

### Deleting playlists

1. Check the playlists you want to remove.
2. Click **Delete selected** and confirm the prompt.
3. The app deletes each playlist sequentially and shows progress (you can cancel mid-way via the dialog).

### Notes & caveats

- If your `Authorization` header starts with `Bearer`, requests go to the official [YouTube Data API v3](https://developers.google.com/youtube/v3/docs). A `SAPISIDHASH` token automatically switches to the internal `youtubei` endpoints that power youtube.com, which is what you normally get when copying requests from DevTools.
- When using the `youtubei` endpoints you must copy the cookie and visitor headers from the same request; without them Google will respond with `401` or `403`.
- Deleting playlists is permanent. There is no undo API — double-check the list before confirming.
- Because we talk to Google endpoints from the browser, you may hit CORS or consent prompts if Google updates their restrictions. In that case, re-capture headers from a recent request or try a different endpoint that already allows your origin.
- This project intentionally avoids a backend. If you need something more robust, consider forking it and adding a server to proxy requests securely.

> 🛡️ **CORS in production** – The built-in proxy only runs in `npm run dev`. If you host the static bundle elsewhere, you must provide reverse proxies for the same paths:
>
> - `/yt-api/*` → `https://www.googleapis.com/`
> - `/yt-inner/*` → `https://www.youtube.com/youtubei/`
>
> Set the deployment URLs through `VITE_YOUTUBE_API_BASE` and `VITE_YOUTUBEI_API_BASE` if you mount the proxies on different paths.
>
> The dev proxy converts helper headers such as `X-YouTube-Proxy-Cookie` back into real `Cookie` / `Origin` / `User-Agent` headers before forwarding. Replicate that behaviour in your production proxy if you intend to use the `youtubei` mode.

### Scripts

- `npm run dev` – start Vite in dev mode.
- `npm run build` – type-check and bundle for production.
- `npm run lint` – run ESLint.
- Set `VITE_YOUTUBE_API_BASE` / `VITE_YOUTUBEI_API_BASE` in `.env` if you host behind different proxy paths or domains (defaults to `/yt-api/youtube/v3` and `/yt-inner/youtubei/v1` during local dev, falling back to Google’s public endpoints in production).

const DEV_DATA_API_BASE = "/yt-api/youtube/v3"
const DEV_INNERTUBE_BASE = "/yt-inner/youtubei/v1"
const PROD_DATA_API_BASE = "https://www.googleapis.com/youtube/v3"
const PROD_INNERTUBE_BASE = "https://www.youtube.com/youtubei/v1"

const DEFAULT_CLIENT_VERSION = "2.20251030.01.00"
const DEFAULT_CLIENT_NAME_CODE = "1" // WEB
const DEFAULT_ORIGIN = "https://www.youtube.com"
const PLAYLIST_BROWSE_ID = "FEplaylist_aggregation"

const DATA_API_BASE = normalizeBaseUrl(
  import.meta.env.VITE_YOUTUBE_API_BASE ??
    (import.meta.env.DEV ? DEV_DATA_API_BASE : PROD_DATA_API_BASE),
)

const INNERTUBE_BASE = normalizeBaseUrl(
  import.meta.env.VITE_YOUTUBEI_API_BASE ??
    (import.meta.env.DEV ? DEV_INNERTUBE_BASE : PROD_INNERTUBE_BASE),
)

export interface Playlist {
  id: string
  title: string
  description: string
  privacyStatus: string
  itemCount: number
  channelTitle: string
  updatedAt: string
  thumbnailUrl?: string
}

interface PlaylistApiResponse {
  nextPageToken?: string
  items?: Array<{
    id: string
    snippet?: {
      title?: string
      description?: string
      channelTitle?: string
      thumbnails?: Record<string, { url?: string }>
      publishedAt?: string
    }
    status?: {
      privacyStatus?: string
    }
    contentDetails?: {
      itemCount?: number
    }
  }>
}

interface GoogleApiError {
  error?: {
    code?: number
    message?: string
    errors?: Array<{ message?: string; reason?: string }>
  }
}

export class YouTubeApiError extends Error {
  readonly status: number

  constructor(status: number, message: string) {
    super(message)
    this.status = status
  }
}

export type HeaderMap = Record<string, string>

interface PreparedHeaders {
  headers: Headers
  normalized: HeaderMap
}

const DEFAULT_HEADERS: HeaderMap = {
  Accept: "application/json",
  "Content-Type": "application/json",
  "X-Goog-AuthUser": "0",
  "X-Origin": DEFAULT_ORIGIN,
  Origin: DEFAULT_ORIGIN,
  "X-Youtube-Client-Name": DEFAULT_CLIENT_NAME_CODE,
  "X-Youtube-Client-Version": DEFAULT_CLIENT_VERSION,
}

const PROXY_HEADER_MAP: Record<string, string> = {
  Cookie: "X-YouTube-Proxy-Cookie",
  Origin: "X-YouTube-Proxy-Origin",
  Referer: "X-YouTube-Proxy-Referer",
  "User-Agent": "X-YouTube-Proxy-User-Agent",
  "Accept-Language": "X-YouTube-Proxy-Accept-Language",
}

const FORBIDDEN_HEADER_PREFIXES = ["Sec-", "Proxy-"]
const FORBIDDEN_HEADER_NAMES = new Set([
  "Accept-Charset",
  "Accept-Encoding",
  "Access-Control-Request-Headers",
  "Access-Control-Request-Method",
  "Connection",
  "Content-Length",
  "Cookie",
  "Cookie2",
  "Date",
  "DNT",
  "Expect",
  "Host",
  "Keep-Alive",
  "Origin",
  "Referer",
  "TE",
  "Trailer",
  "Transfer-Encoding",
  "Upgrade",
  "Via",
])

const CLIENT_NAME_BY_CODE: Record<string, string> = {
  "1": "WEB",
  "2": "ANDROID",
  "3": "IOS",
  "7": "WEB_REMIX",
  "67": "WEB_REMIX",
}

export function normalizeHeaderName(name: string): string {
  return name
    .trim()
    .toLowerCase()
    .split("-")
    .map((segment) => segment.charAt(0).toUpperCase() + segment.slice(1))
    .join("-")
}

export async function fetchAllPlaylists(
  rawHeaders: HeaderMap,
  signal?: AbortSignal,
): Promise<Playlist[]> {
  const prepared = prepareHeaders(rawHeaders)
  if (shouldUseInnerTube(prepared.normalized)) {
    return fetchPlaylistsInnerTube(prepared, signal)
  }

  try {
    return await fetchPlaylistsDataApi(prepared, signal)
  } catch (error) {
    // Fall back to InnerTube when official API rejects the credentials
    if (
      error instanceof YouTubeApiError &&
      (error.status === 401 || error.status === 403)
    ) {
      return fetchPlaylistsInnerTube(prepared, signal)
    }
    throw error
  }
}

export async function deletePlaylist(
  playlistId: string,
  rawHeaders: HeaderMap,
  signal?: AbortSignal,
): Promise<void> {
  const prepared = prepareHeaders(rawHeaders)
  if (shouldUseInnerTube(prepared.normalized)) {
    await deletePlaylistInnerTube(playlistId, prepared, signal)
    return
  }

  try {
    await deletePlaylistDataApi(playlistId, prepared, signal)
  } catch (error) {
    if (
      error instanceof YouTubeApiError &&
      (error.status === 401 || error.status === 403)
    ) {
      await deletePlaylistInnerTube(playlistId, prepared, signal)
      return
    }
    throw error
  }
}

function shouldUseInnerTube(headers: HeaderMap): boolean {
  const auth = headers.Authorization ?? ""
  if (/^Bearer\s+/i.test(auth)) {
    return false
  }
  return /SAPISID/i.test(auth)
}

function prepareHeaders(raw: HeaderMap): PreparedHeaders {
  const normalized = {
    ...DEFAULT_HEADERS,
    ...normalizeHeaderKeys(raw),
  }

  if (!normalized.Authorization?.trim()) {
    throw new Error("Authorization header is required.")
  }

  const headers = new Headers()
  for (const [key, value] of Object.entries(normalized)) {
    if (!value?.trim()) {
      continue
    }

    if (PROXY_HEADER_MAP[key]) {
      headers.set(PROXY_HEADER_MAP[key], value.trim())
      continue
    }

    if (isForbiddenHeaderName(key)) {
      continue
    }

    headers.set(key, value.trim())
  }

  return { headers, normalized }
}

function normalizeHeaderKeys(headers: HeaderMap): HeaderMap {
  const result: HeaderMap = {}
  for (const [key, value] of Object.entries(headers)) {
    result[normalizeHeaderName(key)] = value
  }
  return result
}

function isForbiddenHeaderName(name: string): boolean {
  if (FORBIDDEN_HEADER_NAMES.has(name)) {
    return true
  }

  return FORBIDDEN_HEADER_PREFIXES.some((prefix) =>
    name.startsWith(prefix),
  )
}

async function handleResponse(response: Response): Promise<any> {
  const contentType = response.headers.get("content-type") ?? ""
  const isJson = contentType.includes("application/json")
  const body = isJson ? await response.json() : await response.text()

  if (!response.ok) {
    const message =
      typeof body === "string"
        ? body || response.statusText
        : (body as GoogleApiError).error?.message ??
          (body as GoogleApiError).error?.errors?.[0]?.message ??
          response.statusText

    throw new YouTubeApiError(response.status, message)
  }

  return body
}

async function fetchPlaylistsDataApi(
  prepared: PreparedHeaders,
  signal?: AbortSignal,
): Promise<Playlist[]> {
  const playlists: Playlist[] = []
  let pageToken: string | undefined

  do {
    const url = buildEndpoint(DATA_API_BASE, "playlists", {
      part: "snippet,contentDetails,status",
      mine: "true",
      maxResults: "50",
      ...(pageToken ? { pageToken } : {}),
    })

    const requestHeaders = new Headers(prepared.headers)

    const data = (await fetch(url, {
      method: "GET",
      headers: requestHeaders,
      signal,
      credentials: "include",
    }).then(handleResponse)) as PlaylistApiResponse

    for (const item of data.items ?? []) {
      playlists.push({
        id: item.id,
        title: item.snippet?.title ?? "Untitled playlist",
        description: item.snippet?.description ?? "",
        channelTitle: item.snippet?.channelTitle ?? "",
        privacyStatus: item.status?.privacyStatus ?? "unknown",
        itemCount: item.contentDetails?.itemCount ?? 0,
        updatedAt: item.snippet?.publishedAt ?? "",
        thumbnailUrl:
          item.snippet?.thumbnails?.standard?.url ??
          item.snippet?.thumbnails?.high?.url ??
          item.snippet?.thumbnails?.medium?.url ??
          item.snippet?.thumbnails?.default?.url,
      })
    }

    pageToken = data.nextPageToken
  } while (pageToken)

  return playlists
}

async function deletePlaylistDataApi(
  playlistId: string,
  prepared: PreparedHeaders,
  signal?: AbortSignal,
): Promise<void> {
  const url = buildEndpoint(DATA_API_BASE, "playlists", { id: playlistId })
  const requestHeaders = new Headers(prepared.headers)

  await fetch(url, {
    method: "DELETE",
    headers: requestHeaders,
    signal,
    credentials: "include",
  }).then(handleResponse)
}

async function fetchPlaylistsInnerTube(
  prepared: PreparedHeaders,
  signal?: AbortSignal,
): Promise<Playlist[]> {
  const playlists: Playlist[] = []
  const seen = new Set<string>()
  let continuation: string | undefined

  do {
    const payload = buildBrowsePayload(prepared.normalized, continuation)
    const url = buildEndpoint(INNERTUBE_BASE, "browse", {
      prettyPrint: "false",
    })

    const requestHeaders = new Headers(prepared.headers)
    const data = await fetch(url, {
      method: "POST",
      headers: requestHeaders,
      body: JSON.stringify(payload),
      signal,
      credentials: "include",
    }).then(handleResponse)

    const { items, continuation: nextToken } =
      parseBrowseResponse(data)

    for (const item of items) {
      if (!seen.has(item.id)) {
        playlists.push(item)
        seen.add(item.id)
      }
    }

    continuation = nextToken
  } while (continuation)

  return playlists
}

async function deletePlaylistInnerTube(
  playlistId: string,
  prepared: PreparedHeaders,
  signal?: AbortSignal,
): Promise<void> {
  const url = buildEndpoint(INNERTUBE_BASE, "playlist/delete", {
    prettyPrint: "false",
  })

  const payload = {
    context: buildInnerTubeContext(prepared.normalized),
    playlistId,
  }

  const requestHeaders = new Headers(prepared.headers)
  await fetch(url, {
    method: "POST",
    headers: requestHeaders,
    body: JSON.stringify(payload),
    signal,
    credentials: "include",
  }).then(handleResponse)
}

function buildBrowsePayload(
  headers: HeaderMap,
  continuation?: string,
) {
  const context = buildInnerTubeContext(headers)

  if (continuation) {
    return { context, continuation }
  }

  return {
    context,
    browseId: PLAYLIST_BROWSE_ID,
  }
}

function buildInnerTubeContext(headers: HeaderMap) {
  const clientVersion =
    headers["X-Youtube-Client-Version"] ?? DEFAULT_CLIENT_VERSION
  const clientNameCode =
    headers["X-Youtube-Client-Name"] ?? DEFAULT_CLIENT_NAME_CODE
  const clientName =
    CLIENT_NAME_BY_CODE[clientNameCode] ?? CLIENT_NAME_BY_CODE[DEFAULT_CLIENT_NAME_CODE]

  const acceptLanguage = headers["Accept-Language"] ?? "en-US"
  const hl = extractHl(acceptLanguage)
  const gl = extractGl(acceptLanguage)

  const origin =
    headers["X-Origin"] ??
    headers["Origin"] ??
    DEFAULT_ORIGIN

  const graftPath = "/feed/playlists"

  return {
    client: {
      clientName,
      clientVersion,
      hl,
      gl,
      visitorData: headers["X-Goog-Visitor-Id"],
      userAgent: headers["User-Agent"],
      platform: "DESKTOP",
      clientFormFactor: "UNKNOWN_FORM_FACTOR",
      mainAppWebInfo: {
        graftUrl: graftPath,
        webDisplayMode: "WEB_DISPLAY_MODE_BROWSER",
        isWebNativeShareAvailable: false,
      },
      originalUrl: `${stripTrailingSlash(origin)}${graftPath}`,
    },
    request: {
      useSsl: true,
    },
    user: {
      enableSafetyMode: false,
    },
  }
}

function parseBrowseResponse(data: any): {
  items: Playlist[]
  continuation?: string
} {
  const renderers: any[] = []
  const continuationTokens: string[] = []
  const seenContinuations = new Set<string>()
  const visited = typeof WeakSet !== "undefined" ? new WeakSet<object>() : null

  const enqueueRenderer = (renderer: any) => {
    if (!renderer || typeof renderer !== "object") {
      return
    }
    renderers.push(renderer)
  }

  const recordContinuation = (node: any) => {
    if (!node || typeof node !== "object") {
      return
    }
    const token =
      node?.nextContinuationData?.continuation ??
      node?.reloadContinuationData?.continuation ??
      node?.continuationEndpoint?.continuationCommand?.token ??
      node?.continuationItemRenderer?.continuationEndpoint?.continuationCommand
        ?.token

    if (token && typeof token === "string" && !seenContinuations.has(token)) {
      seenContinuations.add(token)
      continuationTokens.push(token)
    }
  }

  const walk = (node: any) => {
    if (!node || typeof node !== "object") {
      return
    }

    if (visited) {
      if (visited.has(node)) {
        return
      }
      visited.add(node)
    }

    if (Array.isArray(node)) {
      for (const item of node) {
        walk(item)
      }
      return
    }

    if (node.playlistRenderer) {
      enqueueRenderer(node.playlistRenderer)
    }
    if (node.gridPlaylistRenderer) {
      enqueueRenderer(node.gridPlaylistRenderer)
    }
    if (node.compactPlaylistRenderer) {
      enqueueRenderer(node.compactPlaylistRenderer)
    }
    if (
      node.lockupViewModel &&
      (node.contentType?.toString().includes("PLAYLIST") ||
        node.lockupViewModel?.metadata?.lockupMetadataViewModel)
    ) {
      enqueueRenderer(node)
    }

    recordContinuation(node)
    recordContinuation(node.continuationItemRenderer)

    if (node.richItemRenderer?.content) {
      walk(node.richItemRenderer.content)
    }
    if (node.gridRenderer?.items) {
      walk(node.gridRenderer.items)
    }
    if (node.itemSectionRenderer?.contents) {
      walk(node.itemSectionRenderer.contents)
    }
    if (node.shelfRenderer?.content) {
      walk(node.shelfRenderer.content)
    }
    if (node.horizontalListRenderer?.items) {
      walk(node.horizontalListRenderer.items)
    }
    if (node.expandedShelfContentsRenderer?.items) {
      walk(node.expandedShelfContentsRenderer.items)
    }

    for (const value of Object.values(node)) {
      if (value && typeof value === "object") {
        walk(value)
      }
    }
  }

  walk(data)

  const converted = renderers
    .map(convertRendererToPlaylist)
    .filter((item): item is Playlist => item !== null)

  return {
    items: converted,
    continuation: continuationTokens[0],
  }
}

function convertRendererToPlaylist(renderer: any): Playlist | null {
  if (
    renderer?.lockupViewModel &&
    (renderer?.contentType?.toString().includes("PLAYLIST") ||
      renderer.lockupViewModel?.metadata?.lockupMetadataViewModel)
  ) {
    return convertLockupPlaylist(renderer)
  }

  const playlistId = extractPlaylistId(renderer)
  if (!playlistId) {
    return null
  }

  const title =
    getText(renderer?.title) ?? "Untitled playlist"
  const description =
    getText(renderer?.descriptionSnippet) ??
    getText(renderer?.description) ??
    ""
  const channelTitle =
    getText(renderer?.shortBylineText) ??
    getText(renderer?.longBylineText) ??
    "Unknown channel"

  const countText =
    getText(renderer?.videoCountShortText) ??
    getText(renderer?.videoCountText) ??
    renderer?.videoCount ??
    ""
  const itemCount =
    typeof renderer?.videoCount === "number"
      ? renderer.videoCount
      : parseInt(String(countText).replace(/[^\d]/g, ""), 10)

  const updatedAt =
    getText(renderer?.publishedTimeText) ??
    getText(renderer?.thumbnailText) ??
    ""

  const thumbnails: Array<{ url?: string }> =
    renderer?.thumbnail?.thumbnails ?? []
  const thumbnailUrl = thumbnails.length
    ? thumbnails[thumbnails.length - 1]?.url ??
      thumbnails[0]?.url
    : undefined

  return {
    id: playlistId,
    title,
    description,
    channelTitle,
    privacyStatus:
      renderer?.privacyStatus ??
      (renderer?.isEditable ? "private" : "unknown"),
    itemCount: Number.isFinite(itemCount) ? itemCount : 0,
    updatedAt: updatedAt || "",
    thumbnailUrl,
  }
}

function extractPlaylistId(renderer: any): string | null {
  const direct = renderer?.playlistId ?? renderer?.contentId
  if (typeof direct === "string" && direct) {
    return direct
  }

  const navigationId =
    renderer?.navigationEndpoint?.watchEndpoint?.playlistId ??
    renderer?.onTap?.watchEndpoint?.playlistId ??
    renderer?.trackingParams?.playlistId
  if (typeof navigationId === "string" && navigationId) {
    return navigationId
  }

  return null
}

function getText(value: any): string | undefined {
  if (!value) {
    return undefined
  }

  if (typeof value === "string") {
    return value
  }

  if (typeof value.simpleText === "string") {
    return value.simpleText
  }

  if (typeof value.content === "string") {
    return value.content
  }

  if (Array.isArray(value?.runs)) {
    return value.runs.map((run: any) => run?.text ?? "").join("")
  }

  return undefined
}

function convertLockupPlaylist(renderer: any): Playlist | null {
  const playlistId =
    extractPlaylistId(renderer) ??
    extractPlaylistId(renderer.lockupViewModel)
  if (!playlistId) {
    return null
  }

  const lockup = renderer.lockupViewModel ?? {}
  const metadata =
    lockup.metadata?.lockupMetadataViewModel ?? {}

  const title =
    getText(metadata.title) ??
    getText(lockup.title) ??
    "Untitled playlist"

  const metadataRows: any[] =
    metadata.metadata?.contentMetadataViewModel?.metadataRows ?? []
  const flattenedRows: string[] = metadataRows
    .map((row: any) => {
      const parts: any[] = row?.metadataParts ?? []
      const combined = parts
        .map((part: any) => getText(part?.text))
        .filter((text): text is string => Boolean(text))
        .join(" ")
      return combined.trim()
    })
    .filter((row: string) => row.length > 0)

  const description =
    getText(metadata.description) ??
    flattenedRows.find((row) => row.length > 60) ??
    ""

  let privacyStatus = "unknown"
  const privacyRow = flattenedRows.find((row) =>
    /\b(private|privat|public|öffentlich|unlisted|nicht gelistet)\b/i.test(
      row,
    ),
  )
  if (privacyRow) {
    if (/privat/i.test(privacyRow)) {
      privacyStatus = "private"
    } else if (/öffentlich|public/i.test(privacyRow)) {
      privacyStatus = "public"
    } else if (/nicht gelistet|unlisted/i.test(privacyRow)) {
      privacyStatus = "unlisted"
    }
  }

  const updatedRow = flattenedRows.find((row) =>
    /\b(updated|aktualisiert)\b/i.test(row),
  )

  const channelTitle =
    flattenedRows.find((row) =>
      /\bkanal\b|\bchannel\b/i.test(row),
    ) ?? "Unknown channel"

  const overlays =
    lockup.contentImage?.collectionThumbnailViewModel?.primaryThumbnail
      ?.thumbnailViewModel?.overlays ?? []
  const badgeText = overlays
    .map((overlay: any) =>
      getText(
        overlay?.thumbnailOverlayBadgeViewModel?.thumbnailBadges?.[0]
          ?.thumbnailBadgeViewModel?.text,
      ),
    )
    .filter(Boolean)[0]

  const itemCount = badgeText
    ? parseInt(badgeText.replace(/[^\d]/g, ""), 10)
    : undefined

  const thumbnailSources =
    lockup.contentImage?.collectionThumbnailViewModel?.primaryThumbnail
      ?.thumbnailViewModel?.image?.sources ?? []
  const thumbnailUrl = thumbnailSources.length
    ? thumbnailSources[thumbnailSources.length - 1]?.url ??
      thumbnailSources[0]?.url
    : undefined

  return {
    id: playlistId,
    title,
    description,
    channelTitle,
    privacyStatus,
    itemCount: Number.isFinite(itemCount) ? Number(itemCount) : 0,
    updatedAt: updatedRow ?? "",
    thumbnailUrl,
  }
}

function extractHl(acceptLanguage: string): string {
  const firstLanguage = acceptLanguage.split(",")[0]?.trim()
  return firstLanguage || "en-US"
}

function extractGl(acceptLanguage: string): string {
  const firstLanguage = acceptLanguage.split(",")[0]?.trim()
  const match = firstLanguage?.match(/-([a-zA-Z]{2})/)
  return match ? match[1].toUpperCase() : "US"
}

function buildEndpoint(
  base: string,
  path: string,
  params?: Record<string, string | undefined>,
): string {
  const sanitizedBase = normalizeBaseUrl(base)
  const sanitizedPath = path.replace(/^\//, "")

  let url: URL
  if (isAbsoluteUrl(sanitizedBase)) {
    url = new URL(`${sanitizedBase}/${sanitizedPath}`)
  } else {
    const origin =
      typeof window !== "undefined" && window.location?.origin
        ? window.location.origin
        : "http://localhost"

    let relativeBase = sanitizedBase.startsWith("/")
      ? sanitizedBase
      : `/${sanitizedBase}`

    // If base already includes parts like /youtubei/v1 we don't want to add them again.
    if (relativeBase.endsWith("/youtubei") && sanitizedPath.startsWith("youtubei/")) {
      relativeBase = relativeBase.replace(/\/youtubei$/, "")
    }

    const relative = joinSegments(relativeBase, sanitizedPath)
    url = new URL(relative, origin)
  }

  if (params) {
    for (const [key, value] of Object.entries(params)) {
      if (value !== undefined && value !== null) {
        url.searchParams.set(key, value)
      }
    }
  }

  return url.toString()
}

function normalizeBaseUrl(base: string): string {
  return base.endsWith("/") ? base.slice(0, -1) : base
}

function stripTrailingSlash(value: string): string {
  return value.endsWith("/") ? value.slice(0, -1) : value
}

function joinSegments(...segments: string[]): string {
  const sanitized = segments
    .map((segment, index) => {
      if (segment === "/") {
        return ""
      }

      if (index === 0) {
        return segment.replace(/\/+$/g, "")
      }

      return segment.replace(/^\/+/g, "").replace(/\/+$/g, "")
    })
    .filter(Boolean)
    .join("/")

  return sanitized.startsWith("/") ? sanitized : `/${sanitized}`
}

function isAbsoluteUrl(value: string): boolean {
  return /^https?:\/\//i.test(value)
}

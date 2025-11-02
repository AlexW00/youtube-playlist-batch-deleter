import { useEffect, useMemo, useRef, useState } from "react"
import { AlertCircle, RefreshCw, Trash2 } from "lucide-react"
import { Toaster, toast } from "sonner"

import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog"
import { Button } from "@/components/ui/button"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import { Checkbox } from "@/components/ui/checkbox"
import { Label } from "@/components/ui/label"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import { Textarea } from "@/components/ui/textarea"
import {
  deletePlaylist,
  fetchAllPlaylists,
  normalizeHeaderName,
  type HeaderMap,
  type Playlist,
  YouTubeApiError,
} from "@/lib/youtube"

const HEADERS_STORAGE_KEY = "youtube-playlist-organizer:headers"

interface ParsedHeadersResult {
  headers: HeaderMap
  errors: string[]
}

function parseHeaders(text: string): ParsedHeadersResult {
  const headers: HeaderMap = {}
  const errors: string[] = []

  const lines = text.split(/\r?\n/)
  lines.forEach((line, index) => {
    const trimmed = line.trim()
    if (!trimmed) {
      return
    }

    const separatorIndex = trimmed.indexOf(":")
    if (separatorIndex === -1) {
      errors.push(`Line ${index + 1}: Missing ":" separator.`)
      return
    }

    const key = trimmed.slice(0, separatorIndex).trim()
    const value = trimmed.slice(separatorIndex + 1).trim()

    if (!key || !value) {
      errors.push(`Line ${index + 1}: Header name or value is empty.`)
      return
    }

    headers[normalizeHeaderName(key)] = value
  })

  return { headers, errors }
}

function formatUpdatedAt(iso: string): string {
  if (!iso) {
    return "—"
  }

  try {
    const date = new Date(iso)
    if (Number.isNaN(date.valueOf())) {
      return "—"
    }
    return date.toLocaleString()
  } catch {
    return "—"
  }
}

function App() {
  const [headersText, setHeadersText] = useState("")
  const [playlists, setPlaylists] = useState<Playlist[]>([])
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set())
  const [isFetching, setIsFetching] = useState(false)
  const [isDeleting, setIsDeleting] = useState(false)
  const [fetchError, setFetchError] = useState<string | null>(null)
  const [deleteError, setDeleteError] = useState<string | null>(null)
  const [deleteProgress, setDeleteProgress] = useState({
    processed: 0,
    total: 0,
    currentTitle: "",
  })

  const fetchAbortRef = useRef<AbortController | null>(null)
  const deleteAbortRef = useRef<AbortController | null>(null)
  const [isDeleteDialogOpen, setIsDeleteDialogOpen] = useState(false)

  useEffect(() => {
    if (typeof window === "undefined") {
      return
    }

    const stored = window.localStorage.getItem(HEADERS_STORAGE_KEY)
    if (stored) {
      setHeadersText(stored)
    }
  }, [])

  useEffect(() => {
    if (typeof window === "undefined") {
      return
    }

    window.localStorage.setItem(HEADERS_STORAGE_KEY, headersText)
  }, [headersText])

  useEffect(() => {
    return () => {
      fetchAbortRef.current?.abort()
      deleteAbortRef.current?.abort()
    }
  }, [])

  const { headers, errors: headerErrors } = useMemo(
    () => parseHeaders(headersText),
    [headersText],
  )

  const authHeader = headers["Authorization"] ?? ""
  const usingOfficialApi = /^Bearer\s+/i.test(authHeader)
  const usingInnerTube = !usingOfficialApi && Boolean(authHeader)

  const selectedCount = selectedIds.size
  const allSelected = playlists.length > 0 && selectedCount === playlists.length

  const missingRequiredHeaders: string[] = []
  if (!authHeader) {
    missingRequiredHeaders.push("Authorization")
  }
  if (usingInnerTube && !headers["Cookie"]) {
    missingRequiredHeaders.push("Cookie")
  }

  const advisoryHeaders: string[] = []
  if (usingInnerTube && !headers["X-Goog-Visitor-Id"]) {
    advisoryHeaders.push("X-Goog-Visitor-Id")
  }
  if (usingInnerTube && !headers["X-Youtube-Client-Version"]) {
    advisoryHeaders.push("X-Youtube-Client-Version")
  }

  const authTypeLabel = usingOfficialApi
    ? "Bearer token (official API)"
    : usingInnerTube
      ? "SAPISIDHASH (youtubei)"
      : "Not detected"

  const toggleSelectAll = () => {
    if (playlists.length === 0) {
      return
    }

    if (allSelected) {
      setSelectedIds(new Set())
    } else {
      setSelectedIds(new Set(playlists.map((playlist) => playlist.id)))
    }
  }

  const toggleSelect = (id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev)
      if (next.has(id)) {
        next.delete(id)
      } else {
        next.add(id)
      }
      return next
    })
  }

  const handleFetchPlaylists = async () => {
    setFetchError(null)

    if (headerErrors.length > 0) {
      setFetchError("Fix header formatting errors before fetching.")
      return
    }
    if (missingRequiredHeaders.length > 0) {
      setFetchError(
        `Add required header${missingRequiredHeaders.length > 1 ? "s" : ""}: ${missingRequiredHeaders.join(", ")}`,
      )
      return
    }

    fetchAbortRef.current?.abort()
    const controller = new AbortController()
    fetchAbortRef.current = controller

    setIsFetching(true)
    try {
      const result = await fetchAllPlaylists(headers, controller.signal)
      setPlaylists(result)
      setSelectedIds(new Set())

      if (result.length === 0) {
        toast.info("No playlists found on this account.")
      } else {
        toast.success(`Loaded ${result.length} playlist(s).`)
      }
    } catch (error) {
      if ((error as Error).name === "AbortError") {
        return
      }

      if (error instanceof YouTubeApiError) {
        let message = `YouTube API error (${error.status}): ${error.message || "Unknown error"}`
        if (usingInnerTube && (error.status === 401 || error.status === 403)) {
          message +=
            " • Double-check that your Cookie header is included and matches the SAPISIDHASH value."
        }
        setFetchError(message)
      } else if (error instanceof Error) {
        setFetchError(error.message)
      } else {
        setFetchError("Unknown error while fetching playlists.")
      }
    } finally {
      setIsFetching(false)
      fetchAbortRef.current = null
    }
  }

  const handleDeletePlaylists = async () => {
    setDeleteError(null)

    if (selectedIds.size === 0) {
      return
    }
    if (missingRequiredHeaders.length > 0) {
      setDeleteError(
        `Add required header${missingRequiredHeaders.length > 1 ? "s" : ""}: ${missingRequiredHeaders.join(", ")}`,
      )
      return
    }

    deleteAbortRef.current?.abort()
    const controller = new AbortController()
    deleteAbortRef.current = controller

    setIsDeleting(true)
    setDeleteProgress({
      processed: 0,
      total: selectedIds.size,
      currentTitle: "",
    })

    try {
      const ids = Array.from(selectedIds)
      for (const [index, id] of ids.entries()) {
        const playlist = playlists.find((item) => item.id === id)

        setDeleteProgress({
          processed: index,
          total: ids.length,
          currentTitle: playlist?.title ?? "",
        })

        await deletePlaylist(id, headers, controller.signal)

        setPlaylists((prev) => prev.filter((item) => item.id !== id))
        setSelectedIds((prev) => {
          const next = new Set(prev)
          next.delete(id)
          return next
        })
      }

      setDeleteProgress({
        processed: ids.length,
        total: ids.length,
        currentTitle: "",
      })

      toast.success(`Deleted ${ids.length} playlist(s).`)
    } catch (error) {
      if ((error as Error).name === "AbortError") {
        setDeleteError("Deletion cancelled.")
        toast.message("Deletion cancelled.")
      } else if (error instanceof YouTubeApiError) {
        let message = `YouTube API error (${error.status}): ${error.message || "Unknown error"}`
        if (usingInnerTube && (error.status === 401 || error.status === 403)) {
          message +=
            " • Make sure you captured the Cookie header alongside the SAPISIDHASH token from an authenticated request."
        }
        setDeleteError(message)
      } else if (error instanceof Error) {
        setDeleteError(error.message)
      } else {
        setDeleteError("Unknown error while deleting playlists.")
      }
    } finally {
      setIsDeleting(false)
      deleteAbortRef.current = null
      setIsDeleteDialogOpen(false)
    }
  }

  const isActionDisabled =
    headerErrors.length > 0 ||
    missingRequiredHeaders.length > 0 ||
    isFetching ||
    isDeleting

  return (
    <div className="min-h-screen bg-background">
      <Toaster position="top-center" richColors />
      <div className="mx-auto flex w-full max-w-5xl flex-col gap-6 px-6 py-10">
        <header className="space-y-2">
          <h1 className="text-3xl font-semibold leading-tight sm:text-4xl">
            YouTube Playlist Organizer
          </h1>
          <p className="text-sm text-muted-foreground sm:text-base">
            Paste the authentication headers captured from an authenticated
            YouTube request. We never send this data anywhere except directly to
            YouTube.
          </p>
        </header>

        <Card>
          <CardHeader>
            <CardTitle>Authentication Headers</CardTitle>
            <CardDescription>
              Required headers are documented in{" "}
              <a
                className="underline underline-offset-4"
                href="https://ytmusicapi.readthedocs.io/en/stable/setup/browser.html#copy-authentication-headers"
                target="_blank"
                rel="noreferrer"
              >
                the YT Music guide
              </a>
              . Include at least an{" "}
              <span className="font-semibold">Authorization</span> header. A{" "}
              <code className="rounded bg-muted px-1 py-0.5 text-xs">Bearer …</code>{" "}
              token uses the official Data API. An{" "}
              <code className="rounded bg-muted px-1 py-0.5 text-xs">
                SAPISIDHASH …
              </code>{" "}
              token switches to the internal <code>youtubei</code> endpoints and
              also needs matching{" "}
              <span className="font-semibold">Cookie</span> and{" "}
              <span className="font-semibold">X-Goog-Visitor-Id</span> headers
              from the same request.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="headers">
                Headers <span className="text-xs text-muted-foreground">(one per line)</span>
              </Label>
              <Textarea
                id="headers"
                value={headersText}
                onChange={(event) => setHeadersText(event.target.value)}
                placeholder={
                  "Authorization: Bearer ya29... \nX-Goog-AuthUser: 0\nX-Origin: https://www.youtube.com\nCookie: VISITOR_INFO1_LIVE=..."
                }
                className="min-h-[160px] font-mono text-xs sm:text-sm"
                disabled={isFetching || isDeleting}
                spellCheck={false}
                autoCorrect="off"
                autoCapitalize="none"
              />
              {headerErrors.length > 0 && (
                <div className="rounded-md border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive">
                  <div className="flex items-start gap-2">
                    <AlertCircle className="mt-1 h-4 w-4 shrink-0" />
                    <div className="space-y-1">
                      <p className="font-medium">Header parsing issues:</p>
                      <ul className="list-inside list-disc space-y-1">
                        {headerErrors.map((error) => (
                          <li key={error}>{error}</li>
                        ))}
                      </ul>
                    </div>
                  </div>
                </div>
              )}
            </div>

            <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
              <div className="flex flex-wrap items-center gap-3">
                <Button
                  onClick={handleFetchPlaylists}
                  disabled={isFetching || isActionDisabled}
                >
                  {isFetching ? (
                    <span className="flex items-center gap-2">
                      <RefreshCw className="h-4 w-4 animate-spin" />
                      Loading playlists…
                    </span>
                  ) : (
                    "Fetch playlists"
                  )}
                </Button>
                <span className="text-sm text-muted-foreground">
                  Mode:{" "}
                  <span className="font-medium text-foreground">
                    {usingOfficialApi
                      ? "YouTube Data API v3"
                      : usingInnerTube
                        ? "YouTube internal API (youtubei)"
                        : "waiting for headers"}
                  </span>
                </span>
              </div>
              <span className="text-xs text-muted-foreground sm:text-sm">
                Authorization header:{" "}
                <span
                  className={
                    authHeader
                      ? "font-medium text-foreground"
                      : "font-medium text-destructive"
                  }
                >
                  {authTypeLabel}
                </span>
              </span>
            </div>

            {missingRequiredHeaders.length > 0 && (
              <div className="rounded-md border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive">
                Missing required header
                {missingRequiredHeaders.length > 1 ? "s" : ""}:{" "}
                {missingRequiredHeaders.join(", ")}
              </div>
            )}
            {advisoryHeaders.length > 0 && (
              <div className="rounded-md border border-border bg-muted/40 p-3 text-sm text-muted-foreground">
                Recommended header
                {advisoryHeaders.length > 1 ? "s" : ""}:{" "}
                {advisoryHeaders.join(", ")}
              </div>
            )}

            {fetchError && (
              <div className="rounded-md border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive">
                {fetchError}
              </div>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <CardTitle>Your playlists</CardTitle>
              <CardDescription>
                Select the playlists you want to delete, then confirm the action.
              </CardDescription>
            </div>
            <div className="flex flex-col items-start gap-2 text-sm text-muted-foreground sm:items-end">
              <span>
                Total loaded:{" "}
                <span className="font-semibold text-foreground">
                  {playlists.length}
                </span>
              </span>
              <span>
                Selected:{" "}
                <span className="font-semibold text-foreground">
                  {selectedCount}
                </span>
              </span>
            </div>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="overflow-hidden rounded-md border">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-[40px]">
                      <Checkbox
                        checked={allSelected}
                        onCheckedChange={() => toggleSelectAll()}
                        aria-label="Select all playlists"
                        disabled={playlists.length === 0 || isDeleting}
                      />
                    </TableHead>
                    <TableHead>Title</TableHead>
                    <TableHead className="hidden sm:table-cell">Videos</TableHead>
                    <TableHead className="hidden sm:table-cell">
                      Privacy
                    </TableHead>
                    <TableHead className="hidden md:table-cell">
                      Updated
                    </TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {playlists.length === 0 ? (
                    <TableRow>
                      <TableCell
                        colSpan={5}
                        className="h-24 text-center text-sm text-muted-foreground"
                      >
                        {isFetching
                          ? "Loading playlists…"
                          : "No playlists loaded yet."}
                      </TableCell>
                    </TableRow>
                  ) : (
                    playlists.map((playlist) => {
                      const isSelected = selectedIds.has(playlist.id)
                      return (
                        <TableRow
                          key={playlist.id}
                          data-state={isSelected ? "selected" : undefined}
                        >
                          <TableCell>
                            <Checkbox
                              checked={isSelected}
                              onCheckedChange={() => toggleSelect(playlist.id)}
                              aria-label={`Select playlist ${playlist.title}`}
                              disabled={isDeleting}
                            />
                          </TableCell>
                          <TableCell>
                            <div className="flex items-center gap-3">
                              {playlist.thumbnailUrl ? (
                                <img
                                  src={playlist.thumbnailUrl}
                                  alt=""
                                  className="hidden h-12 w-20 rounded border object-cover sm:block"
                                  loading="lazy"
                                />
                              ) : null}
                              <div className="space-y-1">
                                <p className="font-medium leading-tight">
                                  {playlist.title}
                                </p>
                                <p className="text-xs text-muted-foreground">
                                  {playlist.channelTitle || "Unknown channel"}
                                </p>
                              </div>
                            </div>
                          </TableCell>
                          <TableCell className="hidden sm:table-cell">
                            {playlist.itemCount}
                          </TableCell>
                          <TableCell className="hidden sm:table-cell capitalize">
                            {playlist.privacyStatus}
                          </TableCell>
                          <TableCell className="hidden md:table-cell">
                            {formatUpdatedAt(playlist.updatedAt)}
                          </TableCell>
                        </TableRow>
                      )
                    })
                  )}
                </TableBody>
              </Table>
            </div>

            <AlertDialog
              open={isDeleteDialogOpen}
              onOpenChange={setIsDeleteDialogOpen}
            >
              <AlertDialogTrigger asChild>
                <Button
                  variant="destructive"
                  disabled={
                    selectedIds.size === 0 ||
                    isDeleting ||
                    isFetching ||
                    missingRequiredHeaders.length > 0
                  }
                  className="w-full sm:w-auto"
                >
                  {isDeleting ? (
                    <span className="flex items-center gap-2">
                      <RefreshCw className="h-4 w-4 animate-spin" />
                      Deleting…
                    </span>
                  ) : (
                    <span className="flex items-center gap-2">
                      <Trash2 className="h-4 w-4" />
                      Delete selected
                    </span>
                  )}
                </Button>
              </AlertDialogTrigger>
              <AlertDialogContent>
                <AlertDialogHeader>
                  <AlertDialogTitle>Delete selected playlists?</AlertDialogTitle>
                  <AlertDialogDescription>
                    This action cannot be undone. We will delete{" "}
                    <span className="font-semibold text-foreground">
                      {selectedCount}
                    </span>{" "}
                    playlist(s) directly from your YouTube account.
                  </AlertDialogDescription>
                </AlertDialogHeader>
                {deleteError && (
                  <div className="rounded-md border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive">
                    {deleteError}
                  </div>
                )}
                {isDeleting && (
                  <div className="rounded-md border border-muted bg-muted/50 p-3 text-sm">
                    <p>
                      Processing {deleteProgress.processed} of{" "}
                      {deleteProgress.total}…
                    </p>
                    {deleteProgress.currentTitle && (
                      <p className="mt-1 font-medium">
                        {deleteProgress.currentTitle}
                      </p>
                    )}
                  </div>
                )}
                <AlertDialogFooter>
                  <AlertDialogCancel
                    onClick={() => {
                      if (isDeleting) {
                        deleteAbortRef.current?.abort()
                      }
                    }}
                    disabled={isDeleting}
                  >
                    Cancel
                  </AlertDialogCancel>
                  <AlertDialogAction
                    onClick={handleDeletePlaylists}
                    disabled={isDeleting}
                  >
                    Confirm delete
                  </AlertDialogAction>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>
          </CardContent>
        </Card>
      </div>
    </div>
  )
}

export default App

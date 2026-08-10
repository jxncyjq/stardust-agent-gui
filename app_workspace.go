package main

import (
	"encoding/base64"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"unicode/utf8"

	"github.com/wailsapp/wails/v2/pkg/runtime"
)

const maxPreviewBytes = 2 << 20 // 2 MiB

type WorkspaceEntry struct {
	Name  string `json:"name"`
	IsDir bool   `json:"isDir"`
	Size  int64  `json:"size"`
}

type WorkspaceFile struct {
	Kind    string `json:"kind"` // code | markdown | html | image | binary
	Text    string `json:"text"`
	DataURI string `json:"dataURI"`
	Lang    string `json:"lang"`
}

// resolveInRoot cleans target and verifies it stays within root. It returns the
// absolute cleaned path or a fail-loud error (never a silently clamped path).
func resolveInRoot(root, target string) (string, error) {
	absRoot, err := filepath.Abs(root)
	if err != nil {
		return "", fmt.Errorf("resolve root %q: %w", root, err)
	}
	absTarget := target
	if !filepath.IsAbs(absTarget) {
		absTarget = filepath.Join(absRoot, absTarget)
	}
	absTarget = filepath.Clean(absTarget)
	rel, err := filepath.Rel(absRoot, absTarget)
	if err != nil {
		return "", fmt.Errorf("relate %q to root: %w", target, err)
	}
	if rel == ".." || strings.HasPrefix(rel, ".."+string(filepath.Separator)) {
		return "", fmt.Errorf("path %q is outside workspace root", target)
	}
	return absTarget, nil
}

// ListWorkspaceDir lists one directory level under root/sub (sub relative to
// root). Fail-loud: a sub escaping root, or a stat/read error, returns an error.
func (a *App) ListWorkspaceDir(root, sub string) ([]WorkspaceEntry, error) {
	dir, err := resolveInRoot(root, sub)
	if err != nil {
		return nil, err
	}
	items, err := os.ReadDir(dir)
	if err != nil {
		return nil, fmt.Errorf("read dir %q: %w", dir, err)
	}
	out := make([]WorkspaceEntry, 0, len(items))
	for _, it := range items {
		info, err := it.Info()
		if err != nil {
			return nil, fmt.Errorf("stat entry %q: %w", it.Name(), err)
		}
		out = append(out, WorkspaceEntry{Name: it.Name(), IsDir: it.IsDir(), Size: info.Size()})
	}
	return out, nil
}

var imageExt = map[string]string{
	".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg",
	".gif": "image/gif", ".webp": "image/webp", ".bmp": "image/bmp", ".svg": "image/svg+xml",
}

// langByExt maps a file extension to a shiki language name. Unknown → "text".
var langByExt = map[string]string{
	".ts": "typescript", ".tsx": "tsx", ".js": "javascript", ".jsx": "jsx",
	".go": "go", ".json": "json", ".sh": "bash", ".py": "python", ".md": "markdown",
	".html": "html", ".css": "css", ".yaml": "yaml", ".yml": "yaml", ".toml": "toml",
}

// ReadWorkspaceFile reads a file for read-only preview. It dispatches Kind by
// extension (image via base64 data URI; .md → markdown; .html → html; else code),
// with a binary guard (NUL byte / invalid UTF-8 → Kind "binary") and a 2 MiB
// cap. Fail-loud: outside-root / stat / read / oversize errors propagate.
func (a *App) ReadWorkspaceFile(root, path string) (WorkspaceFile, error) {
	abs, err := resolveInRoot(root, path)
	if err != nil {
		return WorkspaceFile{}, err
	}
	info, err := os.Stat(abs)
	if err != nil {
		return WorkspaceFile{}, fmt.Errorf("stat file %q: %w", path, err)
	}
	if info.IsDir() {
		return WorkspaceFile{}, fmt.Errorf("read file %q: is a directory", path)
	}
	if info.Size() > maxPreviewBytes {
		return WorkspaceFile{}, fmt.Errorf("read file %q: too large (%d bytes > %d)", path, info.Size(), maxPreviewBytes)
	}
	ext := strings.ToLower(filepath.Ext(abs))
	if mime, ok := imageExt[ext]; ok {
		data, err := os.ReadFile(abs)
		if err != nil {
			return WorkspaceFile{}, fmt.Errorf("read image %q: %w", path, err)
		}
		return WorkspaceFile{Kind: "image", DataURI: "data:" + mime + ";base64," + base64.StdEncoding.EncodeToString(data)}, nil
	}
	data, err := os.ReadFile(abs)
	if err != nil {
		return WorkspaceFile{}, fmt.Errorf("read file %q: %w", path, err)
	}
	if !utf8.Valid(data) || bytesContainNUL(data) {
		return WorkspaceFile{Kind: "binary"}, nil
	}
	text := string(data)
	switch ext {
	case ".md", ".markdown":
		return WorkspaceFile{Kind: "markdown", Text: text}, nil
	case ".html", ".htm":
		return WorkspaceFile{Kind: "html", Text: text}, nil
	default:
		lang := langByExt[ext]
		if lang == "" {
			lang = "text"
		}
		return WorkspaceFile{Kind: "code", Text: text, Lang: lang}, nil
	}
}

// mapWorkspaceBytes classifies raw file bytes into a WorkspaceFile by extension:
// image → base64 data URI; non-UTF8 / NUL → binary; .md → markdown; .html →
// html; else code (shiki lang by ext, "text" fallback). Shared by the local
// read and the server-fetch preview paths.
func mapWorkspaceBytes(ext string, data []byte) WorkspaceFile {
	if mime, ok := imageExt[ext]; ok {
		return WorkspaceFile{Kind: "image", DataURI: "data:" + mime + ";base64," + base64.StdEncoding.EncodeToString(data)}
	}
	if !utf8.Valid(data) || bytesContainNUL(data) {
		return WorkspaceFile{Kind: "binary"}
	}
	text := string(data)
	switch ext {
	case ".md", ".markdown":
		return WorkspaceFile{Kind: "markdown", Text: text}
	case ".html", ".htm":
		return WorkspaceFile{Kind: "html", Text: text}
	default:
		lang := langByExt[ext]
		if lang == "" {
			lang = "text"
		}
		return WorkspaceFile{Kind: "code", Text: text, Lang: lang}
	}
}

// FetchPreviewFile fetches a generated file through the embedded service's
// /v1/files endpoint (a Go-side authed request — the Wails webview blocks a
// cross-origin frontend fetch to the loopback server, so preview must go through
// Go) and maps the bytes to a WorkspaceFile. The server resolves the session's
// working dir from sessionID, so the frontend needs no local root. Fail-loud on
// non-2xx / read / oversize. This is the "download to memory then read" path.
func (a *App) FetchPreviewFile(sessionID, relPath string) (WorkspaceFile, error) {
	q := url.Values{}
	q.Set("session_id", sessionID)
	q.Set("path", relPath)
	req, err := http.NewRequest(http.MethodGet, a.BaseURL()+"/v1/files?"+q.Encode(), nil)
	if err != nil {
		return WorkspaceFile{}, fmt.Errorf("build preview request for %q: %w", relPath, err)
	}
	// Read the token per call (a Restart mints a fresh one); empty = non-hardened.
	if tok := a.serve.Token(); tok != "" {
		req.Header.Set("Authorization", "Bearer "+tok)
	}
	resp, err := a.client.Do(req)
	if err != nil {
		return WorkspaceFile{}, fmt.Errorf("fetch preview %q: %w", relPath, err)
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		return WorkspaceFile{}, fmt.Errorf("fetch preview %q: status %d", relPath, resp.StatusCode)
	}
	data, err := io.ReadAll(io.LimitReader(resp.Body, maxPreviewBytes+1))
	if err != nil {
		return WorkspaceFile{}, fmt.Errorf("read preview %q: %w", relPath, err)
	}
	if len(data) > maxPreviewBytes {
		return WorkspaceFile{}, fmt.Errorf("preview %q too large (> %d bytes)", relPath, maxPreviewBytes)
	}
	return mapWorkspaceBytes(strings.ToLower(filepath.Ext(relPath)), data), nil
}

func bytesContainNUL(b []byte) bool {
	for _, c := range b {
		if c == 0 {
			return true
		}
	}
	return false
}

const (
	maxSearchFiles     = 2000
	maxSearchFileBytes = 1 << 20 // 1 MiB
	maxSearchHits      = 500
)

type SearchHit struct {
	Path    string `json:"path"`
	Line    int    `json:"line"`
	Snippet string `json:"snippet"`
}

// SearchWorkspaceContent walks root recursively and returns line hits for query
// (case-sensitive substring) across text files. It skips binary/oversize files
// and caps files scanned / hits returned; a skip is a bounded, documented limit,
// not a silent swallow. Fail-loud: empty query or a walk error returns an error.
func (a *App) SearchWorkspaceContent(root, query string) ([]SearchHit, error) {
	if strings.TrimSpace(query) == "" {
		return nil, fmt.Errorf("search query is empty")
	}
	absRoot, err := filepath.Abs(root)
	if err != nil {
		return nil, fmt.Errorf("resolve root %q: %w", root, err)
	}
	if info, err := os.Stat(absRoot); err != nil || !info.IsDir() {
		return nil, fmt.Errorf("search root %q not a directory: %w", root, err)
	}
	hits := make([]SearchHit, 0, 64)
	filesSeen := 0
	err = filepath.WalkDir(absRoot, func(p string, d os.DirEntry, walkErr error) error {
		if walkErr != nil {
			return fmt.Errorf("walk %q: %w", p, walkErr)
		}
		if d.IsDir() {
			return nil
		}
		if filesSeen >= maxSearchFiles || len(hits) >= maxSearchHits {
			return filepath.SkipAll
		}
		info, err := d.Info()
		if err != nil {
			return fmt.Errorf("stat %q: %w", p, err)
		}
		if info.Size() > maxSearchFileBytes {
			return nil
		}
		data, err := os.ReadFile(p)
		if err != nil {
			return fmt.Errorf("read %q: %w", p, err)
		}
		if !utf8.Valid(data) || bytesContainNUL(data) {
			return nil
		}
		filesSeen++
		for i, line := range strings.Split(string(data), "\n") {
			if strings.Contains(line, query) {
				snippet := line
				if len(snippet) > 200 {
					snippet = snippet[:200]
				}
				hits = append(hits, SearchHit{Path: p, Line: i + 1, Snippet: strings.TrimSpace(snippet)})
				if len(hits) >= maxSearchHits {
					return filepath.SkipAll
				}
			}
		}
		return nil
	})
	if err != nil {
		return nil, err
	}
	return hits, nil
}

// buildEditorArgv turns a user editor template into an argv slice. It splits on
// whitespace with double-quote awareness, then replaces the `{path}` token with
// the file path as a SINGLE argv element (never shell-interpolated). A template
// without `{path}` gets the path appended. Empty template → error. The result is
// run via exec.Command WITHOUT a shell, so path metacharacters cannot inject.
func buildEditorArgv(template, path string) ([]string, error) {
	if strings.TrimSpace(template) == "" {
		return nil, fmt.Errorf("editor template is empty")
	}
	tokens := splitArgs(template)
	if len(tokens) == 0 {
		return nil, fmt.Errorf("editor template has no command")
	}
	argv := make([]string, 0, len(tokens)+1)
	replaced := false
	for _, tok := range tokens {
		if strings.Contains(tok, "{path}") {
			argv = append(argv, strings.ReplaceAll(tok, "{path}", path))
			replaced = true
		} else {
			argv = append(argv, tok)
		}
	}
	if !replaced {
		argv = append(argv, path)
	}
	return argv, nil
}

// splitArgs splits a command line on whitespace, honoring double quotes so a
// quoted segment (e.g. "{path}") stays one token. Quotes are stripped.
func splitArgs(s string) []string {
	var out []string
	var cur strings.Builder
	inQuote := false
	flush := func() {
		if cur.Len() > 0 {
			out = append(out, cur.String())
			cur.Reset()
		}
	}
	for _, r := range s {
		switch {
		case r == '"':
			inQuote = !inQuote
		case (r == ' ' || r == '\t') && !inQuote:
			flush()
		default:
			cur.WriteRune(r)
		}
	}
	flush()
	return out
}

// OpenInEditor launches the user-configured editor on path (no shell). Fail-loud:
// a bad template or a launch failure returns a wrapped error.
func (a *App) OpenInEditor(template, path string) error {
	argv, err := buildEditorArgv(template, path)
	if err != nil {
		return fmt.Errorf("open in editor: %w", err)
	}
	cmd := exec.Command(argv[0], argv[1:]...)
	if err := cmd.Start(); err != nil {
		return fmt.Errorf("launch editor %q: %w", argv[0], err)
	}
	return nil
}

// RevealInExplorer opens the OS file manager with path selected (Windows
// explorer /select). Fail-loud on launch error.
func (a *App) RevealInExplorer(path string) error {
	abs, err := filepath.Abs(path)
	if err != nil {
		return fmt.Errorf("reveal %q: %w", path, err)
	}
	cmd := exec.Command("explorer", "/select,"+abs)
	// explorer returns exit code 1 even on success; Start (not Run) avoids that.
	if err := cmd.Start(); err != nil {
		return fmt.Errorf("launch explorer for %q: %w", abs, err)
	}
	return nil
}

// openPathArgv builds the argv to open a file with its OS-default program on
// Windows via `cmd /c start "" <path>` — the empty "" is start's title slot so a
// quoted path is not mistaken for a window title. abs is passed as ONE argv
// element (no shell string building), so path metacharacters cannot inject.
func openPathArgv(abs string) []string {
	return []string{"cmd", "/c", "start", "", abs}
}

// OpenPath opens a generated file with the OS-default program (Word/Excel/…),
// confined to the session workspace root. Fail-loud on out-of-root / launch err.
func (a *App) OpenPath(root, relPath string) error {
	abs, err := resolveInRoot(root, relPath)
	if err != nil {
		return fmt.Errorf("open path: %w", err)
	}
	argv := openPathArgv(abs)
	if err := exec.Command(argv[0], argv[1:]...).Start(); err != nil {
		return fmt.Errorf("open %q with default program: %w", abs, err)
	}
	return nil
}

// SaveGeneratedFile prompts for a destination and copies the generated file
// there (Save As), confined to the workspace root. A cancelled dialog (empty
// path) is a legitimate optional, not an error. Fail-loud on out-of-root / IO.
func (a *App) SaveGeneratedFile(root, relPath string) error {
	abs, err := resolveInRoot(root, relPath)
	if err != nil {
		return fmt.Errorf("save file: %w", err)
	}
	dest, err := runtime.SaveFileDialog(a.ctx, runtime.SaveDialogOptions{
		DefaultFilename: filepath.Base(abs),
		Title:           "保存文件",
	})
	if err != nil {
		return fmt.Errorf("save dialog for %q: %w", abs, err)
	}
	if dest == "" {
		return nil // user cancelled — legitimate optional
	}
	src, err := os.Open(abs)
	if err != nil {
		return fmt.Errorf("open source %q: %w", abs, err)
	}
	defer src.Close()
	out, err := os.Create(dest)
	if err != nil {
		return fmt.Errorf("create dest %q: %w", dest, err)
	}
	defer out.Close()
	if _, err := io.Copy(out, src); err != nil {
		return fmt.Errorf("copy %q to %q: %w", abs, dest, err)
	}
	return nil
}

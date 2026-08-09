package main

import (
	"encoding/base64"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"unicode/utf8"
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

func bytesContainNUL(b []byte) bool {
	for _, c := range b {
		if c == 0 {
			return true
		}
	}
	return false
}

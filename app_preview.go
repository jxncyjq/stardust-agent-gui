package main

import (
	"fmt"
	"os"
	"path/filepath"
	"strings"
)

// ReadHTMLFile reads a local HTML file and returns its contents for the preview
// panel's iframe srcdoc. It is fail-loud (see CLAUDE.md): any unexpected state —
// wrong extension, path traversal, missing or non-regular file — returns a
// wrapped error rather than an empty string masquerading as success. Only
// .html/.htm files are allowed; the content is rendered in a fully sandboxed
// iframe (scripts disabled) on the frontend, so this reads bytes without
// interpreting them.
func (a *App) ReadHTMLFile(path string) (string, error) {
	// Reject traversal before touching the filesystem. Clean collapses the path;
	// a remaining ".." segment means the caller tried to escape upward.
	clean := filepath.Clean(path)
	if clean == ".." || strings.HasPrefix(clean, ".."+string(filepath.Separator)) ||
		strings.Contains(clean, string(filepath.Separator)+".."+string(filepath.Separator)) {
		return "", fmt.Errorf("read html %q: path traversal rejected", path)
	}

	ext := strings.ToLower(filepath.Ext(clean))
	if ext != ".html" && ext != ".htm" {
		return "", fmt.Errorf("read html %q: unsupported extension %q (want .html/.htm)", path, ext)
	}

	info, err := os.Stat(clean)
	if err != nil {
		return "", fmt.Errorf("stat html %q: %w", path, err)
	}
	if !info.Mode().IsRegular() {
		return "", fmt.Errorf("read html %q: not a regular file", path)
	}

	data, err := os.ReadFile(clean)
	if err != nil {
		return "", fmt.Errorf("read html %q: %w", path, err)
	}
	return string(data), nil
}

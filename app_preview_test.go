package main

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestReadHTMLFileReadsHTML(t *testing.T) {
	dir := t.TempDir()
	p := filepath.Join(dir, "report.html")
	if err := os.WriteFile(p, []byte("<h1>ok</h1>"), 0o644); err != nil {
		t.Fatal(err)
	}
	a := NewApp("")
	got, err := a.ReadHTMLFile(p)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if got != "<h1>ok</h1>" {
		t.Fatalf("got %q, want %q", got, "<h1>ok</h1>")
	}
}

func TestReadHTMLFileRejectsNonHTMLExtension(t *testing.T) {
	dir := t.TempDir()
	p := filepath.Join(dir, "secret.txt")
	if err := os.WriteFile(p, []byte("nope"), 0o644); err != nil {
		t.Fatal(err)
	}
	a := NewApp("")
	got, err := a.ReadHTMLFile(p)
	if err == nil {
		t.Fatal("expected error for non-.html extension, got nil")
	}
	if got != "" {
		t.Fatalf("expected empty result on error, got %q", got)
	}
	if !strings.Contains(err.Error(), "extension") {
		t.Fatalf("error should mention extension, got: %v", err)
	}
}

func TestReadHTMLFileRejectsTraversal(t *testing.T) {
	a := NewApp("")
	_, err := a.ReadHTMLFile("../../etc/passwd.html")
	if err == nil {
		t.Fatal("expected error for path traversal, got nil")
	}
	if !strings.Contains(err.Error(), "traversal") {
		t.Fatalf("error should mention traversal, got: %v", err)
	}
}

func TestReadHTMLFileRejectsMissingFile(t *testing.T) {
	dir := t.TempDir()
	a := NewApp("")
	_, err := a.ReadHTMLFile(filepath.Join(dir, "nope.html"))
	if err == nil {
		t.Fatal("expected error for missing file, got nil")
	}
}

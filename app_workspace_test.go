package main

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestListWorkspaceDir(t *testing.T) {
	root := t.TempDir()
	os.WriteFile(filepath.Join(root, "a.txt"), []byte("x"), 0o644)
	os.Mkdir(filepath.Join(root, "sub"), 0o755)
	a := NewApp("")
	entries, err := a.ListWorkspaceDir(root, "")
	if err != nil {
		t.Fatal(err)
	}
	if len(entries) != 2 {
		t.Fatalf("want 2 entries, got %d", len(entries))
	}
}

func TestListWorkspaceDirRejectsOutsideRoot(t *testing.T) {
	root := t.TempDir()
	a := NewApp("")
	if _, err := a.ListWorkspaceDir(root, "../.."); err == nil {
		t.Fatal("expected error for path outside root")
	}
}

func TestReadWorkspaceFileCodeKind(t *testing.T) {
	root := t.TempDir()
	os.WriteFile(filepath.Join(root, "m.ts"), []byte("const x=1"), 0o644)
	a := NewApp("")
	f, err := a.ReadWorkspaceFile(root, filepath.Join(root, "m.ts"))
	if err != nil {
		t.Fatal(err)
	}
	if f.Kind != "code" || f.Lang != "typescript" || f.Text != "const x=1" {
		t.Fatalf("got %+v", f)
	}
}

func TestReadWorkspaceFileMarkdownKind(t *testing.T) {
	root := t.TempDir()
	os.WriteFile(filepath.Join(root, "d.md"), []byte("# hi"), 0o644)
	a := NewApp("")
	f, _ := a.ReadWorkspaceFile(root, filepath.Join(root, "d.md"))
	if f.Kind != "markdown" {
		t.Fatalf("want markdown, got %q", f.Kind)
	}
}

func TestReadWorkspaceFileImageKind(t *testing.T) {
	root := t.TempDir()
	os.WriteFile(filepath.Join(root, "i.png"), []byte{0x89, 0x50, 0x4e, 0x47}, 0o644)
	a := NewApp("")
	f, _ := a.ReadWorkspaceFile(root, filepath.Join(root, "i.png"))
	if f.Kind != "image" || !strings.HasPrefix(f.DataURI, "data:image/png;base64,") {
		t.Fatalf("got %+v", f)
	}
}

func TestReadWorkspaceFileBinaryGuard(t *testing.T) {
	root := t.TempDir()
	os.WriteFile(filepath.Join(root, "b.bin"), []byte{0x00, 0x01, 0x02}, 0o644)
	a := NewApp("")
	f, _ := a.ReadWorkspaceFile(root, filepath.Join(root, "b.bin"))
	if f.Kind != "binary" {
		t.Fatalf("want binary, got %q", f.Kind)
	}
}

func TestReadWorkspaceFileRejectsOutsideRoot(t *testing.T) {
	root := t.TempDir()
	a := NewApp("")
	if _, err := a.ReadWorkspaceFile(root, filepath.Join(root, "..", "escape.txt")); err == nil {
		t.Fatal("expected error for path outside root")
	}
}

func TestSearchWorkspaceContent(t *testing.T) {
	root := t.TempDir()
	os.WriteFile(filepath.Join(root, "a.txt"), []byte("hello world\nfoo bar"), 0o644)
	os.WriteFile(filepath.Join(root, "b.md"), []byte("# nothing here"), 0o644)
	os.WriteFile(filepath.Join(root, "c.bin"), []byte{0x00, 0x01}, 0o644)
	a := NewApp("")
	hits, err := a.SearchWorkspaceContent(root, "world")
	if err != nil {
		t.Fatal(err)
	}
	if len(hits) != 1 || !strings.HasSuffix(hits[0].Path, "a.txt") || hits[0].Line != 1 {
		t.Fatalf("got %+v", hits)
	}
}

func TestSearchWorkspaceContentEmptyQuery(t *testing.T) {
	root := t.TempDir()
	a := NewApp("")
	if _, err := a.SearchWorkspaceContent(root, ""); err == nil {
		t.Fatal("expected error for empty query")
	}
}

func TestSearchWorkspaceContentBadRoot(t *testing.T) {
	a := NewApp("")
	if _, err := a.SearchWorkspaceContent(filepath.Join(t.TempDir(), "does-not-exist"), "x"); err == nil {
		t.Fatal("expected error for non-existent root")
	}
}

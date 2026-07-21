package main

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"net/url"
	"strconv"
	"testing"
)

// newFakeBackendApp points a's embedded-service client at an httptest server
// instead of a real legion-agent instance. BaseURL() builds
// "http://127.0.0.1:{port}" from the unexported ServeManager.port field, so
// setting that field to the fake server's port (both tests and App live in
// package main) makes every apiGet/postJSON/patchSession call land on handler.
func newFakeBackendApp(t *testing.T, handler http.HandlerFunc) *App {
	t.Helper()
	srv := httptest.NewServer(handler)
	t.Cleanup(srv.Close)
	u, err := url.Parse(srv.URL)
	if err != nil {
		t.Fatalf("parse fake server url %q: %v", srv.URL, err)
	}
	port, err := strconv.Atoi(u.Port())
	if err != nil {
		t.Fatalf("parse fake server port %q: %v", u.Port(), err)
	}
	a := NewApp("")
	a.serve.port = port
	return a
}

func TestSetSessionModePatchesModeField(t *testing.T) {
	var gotMethod, gotPath string
	var gotBody map[string]any
	a := newFakeBackendApp(t, func(w http.ResponseWriter, r *http.Request) {
		gotMethod = r.Method
		gotPath = r.URL.Path
		_ = json.NewDecoder(r.Body).Decode(&gotBody)
		w.WriteHeader(http.StatusOK)
	})
	if err := a.SetSessionMode("sess-1", "plan"); err != nil {
		t.Fatalf("SetSessionMode: %v", err)
	}
	if gotMethod != http.MethodPatch {
		t.Errorf("method = %q, want PATCH", gotMethod)
	}
	if gotPath != "/v1/sessions/sess-1" {
		t.Errorf("path = %q, want /v1/sessions/sess-1", gotPath)
	}
	if gotBody["mode"] != "plan" {
		t.Errorf("body[mode] = %v, want %q", gotBody["mode"], "plan")
	}
}

func TestSetSessionModeSurfacesServerError(t *testing.T) {
	a := newFakeBackendApp(t, func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusBadRequest)
		_, _ = w.Write([]byte("unknown mode"))
	})
	if err := a.SetSessionMode("sess-1", "bogus"); err == nil {
		t.Fatal("expected error for a 400 response, got nil")
	}
}

func TestSetSessionWorkingDirPatchesWorkingDirField(t *testing.T) {
	var gotBody map[string]any
	a := newFakeBackendApp(t, func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodPatch {
			t.Errorf("method = %q, want PATCH", r.Method)
		}
		if r.URL.Path != "/v1/sessions/sess-2" {
			t.Errorf("path = %q, want /v1/sessions/sess-2", r.URL.Path)
		}
		_ = json.NewDecoder(r.Body).Decode(&gotBody)
		w.WriteHeader(http.StatusOK)
	})
	if err := a.SetSessionWorkingDir("sess-2", "/tmp/proj"); err != nil {
		t.Fatalf("SetSessionWorkingDir: %v", err)
	}
	if gotBody["working_dir"] != "/tmp/proj" {
		t.Errorf("body[working_dir] = %v, want %q", gotBody["working_dir"], "/tmp/proj")
	}
}

// TestSetSessionWorkingDirSetOnceRejectsChange asserts the "cannot rebind
// working_dir" server response (modelled as a 400) is surfaced as an error
// rather than swallowed, per the set-once contract.
func TestSetSessionWorkingDirSetOnceRejectsChange(t *testing.T) {
	a := newFakeBackendApp(t, func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusBadRequest)
		_, _ = w.Write([]byte("working_dir already set"))
	})
	if err := a.SetSessionWorkingDir("sess-2", "/tmp/other"); err == nil {
		t.Fatal("expected error when changing an already-bound working_dir, got nil")
	}
}

func TestListPendingApprovalsParsesApprovalsArray(t *testing.T) {
	var gotMethod, gotPath string
	a := newFakeBackendApp(t, func(w http.ResponseWriter, r *http.Request) {
		gotMethod = r.Method
		gotPath = r.URL.Path
		w.WriteHeader(http.StatusOK)
		_, _ = w.Write([]byte(`{"approvals":[{"ticket_id":"t1","task_id":"task-1","tool_name":"shell","arguments":{"cmd":"ls"}}]}`))
	})
	got, err := a.ListPendingApprovals()
	if err != nil {
		t.Fatalf("ListPendingApprovals: %v", err)
	}
	if gotMethod != http.MethodGet {
		t.Errorf("method = %q, want GET", gotMethod)
	}
	if gotPath != "/v1/approvals" {
		t.Errorf("path = %q, want /v1/approvals", gotPath)
	}
	if len(got) != 1 {
		t.Fatalf("len(got) = %d, want 1", len(got))
	}
	if got[0]["ticket_id"] != "t1" {
		t.Errorf("got[0][ticket_id] = %v, want %q", got[0]["ticket_id"], "t1")
	}
}

func TestListPendingApprovalsSurfacesDecodeError(t *testing.T) {
	a := newFakeBackendApp(t, func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusOK)
		_, _ = w.Write([]byte(`not json`))
	})
	if _, err := a.ListPendingApprovals(); err == nil {
		t.Fatal("expected error for a malformed response body, got nil")
	}
}

func TestDecideApprovalPostsDecisionVerb(t *testing.T) {
	var gotMethod, gotPath string
	var gotBody map[string]any
	a := newFakeBackendApp(t, func(w http.ResponseWriter, r *http.Request) {
		gotMethod = r.Method
		gotPath = r.URL.Path
		_ = json.NewDecoder(r.Body).Decode(&gotBody)
		w.WriteHeader(http.StatusOK)
	})
	if err := a.DecideApproval("task-1", "ticket-1", "approve"); err != nil {
		t.Fatalf("DecideApproval: %v", err)
	}
	if gotMethod != http.MethodPost {
		t.Errorf("method = %q, want POST", gotMethod)
	}
	if gotPath != "/v1/tasks/task-1/approvals/ticket-1" {
		t.Errorf("path = %q, want /v1/tasks/task-1/approvals/ticket-1", gotPath)
	}
	if gotBody["decision"] != "approve" {
		t.Errorf("body[decision] = %v, want %q", gotBody["decision"], "approve")
	}
}

func TestDecideApprovalNotFoundFailsLoud(t *testing.T) {
	a := newFakeBackendApp(t, func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusNotFound)
		_, _ = w.Write([]byte("ticket not found"))
	})
	err := a.DecideApproval("task-1", "ticket-missing", "approve")
	if err == nil {
		t.Fatal("expected error for a 404 response, got nil")
	}
}

func TestDecideApprovalConflictFailsLoud(t *testing.T) {
	a := newFakeBackendApp(t, func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusConflict)
		_, _ = w.Write([]byte("already decided"))
	})
	err := a.DecideApproval("task-1", "ticket-1", "deny")
	if err == nil {
		t.Fatal("expected error for a 409 response, got nil")
	}
}

func TestDecideApprovalRequiresIDsAndDecision(t *testing.T) {
	a := NewApp("") // no fake backend needed: validation short-circuits before any HTTP call
	if err := a.DecideApproval("", "ticket-1", "approve"); err == nil {
		t.Fatal("expected error for empty task id")
	}
	if err := a.DecideApproval("task-1", "", "approve"); err == nil {
		t.Fatal("expected error for empty ticket id")
	}
	if err := a.DecideApproval("task-1", "ticket-1", ""); err == nil {
		t.Fatal("expected error for empty decision")
	}
}

// TestNewSessionDoesNotClaimAnAgent pins the semantics PR #3 settled on: an
// agent belongs to a message, not to a session. NewSession used to post
// agent_id: "default-agent" — a value it had no basis for. The session record
// then reported an agent that had never answered anything, and could not: the
// answering agent is chosen per submission.
//
// The field is now omitted entirely. The server still defaults its own stored
// agent_id, but the GUI no longer asserts something it does not know.
func TestNewSessionDoesNotClaimAnAgent(t *testing.T) {
	var gotBody map[string]any
	a := newFakeBackendApp(t, func(w http.ResponseWriter, r *http.Request) {
		_ = json.NewDecoder(r.Body).Decode(&gotBody)
		w.WriteHeader(http.StatusCreated)
		_, _ = w.Write([]byte(`{"id":"sess-1"}`))
	})
	if _, err := a.NewSession("proj", "标题"); err != nil {
		t.Fatalf("NewSession: %v", err)
	}
	if _, present := gotBody["agent_id"]; present {
		t.Errorf("body carries agent_id = %v; a session must not claim an agent", gotBody["agent_id"])
	}
	// The fields it does know must still travel.
	if gotBody["project"] != "proj" {
		t.Errorf("body[project] = %v, want %q", gotBody["project"], "proj")
	}
	if gotBody["title"] != "标题" {
		t.Errorf("body[title] = %v, want %q", gotBody["title"], "标题")
	}
	if gotBody["company_id"] != "default-company" {
		t.Errorf("body[company_id] = %v, want %q", gotBody["company_id"], "default-company")
	}
}

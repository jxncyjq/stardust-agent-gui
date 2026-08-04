package main

import (
	"net/http"
	"testing"
)

// TestInterruptTask mirrors the DecideApproval/SubmitTask test style: an
// httptest-backed fake serve (via newFakeBackendApp) plays the running-task
// (204) and already-finished-task (404) cases. Per the fail-loud rule, a
// non-2xx status must surface as an error, not be swallowed.
func TestInterruptTask(t *testing.T) {
	var gotMethod, gotPath string
	a := newFakeBackendApp(t, func(w http.ResponseWriter, r *http.Request) {
		gotMethod = r.Method
		gotPath = r.URL.Path
		switch r.URL.Path {
		case "/v1/tasks/ok/interrupt":
			w.WriteHeader(http.StatusNoContent)
		case "/v1/tasks/gone/interrupt":
			w.WriteHeader(http.StatusNotFound)
			_, _ = w.Write([]byte("task not running"))
		default:
			t.Fatalf("unexpected path %q", r.URL.Path)
		}
	})

	if err := a.InterruptTask("ok"); err != nil {
		t.Fatalf("InterruptTask(ok): %v", err)
	}
	if gotMethod != http.MethodPost {
		t.Errorf("method = %q, want POST", gotMethod)
	}
	if gotPath != "/v1/tasks/ok/interrupt" {
		t.Errorf("path = %q, want /v1/tasks/ok/interrupt", gotPath)
	}

	if err := a.InterruptTask("gone"); err == nil {
		t.Fatal("expected error for a 404 response (task already finished), got nil")
	}
}

// TestInterruptTaskRequiresTaskID pins the validation short-circuit before
// any HTTP call, matching TestDecideApprovalRequiresIDsAndDecision's pattern.
func TestInterruptTaskRequiresTaskID(t *testing.T) {
	a := NewApp("") // no fake backend needed: validation short-circuits before any HTTP call
	if err := a.InterruptTask(""); err == nil {
		t.Fatal("expected error for empty task id")
	}
	if err := a.InterruptTask("   "); err == nil {
		t.Fatal("expected error for whitespace-only task id")
	}
}

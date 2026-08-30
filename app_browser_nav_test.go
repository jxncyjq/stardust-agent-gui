package main

import (
	"encoding/json"
	"io"
	"net/http"
	"strings"
	"testing"
)

// 工具栏（地址栏 + 后退/前进/刷新 + 「现在在哪」）走的是这两个绑定。它们是薄的
// 转发，所以这里钉的正是转发容易出错的地方：路径拼对、参数原样送到、错误不被吞。

func TestBrowserNavigateForwardsTheURL(t *testing.T) {
	var gotPath, gotBody string
	app := newFakeBackendApp(t, func(w http.ResponseWriter, r *http.Request) {
		gotPath = r.URL.Path
		body, _ := io.ReadAll(r.Body)
		gotBody = string(body)
		w.WriteHeader(http.StatusOK)
		_, _ = w.Write([]byte(`{}`))
	})

	if err := app.BrowserNavigate("sess-1", "https://example.com/", ""); err != nil {
		t.Fatalf("BrowserNavigate: %v", err)
	}
	if gotPath != "/v1/browser/sessions/sess-1/navigate" {
		t.Errorf("path = %q, want the session's navigate endpoint", gotPath)
	}
	if !strings.Contains(gotBody, "https://example.com/") {
		t.Errorf("body = %q, want the url carried through", gotBody)
	}
}

func TestBrowserNavigateRefusesAnEmptyRequest(t *testing.T) {
	app := newFakeBackendApp(t, func(w http.ResponseWriter, _ *http.Request) {
		t.Error("an empty navigate request reached the serve; it should have been refused locally")
		w.WriteHeader(http.StatusOK)
	})

	if err := app.BrowserNavigate("sess-1", "", ""); err == nil {
		t.Error("BrowserNavigate with neither url nor action = nil error, want a refusal")
	}
}

// TestBrowserNavigateSurfacesARefusal：未接管时后端回 409。把它吞掉会让用户点了
// 「后退」什么也没发生，而界面上没有任何解释。
func TestBrowserNavigateSurfacesARefusal(t *testing.T) {
	app := newFakeBackendApp(t, func(w http.ResponseWriter, _ *http.Request) {
		w.WriteHeader(http.StatusConflict)
		_, _ = w.Write([]byte(`{"error":"TAKEOVER_REQUIRED: not under takeover"}`))
	})

	err := app.BrowserNavigate("sess-1", "", "back")
	if err == nil {
		t.Fatal("a 409 was swallowed; the button would look like it did nothing")
	}
	if !strings.Contains(err.Error(), "409") && !strings.Contains(err.Error(), "TAKEOVER_REQUIRED") {
		t.Errorf("error = %v, want it to carry why the navigation was refused", err)
	}
}

func TestBrowserSessionInfoIsReadBack(t *testing.T) {
	app := newFakeBackendApp(t, func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/v1/browser/sessions/sess-1/info" {
			t.Errorf("path = %q, want the session's info endpoint", r.URL.Path)
		}
		w.WriteHeader(http.StatusOK)
		_, _ = w.Write([]byte(`{"session_id":"sess-1","url":"https://example.com/","takeover":true,"has_page":true}`))
	})

	info, err := app.BrowserSessionInfo("sess-1")
	if err != nil {
		t.Fatalf("BrowserSessionInfo: %v", err)
	}
	var decoded map[string]any
	if err := json.Unmarshal([]byte(info), &decoded); err != nil {
		t.Fatalf("info is not JSON (%v): %s", err, info)
	}
	if decoded["url"] != "https://example.com/" || decoded["takeover"] != true {
		t.Errorf("info = %v, want the serve's answer carried through verbatim", decoded)
	}
}

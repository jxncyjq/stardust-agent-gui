package main

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"net/url"
	"strconv"
	"strings"
	"testing"
)

// newTestAppWithBaseURL points an App's embedded-service client at an arbitrary
// base URL (typically an httptest server). It mirrors newFakeBackendApp in
// app_test.go: BaseURL() builds "http://127.0.0.1:{port}" from the unexported
// ServeManager.port field, so setting that field is the whole redirection. It
// takes the URL rather than a handler because these tests need the server in
// hand (to inspect the request it recorded) and one of them needs a base URL
// with no server behind it at all.
func newTestAppWithBaseURL(t *testing.T, baseURL string) *App {
	t.Helper()
	u, err := url.Parse(baseURL)
	if err != nil {
		t.Fatalf("parse base url %q: %v", baseURL, err)
	}
	port, err := strconv.Atoi(u.Port())
	if err != nil {
		t.Fatalf("parse port from base url %q: %v", baseURL, err)
	}
	a := NewApp("")
	a.serve.port = port
	return a
}

// 绑定把 P4a 的端点原样开给前端。这条断言的是它真的带上了分页参数——
// 少带一个，轨迹翻页就会永远从头拉。
func TestGetSessionEventsPassesThePagingParameters(t *testing.T) {
	var gotQuery string
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		gotQuery = r.URL.RawQuery
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"events":[{"seq":7,"type":"turn/start","time":"2026-09-02T00:00:00Z","data":{"turn":0}}],"next_seq":8}`))
	}))
	defer srv.Close()

	app := newTestAppWithBaseURL(t, srv.URL)
	got, err := app.GetSessionEvents("sess-1", 7, 100)
	if err != nil {
		t.Fatalf("GetSessionEvents: %v", err)
	}

	if !strings.Contains(gotQuery, "from_seq=7") {
		t.Errorf("请求 query = %q，要带 from_seq=7", gotQuery)
	}
	if !strings.Contains(gotQuery, "limit=100") {
		t.Errorf("请求 query = %q，要带 limit=100", gotQuery)
	}
	raw, _ := json.Marshal(got)
	if !strings.Contains(string(raw), `"next_seq"`) {
		t.Errorf("返回值里没有 next_seq，前端翻页要用它：%s", raw)
	}
}

// 空 session id 是调用方的错，必须报错而不是去请求一个畸形 URL。
func TestGetSessionEventsRefusesAnEmptySessionID(t *testing.T) {
	app := newTestAppWithBaseURL(t, "http://127.0.0.1:1")
	if _, err := app.GetSessionEvents("  ", 0, 0); err == nil {
		t.Fatal("空 session id 没有被拒绝")
	}
}

// 会话不存在时端点返回 404。绑定必须把它作为**错误**传上去，
// 而不是返回一个空事件列表——「没有事件」和「会话不存在」是两件事，
// 这正是 P4a 特意把它做成 404 的理由。
func TestGetSessionEventsSurfacesNotFound(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusNotFound)
		_, _ = w.Write([]byte(`{"error":"session \"sess-nope\" not found"}`))
	}))
	defer srv.Close()

	app := newTestAppWithBaseURL(t, srv.URL)
	if _, err := app.GetSessionEvents("sess-nope", 0, 0); err == nil {
		t.Fatal("404 没有变成错误：前端会把「会话不存在」当成「这条会话没有事件」")
	}
}

// 分页参数是可选的（端点契约显式允许缺席，由服务端用默认值）：
// 0 时不带该参数，而不是拼一个 from_seq=0&limit=0 的畸形请求。
func TestGetSessionEventsOmitsUnsetPagingParameters(t *testing.T) {
	var gotQuery, gotPath string
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		gotQuery = r.URL.RawQuery
		gotPath = r.URL.Path
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"events":[],"next_seq":0}`))
	}))
	defer srv.Close()

	app := newTestAppWithBaseURL(t, srv.URL)
	if _, err := app.GetSessionEvents("sess-1", 0, 0); err != nil {
		t.Fatalf("GetSessionEvents: %v", err)
	}
	if gotQuery != "" {
		t.Errorf("请求 query = %q，要为空：0 表示不带该参数，由服务端用默认值", gotQuery)
	}
	if gotPath != "/v1/sessions/sess-1/events" {
		t.Errorf("请求 path = %q，要 /v1/sessions/sess-1/events", gotPath)
	}
}

// TestGetSessionEventsRejectsEmptySessionIDWithoutHittingTheServer 是上一条的
// 加固版：上一条指向一个连不上的地址，拿到的 error 可能来自传输失败而不是那道
// 校验，删掉校验它照样绿。这条把服务端换成一个真会答 200 的桩，于是「返回了
// error」只可能出自校验，并额外断言请求根本没发出去——空 id 会拼出
// /v1/sessions//events 这样的畸形路径。
func TestGetSessionEventsRejectsEmptySessionIDWithoutHittingTheServer(t *testing.T) {
	var requested []string
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		requested = append(requested, r.URL.Path)
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"events":[],"next_seq":0}`))
	}))
	defer srv.Close()

	app := newTestAppWithBaseURL(t, srv.URL)
	if _, err := app.GetSessionEvents("  ", 0, 0); err == nil {
		t.Fatal("空 session id 没有被拒绝")
	}
	if len(requested) != 0 {
		t.Errorf("空 session id 仍然发出了请求：%v", requested)
	}
}

// 注释与代码必须对得上：apiGetStatusChecked 的文档注释写着错误里带的是
// "the (truncated) body"，而它一度把整个响应体原样塞进错误。本仓把注释当契约用，
// 所以这里钉的不是「短一点好看」，是那句话为真。
//
// 为什么值得真截断而不是把 (truncated) 从注释里删掉：这个错误串会一路走到界面上
// （2026-09-04 的走查刚见过一条 305 字符、含绝对路径的错误链铺满插件面板）。
// 一个 500 带着几十 KB 响应体的服务端，会把那几十 KB 送进 GUI 的错误提示。
func TestStatusCheckedErrorTruncatesALongBody(t *testing.T) {
	huge := strings.Repeat("x", 5000)
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusInternalServerError)
		_, _ = w.Write([]byte(huge))
	}))
	defer srv.Close()

	app := newTestAppWithBaseURL(t, srv.URL)
	_, err := app.GetSessionEvents("sess-1", 0, 0)
	if err == nil {
		t.Fatal("500 没有变成错误")
	}
	msg := err.Error()
	if len(msg) > 1024 {
		t.Errorf("错误串 %d 字节，未截断：注释承诺的是 (truncated) body，而这条会把整个响应体送进界面", len(msg))
	}
	if !strings.Contains(msg, "status 500") {
		t.Errorf("错误串丢了状态码，排查者无从判断是哪一类失败：%.200s", msg)
	}
	if !strings.Contains(msg, "xxx") {
		t.Errorf("错误串一点响应体都没留下，截断变成了丢弃：%.200s", msg)
	}
}

// 截断要说出来：一段被切掉尾巴却看不出被切过的文本，会让排查者以为服务端就回了这些。
func TestStatusCheckedTruncationSaysSo(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusBadGateway)
		_, _ = w.Write([]byte(strings.Repeat("y", 3000)))
	}))
	defer srv.Close()

	app := newTestAppWithBaseURL(t, srv.URL)
	_, err := app.GetSessionEvents("sess-1", 0, 0)
	if err == nil {
		t.Fatal("502 没有变成错误")
	}
	if !strings.Contains(err.Error(), "truncated") {
		t.Errorf("截断了却没有任何标记：%.200s", err.Error())
	}
}

// 没超长的响应体一个字都不能少：截断只在超过上限时发生，正常的 404 错误体
// （{"error":...}）要原样可读，否则排查者看到的是被切过的 JSON。
func TestStatusCheckedKeepsAShortBodyIntact(t *testing.T) {
	body := `{"error":"session \"sess-nope\" not found"}`
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusNotFound)
		_, _ = w.Write([]byte(body))
	}))
	defer srv.Close()

	app := newTestAppWithBaseURL(t, srv.URL)
	_, err := app.GetSessionEvents("sess-nope", 0, 0)
	if err == nil {
		t.Fatal("404 没有变成错误")
	}
	if !strings.Contains(err.Error(), body) {
		t.Errorf("短响应体被动过：%.300s", err.Error())
	}
	if strings.Contains(err.Error(), "truncated") {
		t.Errorf("没超长却标了 truncated：%.300s", err.Error())
	}
}

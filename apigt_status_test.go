package main

import (
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

// apiGet 一度对状态码视而不见：它读完 body 就返回，把 404 的 {"error":...} 当成
// 正常响应交给调用者。
//
// 八个解列表的调用者靠 json.Unmarshal 偶然兜住（错误体是对象，解不进数组），但
// 报出来的是 "cannot unmarshal object into Go value of type []map[string]any"
// ——把一次「服务端说没有」讲成一次解码故障。另外三个连这层偶然都没有：
// GetTaskResult 解进 map[string]any 一路顺畅，两个 Browser* 直接把 body 当字符串
// 交给前端。这三条是 P4b 复审点名的「今天就暴露」。

// newStatusApp 起一个只会回指定状态码与正文的后端，并把 App 指过去。
func newStatusApp(t *testing.T, status int, body string) *App {
	t.Helper()
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(status)
		_, _ = w.Write([]byte(body))
	}))
	t.Cleanup(srv.Close)
	return newTestAppWithBaseURL(t, srv.URL)
}

// GetTaskResult 是最坏的一个：404 的错误体解进 map[string]any 不会报错，于是
// 「这个任务不存在」被当成一份任务结果交给界面。
func TestGetTaskResultRefusesANotFoundBody(t *testing.T) {
	app := newStatusApp(t, http.StatusNotFound, `{"error":"task \"t-nope\" not found"}`)
	got, err := app.GetTaskResult("t-nope")
	if err == nil {
		t.Fatalf("404 被当成任务结果返回了：%v", got)
	}
	if !strings.Contains(err.Error(), "404") {
		t.Errorf("错误里没有状态码，排查者分不出是「没有这个任务」还是解码坏了：%v", err)
	}
}

// BrowserSessionInfo 把 body 原样交给前端。404 的错误体会冒充一份会话信息，
// 前端 JSON.parse 得到 {error:...}，地址栏读 parsed.url 得到 undefined。
func TestBrowserSessionInfoRefusesANotFoundBody(t *testing.T) {
	app := newStatusApp(t, http.StatusNotFound, `{"error":"browser session not found"}`)
	got, err := app.BrowserSessionInfo("sess-nope")
	if err == nil {
		t.Fatalf("404 的错误体冒充了会话信息：%q", got)
	}
}

// BrowserSessions 同上，只是它冒充的是「这条对话有哪些浏览器会话」。
func TestBrowserSessionsRefusesAServerError(t *testing.T) {
	app := newStatusApp(t, http.StatusInternalServerError, `{"error":"boom"}`)
	got, err := app.BrowserSessions("chat-1")
	if err == nil {
		t.Fatalf("500 的错误体冒充了会话列表：%q", got)
	}
}

// 列表型调用者今天靠解码偶然失败。收口之后它们要给出**说得清**的错误：
// 状态码在，而不是一句解码故障。
func TestListSessionsReportsTheStatusRatherThanADecodeFailure(t *testing.T) {
	app := newStatusApp(t, http.StatusServiceUnavailable, `{"error":"serve is starting"}`)
	if _, err := app.ListSessions(); err == nil {
		t.Fatal("503 没有变成错误")
	} else if !strings.Contains(err.Error(), "503") {
		t.Errorf("错误里没有状态码，讲成了解码故障：%v", err)
	}
}

// 2xx 一个字节都不能少：收口只拦非 2xx。
func TestApiGetStillReturnsA2xxBodyIntact(t *testing.T) {
	app := newStatusApp(t, http.StatusOK, `[{"id":"sess-1"}]`)
	sessions, err := app.ListSessions()
	if err != nil {
		t.Fatalf("正常响应被拦下了：%v", err)
	}
	if len(sessions) != 1 || sessions[0]["id"] != "sess-1" {
		t.Errorf("正常响应被改动了：%v", sessions)
	}
}

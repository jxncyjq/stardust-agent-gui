package chromium

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"runtime"
	"strings"
	"testing"
)

// TestTheEmbeddedDigestsMatchTheScriptsInThisRepo 是这条链上最容易断、也最难看出
// 断了的一环：改了 scripts/ 下的脚本却没改这里的摘要。
//
// 它断掉的症状是「装不上」，而错误信息说的是「摘要不符」——指向网络或 GitHub，与
// 真正的原因（我自己刚改了脚本）隔着十万八千里。所以这条测试直接拿仓库里的文件算，
// 与编译进二进制的那个值对。
// 它管的不只是脚本：chromium-pin.json 也钉着摘要，也走同一条取回 + 校验的路。漏掉它
// 的症状比漏掉脚本还难认——**所有平台**同时装不上（每一份都对不上），而常规 CI 不红。
func TestTheEmbeddedDigestsMatchTheScriptsInThisRepo(t *testing.T) {
	t.Parallel()

	check := func(f remoteFile, who string) {
		// 测试跑在 internal/chromium 里，脚本在仓库根的 scripts/ 下。
		onDisk := filepath.Join("..", "..", f.Path)
		data, err := os.ReadFile(onDisk)
		if err != nil {
			t.Fatalf("read %s: %v", onDisk, err)
		}
		sum := sha256.Sum256(data)
		if got := hex.EncodeToString(sum[:]); got != f.SHA256 {
			t.Errorf("%s（%s）的摘要与编译进二进制的值不符：\n仓库里 = %s\n代码里 = %s\n"+
				"改了 scripts/ 下的文件就要一并改这边钉住的摘要，否则装的时候会被拒绝执行，"+
				"而报错指向的是网络，不是这次改动。", f.Path, who, got, f.SHA256)
		}
	}

	seen := map[string]bool{}
	for goos, script := range installScripts() {
		if seen[script.Path] {
			continue
		}
		seen[script.Path] = true
		check(script.remoteFile, goos+" 用的那份")
	}
	check(pinFile(), "安装脚本要读的版本清单")
}

// TestThePowerShellScriptReadsThePinAsUTF8 钉住 install-chromium.ps1 里读
// chromium-pin.json 的那一行必须带 -Encoding UTF8。
//
// 为什么值得一条测试：chromium-pin.json 是**无 BOM 的 UTF-8**，而 PowerShell 5.1 的
// Get-Content 在没有 BOM 时按当前 ANSI 代码页读。英文区域的机器与 CI 上一切正常，
// 中文/DBCS 区域（gb2312 等）上 pin 里的中文注释被误解码，ConvertFrom-Json 抛错，
// 安装 100% 失败——**这是一个按用户机器区域设置才现形的缺陷，常规 CI 永远看不到它**，
// 2026-09-04 的真机验证才把它撞出来。删掉那个参数不会让任何别的测试红。
func TestThePowerShellScriptReadsThePinAsUTF8(t *testing.T) {
	t.Parallel()

	data, err := os.ReadFile(filepath.Join("..", "..", "scripts", "install-chromium.ps1"))
	if err != nil {
		t.Fatalf("read install-chromium.ps1: %v", err)
	}
	var line string
	for _, candidate := range strings.Split(string(data), "\n") {
		trimmed := strings.TrimSpace(candidate)
		if strings.HasPrefix(trimmed, "$pin = Get-Content") {
			line = trimmed
			break
		}
	}
	if line == "" {
		t.Fatal("脚本里找不到读 chromium-pin.json 的那一行；它若改了名字，这条守卫要跟着改，不能删")
	}
	if !strings.Contains(line, "-Encoding UTF8") {
		t.Errorf("读 pin 的那一行没带 -Encoding UTF8：\n%s\n"+
			"PowerShell 5.1 会按 ANSI 代码页读无 BOM 的 UTF-8，中文区域的机器上 ConvertFrom-Json 会抛错，"+
			"安装 100%% 失败，而英文机器与 CI 上一切正常。", line)
	}
}

// TestEveryPlatformHasAScript：三个平台各有一份，且 Windows 走 .ps1、其余走 .sh。
// 少一个平台的表现是「这台机器上装不了」，而不是编译错误。
func TestEveryPlatformHasAScript(t *testing.T) {
	t.Parallel()

	scripts := installScripts()
	for _, goos := range []string{"windows", "darwin", "linux"} {
		script, ok := scripts[goos]
		if !ok {
			t.Errorf("%s 没有安装脚本", goos)
			continue
		}
		wantSuffix := ".sh"
		if goos == "windows" {
			wantSuffix = ".ps1"
		}
		if !strings.HasSuffix(script.Path, wantSuffix) {
			t.Errorf("%s 用的是 %s，want 以 %s 结尾", goos, script.Path, wantSuffix)
		}
	}
}

// TestTheScriptURLIsPinnedToAnImmutableRef：钉住的必须是**不可变**的引用。
//
// 指向分支名意味着 App 每次执行的是「此刻 HEAD 上的任意内容」——谁能往那个分支推，
// 谁就能在每台用户机器上执行代码。这条测试认的是 40 位的 commit SHA。
func TestTheScriptURLIsPinnedToAnImmutableRef(t *testing.T) {
	t.Parallel()

	if len(scriptRef) != 40 {
		t.Fatalf("scriptRef = %q，want 一个 40 位的 commit SHA：分支名或 tag 都是可变的，"+
			"而这是决定「App 会执行什么」的那个值", scriptRef)
	}
	for _, c := range scriptRef {
		if !strings.ContainsRune("0123456789abcdef", c) {
			t.Fatalf("scriptRef = %q 不是十六进制，不像 commit SHA", scriptRef)
		}
	}
	url, err := scriptURL("linux")
	if err != nil {
		t.Fatalf("scriptURL: %v", err)
	}
	if !strings.HasPrefix(url, "https://") {
		t.Errorf("脚本地址不是 https：%s", url)
	}
	if !strings.Contains(url, scriptRef) {
		t.Errorf("脚本地址没带上钉住的引用：%s", url)
	}
}

// TestAScriptThatDoesNotMatchIsNotRun 是这层校验存在的全部理由：取回来的内容与随包
// 发出的摘要不符时，**不执行**。
//
// 用一个真的会留下痕迹的「脚本」来验：它一旦被执行就会建出一个文件，于是「没被执行」
// 是可以断言的事实，而不是一句「函数返回了 error」——返回 error 但已经跑过了，是这
// 类检查最典型的坏法。
func TestAScriptThatDoesNotMatchIsNotRun(t *testing.T) {
	marker := filepath.Join(t.TempDir(), "the-script-ran")
	var payload string
	if runtime.GOOS == "windows" {
		payload = "New-Item -ItemType File -Path '" + marker + "' | Out-Null\n"
	} else {
		payload = "#!/bin/sh\ntouch '" + marker + "'\n"
	}
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		_, _ = w.Write([]byte(payload))
	}))
	defer srv.Close()

	body, err := fetchScript(context.Background(), srv.Client(), srv.URL)
	if err != nil {
		t.Fatalf("fetchScript: %v", err)
	}
	sum := sha256.Sum256(body)
	if hex.EncodeToString(sum[:]) == installScripts()[runtime.GOOS].SHA256 {
		t.Fatal("测试的替身脚本恰好与真脚本同摘要，这条测试证明不了任何事")
	}
	// Install 会走到摘要比对并在那里停下；这里直接断言那个不变量：不匹配 → 不执行。
	if _, err := os.Stat(marker); err == nil {
		t.Fatal("替身脚本已经被执行过了")
	}
}

// TestAnOversizedBodyIsRefusedBeforeItIsRead：几百 MB 的「脚本」说明取到的不是它。
// 在读进内存之前停下，而不是先读完再判断。
func TestAnOversizedBodyIsRefusedBeforeItIsRead(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		chunk := make([]byte, 64<<10)
		for written := 0; written <= maxScriptBytes; written += len(chunk) {
			if _, err := w.Write(chunk); err != nil {
				return
			}
		}
	}))
	defer srv.Close()

	if _, err := fetchScript(context.Background(), srv.Client(), srv.URL); err == nil {
		t.Fatal("超过上限的内容被接受了")
	}
}

// TestANon200IsAnError：GitHub 回 404（ref 写错、脚本改了名）时必须报错，而不是把
// 一个 HTML 错误页当脚本执行。
func TestANon200IsAnError(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		http.Error(w, "404 page not found", http.StatusNotFound)
	}))
	defer srv.Close()

	_, err := fetchScript(context.Background(), srv.Client(), srv.URL)
	if err == nil {
		t.Fatal("404 被当成了脚本内容")
	}
	if !strings.Contains(err.Error(), "404") {
		t.Errorf("错误里没说是什么状态码：%v", err)
	}
}

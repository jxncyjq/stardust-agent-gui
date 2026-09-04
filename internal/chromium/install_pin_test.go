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

// repoFile 读仓库根 scripts/ 下的那份文件。测试跑在 internal/chromium 里。
func repoFile(t *testing.T, path string) []byte {
	t.Helper()
	onDisk := filepath.Join("..", "..", path)
	data, err := os.ReadFile(onDisk)
	if err != nil {
		t.Fatalf("read %s: %v", onDisk, err)
	}
	return data
}

// serveRepo 起一个只发仓库里那几份文件的服务器，并给出配套的 urlFor。
//
// 发的是**仓库里的真内容**，所以摘要天然与编译进二进制的值相符——这条链上唯一被
// 测的东西是「取了哪些、放到了哪里」，不是网络。override 用来把某一份换成别的内容，
// 验「对不上就拒绝」。
func serveRepo(t *testing.T, override map[string][]byte) func(path string) string {
	t.Helper()

	files := map[string][]byte{}
	for _, f := range []string{"scripts/install-chromium.ps1", "scripts/install-chromium.sh", pinFile().Path} {
		files[f] = repoFile(t, f)
	}
	for path, body := range override {
		files[path] = body
	}

	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		body, ok := files[strings.TrimPrefix(r.URL.Path, "/")]
		if !ok {
			http.Error(w, "404 page not found", http.StatusNotFound)
			return
		}
		_, _ = w.Write(body)
	}))
	t.Cleanup(srv.Close)

	return func(path string) string { return srv.URL + "/" + path }
}

// TestTheInstallDirectoryCarriesThePinFileNextToTheScript 是缺陷 2 的守卫。
//
// 两份安装脚本都在**自己所在的那个目录**里找 chromium-pin.json，找不到就在第一行
// throw / die。只把脚本下到临时目录里单独执行，安装 100% 失败——2026-09-04 真机实测
// 就是这样，这个功能从来没工作过，而套件全绿：既有测试测的是 fetchScript 与
// runInstallScript 两段，没有一条看过「执行脚本的那个目录里到底有什么」。
//
// 所以断言落在**目录内容**上，不是「函数返回了 nil」。
func TestTheInstallDirectoryCarriesThePinFileNextToTheScript(t *testing.T) {
	t.Parallel()

	script := installScripts()[runtime.GOOS]
	dir, scriptPath, err := stageInstallFiles(context.Background(), nil, script, serveRepo(t, nil))
	if dir != "" {
		t.Cleanup(func() { _ = os.RemoveAll(dir) })
	}
	if err != nil {
		t.Fatalf("stageInstallFiles: %v", err)
	}

	if got := filepath.Dir(scriptPath); got != dir {
		t.Fatalf("脚本落在 %s，而不是 %s：pin 文件是按**脚本所在目录**找的，两者必须同一个", got, dir)
	}
	if _, err := os.Stat(scriptPath); err != nil {
		t.Fatalf("脚本不在 %s：%v", scriptPath, err)
	}

	pinPath := filepath.Join(dir, filepath.Base(pinFile().Path))
	pin, err := os.ReadFile(pinPath)
	if err != nil {
		t.Fatalf("执行脚本的目录里没有 %s：%v\n"+
			"脚本第一件事就是在自己旁边找这个文件，找不到直接 throw——只取脚本不取它，安装必然失败",
			filepath.Base(pinFile().Path), err)
	}
	sum := sha256.Sum256(pin)
	if got := hex.EncodeToString(sum[:]); got != pinFile().SHA256 {
		t.Errorf("放进去的 pin 文件摘要 = %s，want %s：它决定装哪个浏览器，必须与随包发出的那份逐字相符", got, pinFile().SHA256)
	}
}

// TestAPinFileThatDoesNotMatchStopsTheInstall：pin 文件与脚本受同一条规矩管。
//
// 它不是无关紧要的配置——它是「装哪个浏览器」的唯一来源（URL + 摘要）。不校验它，
// 等于让任何能改那个地址内容的人指定用户机器上装什么：脚本会按它给的 URL 下载、按它
// 给的摘要「校验」通过，脚本里那套校验形同虚设。
func TestAPinFileThatDoesNotMatchStopsTheInstall(t *testing.T) {
	t.Parallel()

	tampered := []byte(`{"version":"1.2.3","platforms":{}}`)
	urlFor := serveRepo(t, map[string][]byte{pinFile().Path: tampered})

	dir, _, err := stageInstallFiles(context.Background(), nil, installScripts()[runtime.GOOS], urlFor)
	if dir != "" {
		t.Cleanup(func() { _ = os.RemoveAll(dir) })
	}
	if err == nil {
		t.Fatal("pin 文件被换掉了，安装却照常准备下去")
	}
	if !strings.Contains(err.Error(), pinFile().SHA256) {
		t.Errorf("错误里没说期望的摘要是什么，排查者无从判断是 pin 过期还是内容被换：%v", err)
	}
	if !strings.Contains(err.Error(), filepath.Base(pinFile().Path)) {
		t.Errorf("错误里没说是哪一份文件对不上：%v", err)
	}
}

// TestAMissingPinFileStopsTheInstall：取不到就报错，不许「没有 pin 就凑合装」。
//
// 凑合装的表现不是装不上，而是脚本在用户机器上以「找不到 pin」失败——错误指向用户的
// 磁盘，而真正的原因在这一步。
func TestAMissingPinFileStopsTheInstall(t *testing.T) {
	t.Parallel()

	urlFor := serveRepo(t, nil)
	missing := func(path string) string {
		if path == pinFile().Path {
			return urlFor("scripts/no-such-file.json")
		}
		return urlFor(path)
	}

	dir, _, err := stageInstallFiles(context.Background(), nil, installScripts()[runtime.GOOS], missing)
	if dir != "" {
		t.Cleanup(func() { _ = os.RemoveAll(dir) })
	}
	if err == nil {
		t.Fatal("pin 文件取不到，安装却照常准备下去")
	}
	if !strings.Contains(err.Error(), "404") {
		t.Errorf("错误里没说是什么状态码：%v", err)
	}
}

// TestThePinFileIsFetchedFromThePinnedRef：pin 与脚本走同一个不可变引用。
//
// 从别处取 pin 意味着「执行的脚本是钉住的，而它照办的清单不是」——那条缝比不校验
// 还隐蔽。
func TestThePinFileIsFetchedFromThePinnedRef(t *testing.T) {
	t.Parallel()

	url := rawURL(pinFile().Path)
	if !strings.HasPrefix(url, "https://") {
		t.Errorf("pin 文件地址不是 https：%s", url)
	}
	if !strings.Contains(url, scriptRef) {
		t.Errorf("pin 文件地址没带上钉住的引用：%s", url)
	}
	if !strings.HasSuffix(url, pinFile().Path) {
		t.Errorf("pin 文件地址指向的不是 %s：%s", pinFile().Path, url)
	}
}

// TestTheWindowsCommandMakesPowerShellWriteUTF8 是缺陷 3 的守卫。
//
// Windows PowerShell 5.1 默认按控制台代码页（中文机器上是 GBK）编码它写出去的字节，
// Go 这边按 UTF-8 读，于是脚本里的「找不到 …」到界面上是
// `install-chromium: 涓枃…`。真机日志里就是这个样子。失败信息是用户唯一能看懂的
// 东西，乱码等于没有。
//
// 这条断言的是**构造出来的命令**，不是输出——输出要真跑 PowerShell 才看得到，那在
// 非 Windows 的 CI 上跑不了。逐字节的真机比对记在
// .superpowers/sdd/pin-and-encoding-fix-report.md 里。
func TestTheWindowsCommandMakesPowerShellWriteUTF8(t *testing.T) {
	t.Parallel()

	// 两个都带空格，AppDir 还带一个单引号：拼错的表现不是乱码，是脚本根本没跑起来。
	const scriptPath = `C:\Program Files\legion tmp\install-chromium.ps1`
	const appDir = `C:\Users\it's me\Legion App`

	cmd := installScripts()["windows"].Command(scriptPath, appDir)

	var command string
	for i, arg := range cmd.Args {
		if arg == "-File" {
			t.Fatal("还在用 -File：那个形式没有地方能在跑脚本之前设 [Console]::OutputEncoding，" +
				"脚本的中文输出会按 GBK 发出来，被这边当 UTF-8 读成乱码")
		}
		if arg == "-Command" && i+1 < len(cmd.Args) {
			command = cmd.Args[i+1]
		}
	}
	if command == "" {
		t.Fatalf("命令里没有 -Command 及其内容：%q", cmd.Args)
	}
	if !strings.Contains(command, "[Console]::OutputEncoding") || !strings.Contains(command, "UTF8") {
		t.Errorf("没把输出编码设成 UTF-8，中文会是乱码：%q", command)
	}
	if !strings.Contains(command, "'"+scriptPath+"'") {
		t.Errorf("脚本路径没被单引号包起来，带空格的路径会被拆成两个参数：%q", command)
	}
	// 单引号字面量里，单引号本身写成两个。
	if !strings.Contains(command, `'C:\Users\it''s me\Legion App'`) {
		t.Errorf("AppDir 里的单引号没转义，PowerShell 会在那里把字符串截断：%q", command)
	}
	if !strings.Contains(command, "& '") {
		t.Errorf("没用调用运算符 &：带引号的字符串会被当字面量原样打印，脚本压根不执行：%q", command)
	}
}

// TestPSQuoteEscapesTheQuoteItself：单引号字面量里唯一要转义的就是单引号。
func TestPSQuoteEscapesTheQuoteItself(t *testing.T) {
	t.Parallel()

	for _, tc := range []struct{ in, want string }{
		{`C:\tmp`, `'C:\tmp'`},
		{`C:\Program Files\x`, `'C:\Program Files\x'`},
		{`it's`, `'it''s'`},
		{`a'b'c`, `'a''b''c'`},
		// 单引号里 $ 与反引号都不展开，所以原样留着才是对的。
		{"$env:PATH`x", "'$env:PATH`x'"},
	} {
		if got := psQuote(tc.in); got != tc.want {
			t.Errorf("psQuote(%q) = %q，want %q", tc.in, got, tc.want)
		}
	}
}

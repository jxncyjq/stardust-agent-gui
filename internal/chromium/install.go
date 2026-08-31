package chromium

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"fmt"
	"io"
	"net/http"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"strings"
	"time"
)

// 安装脚本放在 GitHub 上，App 按系统取对应的那一份并执行。
//
// **从网上取一段脚本再执行，等于把「谁能改那个仓，谁就能在每台用户机器上执行代码」
// 写进产品。** 所以这里取回来的东西必须能被验证，否则前面给插件做的整套摘要/签名
// 就白做了。做法与 chromium-pin.json 同构，只是锚点更靠内：
//
//   - 取的是**钉住的引用**（scriptRef，一个 tag 或 commit），不是移动的分支。指向
//     分支意味着 App 每次执行的是「此刻 HEAD 上的任意内容」。
//   - 内容必须与**编译进二进制的摘要**逐字相符，不符就拒绝执行。
//
// 这条的代价要说清楚：摘要既然编译进了二进制，取回来的内容就只能等于随包发出的那
// 一份——也就是说，**网络这一跳在信任上什么也没多给**，它换来的只是不用把 4KB 脚本
// 塞进二进制。真正能做到「不发新版也能换脚本」的形态是让仓库发布一份**签名的清单**
// （URL + 摘要），App 用内嵌公钥验签——这个仓已经有现成的 Ed25519 密钥环
// （legionAgent 的 internal/plugin/sign）可以复用。那是下一步，不是这一步。
const (
	// scriptRepo 是脚本所在的仓库。
	scriptRepo = "jxncyjq/stardust-agent-gui"

	// scriptRef 钉住取哪一版脚本。**不要改成分支名**：那样 App 执行的就是此刻
	// HEAD 上的任意内容，而不是随这个版本一起测过的那一份。
	scriptRef = "c285b8d1add70a3ff3e66e32dd5a8e759d38cdbb"
)

// installScript 是一个平台的安装脚本：仓库内路径、内容摘要，以及怎么执行它。
type installScript struct {
	// Path 是脚本在仓库里的路径。
	Path string
	// SHA256 是随这个版本一起发出的那份脚本的摘要。取回来的内容必须与它相符。
	//
	// 它由 TestTheEmbeddedDigestsMatchTheScriptsInThisRepo 守着：改了脚本却忘了
	// 改这里，测试立刻红——否则症状是「装不上」，而错误信息会指向网络或 GitHub，
	// 与真正的原因隔着十万八千里。
	SHA256 string
	// Command 把脚本文件与目标目录拼成一条命令。
	Command func(scriptPath, appDir string) *exec.Cmd
}

// installScripts 按 GOOS 给出该平台的那一份。
//
// Windows 的 .ps1 与 unix 的 .sh 不是同一段代码的两个格式，而是两份实现（见
// scripts/ 下各自的抬头），所以这里按平台取一份，而不是取一份再想办法跨平台跑。
func installScripts() map[string]installScript {
	return map[string]installScript{
		"windows": {
			Path:   "scripts/install-chromium.ps1",
			SHA256: "94fac75f98100e6bb0f8cf887ae242e2b88f17d6b079b6e59ef9f0ada6eb69d2",
			Command: func(scriptPath, appDir string) *exec.Cmd {
				return exec.Command("powershell", "-ExecutionPolicy", "Bypass", "-File", scriptPath, "-AppDir", appDir)
			},
		},
		"darwin": {
			Path:   "scripts/install-chromium.sh",
			SHA256: "97e00ce690f04de6b74090f514bea494e1c29aed5859e945f9baee7e6546d147",
			Command: func(scriptPath, appDir string) *exec.Cmd {
				return exec.Command("bash", scriptPath, appDir)
			},
		},
		"linux": {
			Path:   "scripts/install-chromium.sh",
			SHA256: "97e00ce690f04de6b74090f514bea494e1c29aed5859e945f9baee7e6546d147",
			Command: func(scriptPath, appDir string) *exec.Cmd {
				return exec.Command("bash", scriptPath, appDir)
			},
		},
	}
}

// scriptURL 是这个平台的脚本在 GitHub 上的原始内容地址。
//
// raw.githubusercontent.com 按 ref 取内容；ref 是 commit 时，内容不可变——这正是
// 不用分支名的理由。
func scriptURL(goos string) (string, error) {
	script, ok := installScripts()[goos]
	if !ok {
		return "", fmt.Errorf("no chromium install script for %s", goos)
	}
	return fmt.Sprintf("https://raw.githubusercontent.com/%s/%s/%s", scriptRepo, scriptRef, script.Path), nil
}

// installTimeout 是整个安装的上限：下载一份 150–200MB 的浏览器再解压，慢的网络上
// 几分钟是正常的，卡住不动则必须有个头。
const installTimeout = 20 * time.Minute

// maxScriptBytes 是脚本内容的上限。脚本是几 KB 的东西；一个几百 MB 的「脚本」说明
// 取到的根本不是它，那时候要在读进内存之前就停下。
const maxScriptBytes = 1 << 20

// Install 取回这个平台的安装脚本、校验、然后执行它，把浏览器装到 App 旁边。
//
// 每一步的失败都带着「哪一步、为什么」返回，不吞：装不上时用户看到的应该是
// 「摘要不符」或「连不上 GitHub」，而不是一句「安装失败」。
//
// progress 收到脚本的输出（下载进度、装到哪、装完的版本）。它可以为 nil。
func Install(ctx context.Context, client *http.Client, progress func(line string)) error {
	appDir, err := appExecutableDir()
	if err != nil {
		return fmt.Errorf("locate the app directory: %w", err)
	}
	script, ok := installScripts()[runtime.GOOS]
	if !ok {
		return fmt.Errorf("this platform (%s) has no chromium install script", runtime.GOOS)
	}
	url, err := scriptURL(runtime.GOOS)
	if err != nil {
		return err
	}

	ctx, cancel := context.WithTimeout(ctx, installTimeout)
	defer cancel()

	body, err := fetchScript(ctx, client, url)
	if err != nil {
		return err
	}
	got := sha256.Sum256(body)
	if hex.EncodeToString(got[:]) != script.SHA256 {
		// 拒绝执行，不是「照常执行并记一条警告」：这一步的全部意义就是不执行
		// 没见过的东西。
		return fmt.Errorf("the install script fetched from %s does not match the digest shipped with this app "+
			"(want %s, got %s); refusing to run it", url, script.SHA256, hex.EncodeToString(got[:]))
	}

	dir, err := os.MkdirTemp("", "legion-install-chromium-")
	if err != nil {
		return fmt.Errorf("make a temporary directory for the install script: %w", err)
	}
	defer func() { _ = os.RemoveAll(dir) }()

	scriptPath := filepath.Join(dir, filepath.Base(script.Path))
	if err := os.WriteFile(scriptPath, body, 0o700); err != nil {
		return fmt.Errorf("write the install script to %s: %w", scriptPath, err)
	}

	cmd := script.Command(scriptPath, appDir)
	output, err := cmd.CombinedOutput()
	if progress != nil {
		for _, line := range strings.Split(strings.TrimRight(string(output), "\r\n"), "\n") {
			if trimmed := strings.TrimRight(line, "\r"); trimmed != "" {
				progress(trimmed)
			}
		}
	}
	if err != nil {
		return fmt.Errorf("run the install script: %w\n%s", err, output)
	}

	// 装完之后**由查找逻辑自己回答**它看不看得见，而不是相信脚本说的「装到了 X」。
	// 脚本的落点与运行时的查找位置各写各的，正是这里唯一要防的事（CI 的 package
	// 工作流每次也这么验一遍）。
	if Path() == "" {
		return fmt.Errorf("the install script finished, but no browser is visible at any path this app looks in;"+
			" it may have been installed next to the app instead of inside it (app dir: %s)", appDir)
	}
	return nil
}

// fetchScript 取脚本内容。非 200 与超大内容都在读进内存之前就拒绝。
func fetchScript(ctx context.Context, client *http.Client, url string) ([]byte, error) {
	if client == nil {
		client = &http.Client{Timeout: 60 * time.Second}
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, url, nil)
	if err != nil {
		return nil, fmt.Errorf("build the request for %s: %w", url, err)
	}
	resp, err := client.Do(req)
	if err != nil {
		return nil, fmt.Errorf("fetch the install script from %s: %w", url, err)
	}
	defer func() { _ = resp.Body.Close() }()
	if resp.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("fetch the install script from %s: HTTP %d", url, resp.StatusCode)
	}
	body, err := io.ReadAll(io.LimitReader(resp.Body, maxScriptBytes+1))
	if err != nil {
		return nil, fmt.Errorf("read the install script from %s: %w", url, err)
	}
	if len(body) > maxScriptBytes {
		return nil, fmt.Errorf("the install script at %s is larger than %d bytes; that is not a script", url, maxScriptBytes)
	}
	return body, nil
}

// appExecutableDir 是「App 的可执行文件所在的那个目录」——安装脚本要的正是它。
//
// macOS 上它在 .app/Contents/MacOS/ 里；脚本对给错的那层会直接拒绝并打印该给的
// 路径（见 scripts/install-chromium.sh），所以这里给的必须是可执行文件真正所在的
// 目录，而不是 .app 所在的目录。
func appExecutableDir() (string, error) {
	exe, err := os.Executable()
	if err != nil {
		return "", fmt.Errorf("os.Executable: %w", err)
	}
	if resolved, err := filepath.EvalSymlinks(exe); err == nil {
		exe = resolved
	}
	return filepath.Dir(exe), nil
}

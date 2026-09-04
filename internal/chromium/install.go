package chromium

import (
	"bytes"
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

// remoteFile 是一份**随版本钉死**的仓库文件：仓库内路径 + 内容摘要。
//
// 安装要取回的每一份文件都是这个形状，因为它们受同一条规矩管：取回来的内容必须与
// 编译进二进制的摘要逐字相符，不符就拒绝执行。
type remoteFile struct {
	// Path 是文件在仓库里的路径。
	Path string
	// SHA256 是随这个版本一起发出的那份内容的摘要。取回来的内容必须与它相符。
	//
	// 它由 TestTheEmbeddedDigestsMatchTheScriptsInThisRepo 守着：改了 scripts/ 下
	// 的文件却忘了改这里，测试立刻红——否则症状是「装不上」，而错误信息会指向网络
	// 或 GitHub，与真正的原因隔着十万八千里。
	SHA256 string
}

// installScript 是一个平台的安装脚本：钉住的文件，以及怎么执行它。
type installScript struct {
	remoteFile
	// Command 把脚本文件与目标目录拼成一条命令。
	Command func(scriptPath, appDir string) *exec.Cmd
}

// pinFile 是安装脚本要读的版本清单（chromium-pin.json）：装哪个版本、每个平台的包
// 地址与摘要，都写在它里面。
//
// 两份安装脚本都在**自己所在的那个目录**里找它（ps1 走
// `Split-Path -Parent $MyInvocation.MyCommand.Path`，sh 走 `dirname "$BASH_SOURCE"`），
// 找不到就直接 throw / die。所以它必须与脚本一起落进同一个临时目录——只取脚本，安装
// 100% 失败在第一行。
//
// **它和脚本一样必须校验摘要。** 它不是一份无关紧要的配置：它是「装哪个浏览器」的
// 唯一来源（URL + 摘要）。一个不校验的 pin 文件等于让任何能改那个地址内容的人指定
// 用户机器上装什么——脚本会老老实实按它给的 URL 下载、按它给的摘要「校验」通过，
// 于是脚本里那套摘要校验形同虚设。校验脚本却不校验 pin，等于锁了门却把钥匙挂在门上。
func pinFile() remoteFile {
	return remoteFile{
		Path:   "scripts/chromium-pin.json",
		SHA256: "9e3a728ba275f80e38892501de8c78f546b260fdbf97dba1e84b884c7389aa43",
	}
}

// installScripts 按 GOOS 给出该平台的那一份。
//
// Windows 的 .ps1 与 unix 的 .sh 不是同一段代码的两个格式，而是两份实现（见
// scripts/ 下各自的抬头），所以这里按平台取一份，而不是取一份再想办法跨平台跑。
func installScripts() map[string]installScript {
	unix := installScript{
		remoteFile: remoteFile{
			Path:   "scripts/install-chromium.sh",
			SHA256: "97e00ce690f04de6b74090f514bea494e1c29aed5859e945f9baee7e6546d147",
		},
		Command: func(scriptPath, appDir string) *exec.Cmd {
			return exec.Command("bash", scriptPath, appDir)
		},
	}
	return map[string]installScript{
		"windows": {
			remoteFile: remoteFile{
				Path:   "scripts/install-chromium.ps1",
				SHA256: "94fac75f98100e6bb0f8cf887ae242e2b88f17d6b079b6e59ef9f0ada6eb69d2",
			},
			Command: windowsInstallCommand,
		},
		"darwin": unix,
		"linux":  unix,
	}
}

// windowsInstallCommand 拼出执行 .ps1 的那条命令。
//
// 走 `-Command` 而不是 `-File`，只为在跑脚本之前先把 `[Console]::OutputEncoding`
// 设成 UTF-8。Windows PowerShell 5.1 默认按**控制台代码页**（中文机器上是 GBK）编码
// 它写出去的每一个字节，而 Go 这边按 UTF-8 读——于是脚本里那些「找不到 …」「摘要
// 不符 …」到了界面上就是 `install-chromium: 涓枃…` 那种乱码。**失败信息是用户唯一
// 能看懂的东西**，乱码等于没有。（2026-09-04 真机复现并逐字节比对过两种写法。）
//
// 编码只改在**输出这一侧**，不在 Go 这边猜编码解码：猜要先知道对面用的是哪个代码页
// （GBK / Big5 / cp1252 各不相同，还随机器区域设置变），而脚本里既有中文也有下载来的
// 路径，猜错的表现同样是乱码，只是换了一种。让源头直接吐 UTF-8 才是确定的。
//
// 脚本路径与 AppDir 都经 psQuote 进单引号：两者都可能带空格（`C:\Program Files\…`），
// AppDir 还可能带单引号。拼错的表现不是乱码，是**脚本根本没跑起来**。
//
// 用 `&`（调用运算符）而不是直接写路径：带引号的字符串在 PowerShell 里默认被当成
// 一个**字符串字面量**求值并原样打印，`&` 才是「把它当命令执行」。
func windowsInstallCommand(scriptPath, appDir string) *exec.Cmd {
	command := "[Console]::OutputEncoding=[System.Text.Encoding]::UTF8; & " +
		psQuote(scriptPath) + " -AppDir " + psQuote(appDir)
	return exec.Command("powershell", "-NoProfile", "-ExecutionPolicy", "Bypass", "-Command", command)
}

// psQuote 把一个字符串包成 PowerShell 的**单引号**字面量。
//
// 单引号里 PowerShell 不做任何展开（`$` 与反引号都是普通字符），唯一需要转义的是
// 单引号本身——写成两个。这一点很重要：Windows 的路径里全是反斜杠，双引号字面量会
// 把 `$` 当变量、把反引号当转义符，那才是真会拼错的写法。
func psQuote(s string) string {
	return "'" + strings.ReplaceAll(s, "'", "''") + "'"
}

// rawURL 是仓库里某个文件在 GitHub 上的原始内容地址。
//
// raw.githubusercontent.com 按 ref 取内容；ref 是 commit 时，内容不可变——这正是
// 不用分支名的理由。
func rawURL(path string) string {
	return fmt.Sprintf("https://raw.githubusercontent.com/%s/%s/%s", scriptRepo, scriptRef, path)
}

// scriptURL 是这个平台的脚本在 GitHub 上的原始内容地址。
func scriptURL(goos string) (string, error) {
	script, ok := installScripts()[goos]
	if !ok {
		return "", fmt.Errorf("no chromium install script for %s", goos)
	}
	return rawURL(script.Path), nil
}

// installTimeout 是整个安装的上限：下载一份 150–200MB 的浏览器再解压，慢的网络上
// 几分钟是正常的，卡住不动则必须有个头。
const installTimeout = 20 * time.Minute

// maxScriptBytes 是脚本内容的上限。脚本是几 KB 的东西；一个几百 MB 的「脚本」说明
// 取到的根本不是它，那时候要在读进内存之前就停下。
const maxScriptBytes = 1 << 20

// Install 取回这个平台的安装脚本**与它要读的 chromium-pin.json**、逐一校验、把两者
// 放进同一个临时目录，然后执行脚本，把浏览器装到 App 旁边。
//
// 两份文件必须**同一个目录**：脚本在自己所在的那个目录里找 pin 文件（ps1 走
// `Split-Path -Parent $MyInvocation.MyCommand.Path`，sh 走 `dirname "$BASH_SOURCE"`），
// 找不到就在第一行 throw / die。只取脚本，安装 100% 失败。
//
// **pin 文件和脚本一样要校验摘要。** 它是「装哪个浏览器」的唯一来源——每个平台的包
// 地址与摘要都写在它里面。不校验它，等于让任何能改那个地址内容的人指定用户机器上装
// 什么：脚本会按它给的 URL 下载、按它给的摘要「校验」通过，脚本里那套校验形同虚设。
// 校验脚本却不校验 pin，等于锁了门却把钥匙挂在门上。
//
// 每一步的失败都带着「哪一步、为什么」返回，不吞：装不上时用户看到的应该是
// 「摘要不符」或「连不上 GitHub」，而不是一句「安装失败」。取不到 pin、pin 对不上，
// 都在执行之前就停下，没有「没有 pin 就凑合装」这条路。
//
// progress 在脚本**还在跑的时候**逐行收到它的输出（下载进度、装到哪、装完的版本），
// 不是等它退出之后一次性倒出来——整件事要几分钟，没有进度的几分钟用户会以为它死了
// （见 runInstallScript）。它可以为 nil。
func Install(ctx context.Context, client *http.Client, progress func(line string)) error {
	appDir, err := appExecutableDir()
	if err != nil {
		return fmt.Errorf("locate the app directory: %w", err)
	}
	script, ok := installScripts()[runtime.GOOS]
	if !ok {
		return fmt.Errorf("this platform (%s) has no chromium install script", runtime.GOOS)
	}
	ctx, cancel := context.WithTimeout(ctx, installTimeout)
	defer cancel()

	dir, scriptPath, err := stageInstallFiles(ctx, client, script, rawURL)
	if dir != "" {
		defer func() { _ = os.RemoveAll(dir) }()
	}
	if err != nil {
		return err
	}

	if err := runInstallScript(script.Command(scriptPath, appDir), progress); err != nil {
		return err
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

// stageInstallFiles 建一个临时目录，把安装要用的每一份文件取回来、校验摘要、写进去，
// 返回该目录与脚本在里面的落点。
//
// urlFor 把仓库内路径换成取内容的地址；正式路径上它是 rawURL，测试可以指向本地服务器。
//
// 目录即使在出错时也会返回（若已经建出来），好让调用方无条件清掉它。
func stageInstallFiles(ctx context.Context, client *http.Client, script installScript, urlFor func(path string) string) (string, string, error) {
	body, err := fetchVerified(ctx, client, urlFor(script.Path), script.SHA256, "install script")
	if err != nil {
		return "", "", err
	}
	// 脚本要读的清单，与脚本走**同一套**取回 + 校验。取不到或对不上就到此为止，不许
	// 「没有 pin 就凑合装」：那样的失败会发生在用户机器上，且指向他的磁盘而不是这里。
	pin := pinFile()
	pinBody, err := fetchVerified(ctx, client, urlFor(pin.Path), pin.SHA256, filepath.Base(pin.Path))
	if err != nil {
		return "", "", err
	}

	dir, err := os.MkdirTemp("", "legion-install-chromium-")
	if err != nil {
		return "", "", fmt.Errorf("make a temporary directory for the install script: %w", err)
	}

	scriptPath := filepath.Join(dir, filepath.Base(script.Path))
	if err := os.WriteFile(scriptPath, body, 0o700); err != nil {
		return dir, "", fmt.Errorf("write the install script to %s: %w", scriptPath, err)
	}
	// **同一个目录**，不是随便哪里：两份脚本都按「自己所在的那个目录」找它。
	pinPath := filepath.Join(dir, filepath.Base(pin.Path))
	if err := os.WriteFile(pinPath, pinBody, 0o600); err != nil {
		return dir, "", fmt.Errorf("write %s to %s: %w", filepath.Base(pin.Path), pinPath, err)
	}

	return dir, scriptPath, nil
}

// fetchVerified 取一份钉住的文件，并把内容与编译进二进制的摘要逐字比对。
//
// 不符就**拒绝**，不是「照常继续并记一条警告」：这一步的全部意义就是不执行没见过的
// 东西。what 只用来让错误说清是哪一份文件对不上。
func fetchVerified(ctx context.Context, client *http.Client, url, want, what string) ([]byte, error) {
	body, err := fetchScript(ctx, client, url)
	if err != nil {
		return nil, err
	}
	sum := sha256.Sum256(body)
	if got := hex.EncodeToString(sum[:]); got != want {
		return nil, fmt.Errorf("the %s fetched from %s does not match the digest shipped with this app "+
			"(want %s, got %s); refusing to run the install", what, url, want, got)
	}
	return body, nil
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

// maxErrorTailLines 是脚本失败时随错误带回的输出行数上限。
//
// 老实现用 CombinedOutput，错误里带的是**全部**输出；改成边读边发之后这份要自己攒，
// 而「自己攒」就必须有个头：脚本在下 150MB 的过程里会一直写。留的是**最后**这些行
// ——它们才是「卡在哪一步」的答案。
const maxErrorTailLines = 200

// maxLineBytes 是单行的上限。用 \r 刷新的进度条可以一直不写 \n；没有这个上限，那种
// 输出会让缓冲区一直涨，而且在脚本结束之前一行也发不出去——正是这里要修的毛病。
const maxLineBytes = 8 << 10

// runInstallScript 执行安装脚本，**边跑边**把它的输出逐行交给 progress。
//
// 不用 CombinedOutput：那个函数缓冲到进程退出才返回，于是回调只能发生在安装已经结束
// 之后，界面在下载与解压的几分钟里一个字都收不到——没有进度的几分钟，用户会以为它
// 死了。TestProgressArrivesWhileTheScriptIsStillRunning 钉住这条时序。
//
// progress 可以为 nil。失败时错误里仍带着最后 maxErrorTailLines 行输出。
func runInstallScript(cmd *exec.Cmd, progress func(line string)) error {
	out := &lineWriter{progress: progress}
	// stdout 与 stderr 指向**同一个** writer：os/exec 认出这一点并让两者共用一个管道
	// 与一个复制协程，于是行的先后就是脚本写出来的先后，writer 也不需要自己加锁。
	cmd.Stdout = out
	cmd.Stderr = out
	if err := cmd.Start(); err != nil {
		return fmt.Errorf("start the install script: %w", err)
	}
	// Wait 会等到那个复制协程结束，所以它返回之后 out 不会再被写入。
	err := cmd.Wait()
	out.flush()
	if err != nil {
		return fmt.Errorf("run the install script: %w\n%s", err, out.tailText())
	}
	return nil
}

// lineWriter 把写进来的字节按行切开：每满一行就交给 progress 一次，同时留下最后
// maxErrorTailLines 行，供失败时说明「卡在哪一步」。
//
// 它只被 os/exec 那一个复制协程写，所以没有锁；这一点由 runInstallScript 里
// 「Stdout 与 Stderr 是同一个值」保证，改那两行之前先读这里。
type lineWriter struct {
	progress func(line string)
	buf      []byte
	tail     []string
	dropped  bool
}

func (w *lineWriter) Write(p []byte) (int, error) {
	w.buf = append(w.buf, p...)
	for {
		i := bytes.IndexByte(w.buf, '\n')
		if i < 0 {
			break
		}
		w.emit(string(w.buf[:i]))
		w.buf = w.buf[i+1:]
	}
	if len(w.buf) > maxLineBytes {
		w.emit(string(w.buf))
		w.buf = w.buf[:0]
	}
	return len(p), nil
}

// flush 把最后那段没有换行结尾的输出也发出去。
func (w *lineWriter) flush() {
	if len(w.buf) > 0 {
		w.emit(string(w.buf))
		w.buf = w.buf[:0]
	}
}

// emit 去掉行尾的 \r（Windows 那份脚本写的是 \r\n），空行既不发也不留。
func (w *lineWriter) emit(line string) {
	line = strings.TrimRight(line, "\r")
	if line == "" {
		return
	}
	w.tail = append(w.tail, line)
	if len(w.tail) > maxErrorTailLines {
		w.tail = w.tail[len(w.tail)-maxErrorTailLines:]
		w.dropped = true
	}
	if w.progress != nil {
		w.progress(line)
	}
}

// tailText 是失败时随错误带回的那段输出。截过就说截过：一份没头没尾的日志会让人以为
// 脚本就是从那里开始的。
func (w *lineWriter) tailText() string {
	joined := strings.Join(w.tail, "\n")
	if w.dropped {
		return fmt.Sprintf("（只保留最后 %d 行输出）\n%s", maxErrorTailLines, joined)
	}
	return joined
}

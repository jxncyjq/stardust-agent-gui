package chromium

import (
	"fmt"
	"io"
	"os"
	"os/exec"
	"strings"
	"sync"
	"testing"
	"time"
)

// helperTimeout 是这些用例等替身进程的上限。它只是防挂死用的，正常路径上没人会等到。
const helperTimeout = 20 * time.Second

// helperCommand 用**测试二进制自己**当替身脚本：跨平台，不依赖 shell，也不依赖这台
// 机器上装了什么。模式经环境变量传给 TestInstallScriptHelperProcess。
func helperCommand(t *testing.T, mode string) *exec.Cmd {
	t.Helper()
	cmd := exec.Command(os.Args[0], "-test.run=^TestInstallScriptHelperProcess$")
	cmd.Env = append(os.Environ(), "CHROMIUM_INSTALL_HELPER="+mode)
	return cmd
}

// TestInstallScriptHelperProcess 不是一条测试，是上面那些用例的**替身进程入口**。
// 没有那个环境变量时它立刻返回，常规 go test 里什么也不做。
func TestInstallScriptHelperProcess(t *testing.T) {
	switch os.Getenv("CHROMIUM_INSTALL_HELPER") {
	case "":
		return

	case "print-then-wait":
		// 先写一行，然后**阻塞等 stdin 被关掉**才写第二行并退出。关 stdin 的动作由
		// progress 回调触发，所以这个进程能退出本身就是「progress 在它还活着的时候
		// 被调用过」的证据。
		fmt.Println("第一行")
		_, _ = io.Copy(io.Discard, os.Stdin)
		fmt.Println("第二行")
		os.Exit(0)

	case "fail-after-output":
		fmt.Println("输出 1")
		fmt.Println("输出 2")
		fmt.Fprintln(os.Stderr, "脚本自己说的失败原因")
		os.Exit(3)

	case "flood-then-fail":
		for i := 0; i < maxErrorTailLines*3; i++ {
			fmt.Printf("第 %d 行\n", i)
		}
		os.Exit(4)
	}
}

// TestProgressArrivesWhileTheScriptIsStillRunning 钉的是本分支的标题性质：脚本的输出
// 必须在它**还在跑**的时候就到达 progress，而不是等它退出之后一次性倒出来。
//
// 这条专门挡住 CombinedOutput 那种写法。**只断言「最终收到了全部行」是不够的**——
// 那在缓冲实现下同样是绿的；所以断言只能落在时序上：替身进程打印一行后阻塞等 stdin
// 关闭，而关 stdin 的动作由 progress 回调触发。progress 若要等到进程退出才被调用，
// 这里就永远等不到那一行，测试在 helperTimeout 之后报「脚本退出之前一行都没收到」。
func TestProgressArrivesWhileTheScriptIsStillRunning(t *testing.T) {
	cmd := helperCommand(t, "print-then-wait")
	stdin, err := cmd.StdinPipe()
	if err != nil {
		t.Fatalf("StdinPipe: %v", err)
	}
	// 断言无论走哪条路，替身都要能退出：否则它会一直挂着等一个永远不关的 stdin。
	defer func() { _ = stdin.Close() }()

	var mu sync.Mutex
	var lines []string
	firstLine := make(chan string, 1)
	done := make(chan error, 1)
	go func() {
		done <- runInstallScript(cmd, func(line string) {
			mu.Lock()
			lines = append(lines, line)
			mu.Unlock()
			select {
			case firstLine <- line:
			default:
			}
		})
	}()

	select {
	case line := <-firstLine:
		if line != "第一行" {
			t.Fatalf("第一次 progress 收到的是 %q，want %q", line, "第一行")
		}
		// 收到了 → 放替身进程走。
		if err := stdin.Close(); err != nil {
			t.Fatalf("关掉替身的 stdin：%v", err)
		}
	case <-time.After(helperTimeout):
		t.Fatal("脚本还在跑的时候一行输出都没收到：进度是在它退出之后才一次性倒出来的，" +
			"界面在下载与解压的几分钟里会一个字都不变")
	}

	select {
	case err := <-done:
		if err != nil {
			t.Fatalf("替身正常退出，却报了错：%v", err)
		}
	case <-time.After(helperTimeout):
		t.Fatal("stdin 关掉之后替身没有退出")
	}

	mu.Lock()
	got := append([]string(nil), lines...)
	mu.Unlock()
	want := []string{"第一行", "第二行"}
	if len(got) != len(want) || got[0] != want[0] || got[1] != want[1] {
		t.Errorf("progress 收到的是 %q，want %q：边发边跑不能少发或多发行", got, want)
	}
}

// 改成边读边发之后，失败时的错误不再有 CombinedOutput 那份完整 output 可用——必须
// 自己攒。这条钉住「攒的那份确实进了错误」：不然「装不上」只剩一句 exit status 3，
// 排查者拿不到脚本自己说的原因。progress 为 nil 也要照攒。
func TestAFailingScriptCarriesItsOutputInTheError(t *testing.T) {
	err := runInstallScript(helperCommand(t, "fail-after-output"), nil)
	if err == nil {
		t.Fatal("替身以非零码退出，runInstallScript 却报成功")
	}
	for _, want := range []string{"输出 2", "脚本自己说的失败原因"} {
		if !strings.Contains(err.Error(), want) {
			t.Errorf("错误里没带上 %q，排查者看不到脚本说了什么：%v", want, err)
		}
	}
}

// 攒 tail 必须有个头：脚本在下 150MB 的过程里会一直写，无界地攒等于把整份日志留在
// 内存里再塞进一个错误字符串。保留的是**最后**那些行——它们才是「卡在哪一步」的答案。
func TestTheErrorTailIsBounded(t *testing.T) {
	err := runInstallScript(helperCommand(t, "flood-then-fail"), nil)
	if err == nil {
		t.Fatal("替身以非零码退出，runInstallScript 却报成功")
	}
	if n := strings.Count(err.Error(), "第 "); n > maxErrorTailLines {
		t.Errorf("错误里带了 %d 行输出，上限是 %d", n, maxErrorTailLines)
	}
	last := fmt.Sprintf("第 %d 行", maxErrorTailLines*3-1)
	if !strings.Contains(err.Error(), last) {
		t.Errorf("错误里没有最后一行 %q：留的是开头不是结尾，那答不了「卡在哪一步」", last)
	}
	if strings.Contains(err.Error(), "第 0 行\n") {
		t.Error("错误里还带着最开头那行：说明根本没截")
	}
}

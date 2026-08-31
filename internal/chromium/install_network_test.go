//go:build network

package chromium

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"runtime"
	"testing"
)

// 这条走**真实的 GitHub**，默认不跑：
//
//	go test -tags network ./internal/chromium/
//
// 上面那些测试证明的是「本地这一份与编译进二进制的摘要相符」；它们证明不了**取回来
// 的那一份**也相符——而两者不符的原因恰恰是最容易发生的那些：钉的 commit 不在远端
// （只提交没推）、脚本改名、仓库改名、raw 地址拼错。那些都只有真去取一次才会暴露，
// 而症状发生在用户机器上：「装不上」。
//
// 不进常规 CI：一条依赖外网的红线会变成没人看的红线。
func TestTheRealGitHubServesExactlyWhatWeShipped(t *testing.T) {
	for _, goos := range []string{"windows", "darwin", "linux"} {
		url, err := scriptURL(goos)
		if err != nil {
			t.Fatalf("scriptURL(%s): %v", goos, err)
		}
		body, err := fetchScript(context.Background(), nil, url)
		if err != nil {
			t.Errorf("%s: 取不到 %s：%v", goos, url, err)
			continue
		}
		sum := sha256.Sum256(body)
		got := hex.EncodeToString(sum[:])
		want := installScripts()[goos].SHA256
		if got != want {
			t.Errorf("%s: GitHub 上那份与随包发出的摘要不符\n地址 = %s\n远端 = %s\n本地 = %s",
				goos, url, got, want)
			continue
		}
		t.Logf("%s: %s 与随包摘要相符（%d 字节）", goos, url, len(body))
	}
	t.Logf("本机是 %s；安装时用的就是这一行对应的那份", runtime.GOOS)
}

// browserInput 负责接管模式下把 DOM 鼠标/键盘事件映射为后端归一化 InputEvent，
// 并经 Go Wails binding POST 到会话端点（避开 webview 直发的 CORS 预检）。
// 坐标只发 0..1，后端 × 视口 px。
import { BrowserInput, BrowserTakeover } from "../../wailsjs/go/main/App";

export interface InputEvent {
  type: string;
  x?: number;
  y?: number;
  button?: string;
  deltaX?: number;
  deltaY?: number;
  key?: string;
  text?: string;
  // modifiers 随**这一条**事件走（后端按下 → 注入 → 释放），而不是靠 Control 的
  // keydown/keyup 在后端维持一个跨请求的按下状态：注入是一串互不相干的 HTTP 请求，
  // 丢一条 keyup 就会把浏览器永久留在 Ctrl 按住的状态里。
  modifiers?: string[];
}

// KeyLike 是这几个映射函数真正需要的东西：一个 key 和四个修饰键布尔。用它而不是
// React.KeyboardEvent，测试才不必造一个合成事件。
export interface KeyLike {
  key: string;
  ctrlKey: boolean;
  shiftKey: boolean;
  altKey: boolean;
  metaKey: boolean;
}

// MODIFIER_KEY_NAMES 是那些**本身就是修饰键**的 e.key 值。它们从不单独发给后端：
// 修饰键随它所修饰的那条事件走，单独发一条既没有语义，也正是旧行为里每按一次
// Shift 就产生一条 400 的原因。
const MODIFIER_KEY_NAMES = new Set(["Control", "Shift", "Alt", "Meta"]);

// modifiersOf 读出按住的修饰键，没有按住时返回 undefined（而不是空数组）：省掉
// 每条事件里一个空 "modifiers":[]，也让 toEqual 断言读起来就是意图。
export function modifiersOf(
  e: Pick<KeyLike, "ctrlKey" | "shiftKey" | "altKey" | "metaKey">,
): string[] | undefined {
  const held: string[] = [];
  if (e.ctrlKey) held.push("ctrl");
  if (e.shiftKey) held.push("shift");
  if (e.altKey) held.push("alt");
  if (e.metaKey) held.push("meta");
  return held.length > 0 ? held : undefined;
}

// isShortcut 判断这次按键是不是一个命令而不是输入。
//
// shift 不算：移位后的字符已经在 e.key 里（"A" 就是 "A"），把它当命令会让每个大写
// 字母都走键路径。ctrl/alt/meta 算：它们改变的是这次按键的含义，不是它的字形。
function isShortcut(e: KeyLike): boolean {
  return e.ctrlKey || e.altKey || e.metaKey;
}

// keyDownEvents 把一次 keydown 映射成要发的事件（可能一条也不发）。
//
// 三条分支：修饰键本身什么也不发；普通可打印字符走 char（InsertText，输入什么就是
// 什么）；其余——命名键与带 ctrl/alt/meta 的字符——走 keydown 并带上修饰键。
export function keyDownEvents(e: KeyLike): InputEvent[] {
  if (MODIFIER_KEY_NAMES.has(e.key)) return [];
  const modifiers = modifiersOf(e);
  if (e.key.length === 1 && !isShortcut(e)) {
    return [{ type: "char", text: e.key }];
  }
  return [{ type: "keydown", key: e.key, ...(modifiers ? { modifiers } : {}) }];
}

// keyUpEvents 是 keyDownEvents 的对称面：只有真正发过 keydown 的按键才发 keyup。
// char 没有 keyup——它是一次文本插入，不是一次按键。
export function keyUpEvents(e: KeyLike): InputEvent[] {
  if (MODIFIER_KEY_NAMES.has(e.key)) return [];
  if (e.key.length === 1 && !isShortcut(e)) return [];
  const modifiers = modifiersOf(e);
  return [{ type: "keyup", key: e.key, ...(modifiers ? { modifiers } : {}) }];
}

// mapToNormalized 用 canvas 显示矩形把 client 坐标换成 0..1（clamp 越界）。
export function mapToNormalized(
  rect: { left: number; top: number; width: number; height: number },
  clientX: number,
  clientY: number,
): { x: number; y: number } {
  const clamp = (v: number) => (v < 0 ? 0 : v > 1 ? 1 : v);
  return {
    x: clamp((clientX - rect.left) / rect.width),
    y: clamp((clientY - rect.top) / rect.height),
  };
}

// mapToNormalizedContained maps a client point to 0..1 over the image actually
// displayed inside an object-contain canvas box. The canvas bitmap is the frame
// (imgW×imgH); CSS object-contain scales it by the smaller ratio and centers
// it, so the rendered image is letterboxed with gray margins. Mapping against
// the raw box rect (as mapToNormalized alone would) skews every takeover click
// by those margins, landing injected clicks on the wrong page pixel. This
// reconstructs the displayed image rect (scale + centering offsets) so the
// point maps to the real page coordinate. imgW/imgH ≤ 0 fall back to the box.
export function mapToNormalizedContained(
  box: { left: number; top: number; width: number; height: number },
  imgW: number,
  imgH: number,
  clientX: number,
  clientY: number,
): { x: number; y: number } {
  if (imgW <= 0 || imgH <= 0) return mapToNormalized(box, clientX, clientY);
  const scale = Math.min(box.width / imgW, box.height / imgH);
  const dispW = imgW * scale;
  const dispH = imgH * scale;
  const offX = (box.width - dispW) / 2;
  const offY = (box.height - dispH) / 2;
  return mapToNormalized(
    { left: box.left + offX, top: box.top + offY, width: dispW, height: dispH },
    clientX,
    clientY,
  );
}

// Throttler 按最小间隔放行（用于合并高频 mousemove）。调用方传入单调 now(ms)。
export class Throttler {
  private last = -Infinity;
  constructor(private intervalMs: number) {}
  ready(nowMs: number): boolean {
    if (nowMs - this.last >= this.intervalMs) {
      this.last = nowMs;
      return true;
    }
    return false;
  }
}

// postInput/postTakeover forward through the Go Wails bindings, not a direct
// webview fetch. A cross-origin application/json POST from the webview to the
// random-port local serve triggers a CORS preflight the serve answers with 404
// (no OPTIONS handler), so the takeover button and input injection silently did
// nothing. The Go side (BrowserTakeover/BrowserInput) issues the POST with the
// loopback bearer token and no preflight. Both bindings reject on a non-2xx
// serve response, so failures still surface (fail-loud) to the caller.

// postInput 注入一批事件；binding 在后端非 2xx 时 reject（fail-loud）。
export async function postInput(
  sessionId: string,
  events: InputEvent[],
): Promise<void> {
  await BrowserInput(sessionId, JSON.stringify(events));
}

// postTakeover 置/清接管标志。
export async function postTakeover(
  sessionId: string,
  enabled: boolean,
): Promise<void> {
  await BrowserTakeover(sessionId, enabled);
}

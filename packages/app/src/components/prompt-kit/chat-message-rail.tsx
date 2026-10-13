import { cn } from "@/lib/utils";
import type { UIMessage } from "ai";
import { memo, useCallback, useContext, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { useStickToBottomContext } from "use-stick-to-bottom";
import { ChatNavBridgeContext } from "./chat-nav-bridge";

/** 刻度上限：轮次更多时分桶（每刻度代表一段连续轮次） */
const MAX_TICKS = 26;
/** 轮次少于此数不显示导航条（1 轮没有可导航的内容） */
const MIN_TURNS = 2;
const OPEN_DELAY = 70;
const CLOSE_DELAY = 220;
const EXIT_MS = 180;
/** 悬浮窗列表项固定高度——定高使"扫刻度 → 列表定位"是纯算术，不读 DOM */
const ITEM_H = 44;
/** 阅读位置判定线：视口自上而下 35% 处 */
const ACTIVE_LINE = 0.35;

interface Turn {
  id: string;
  user: string;
  reply: string;
}

const userPreviewCache = new WeakMap<object, string>();

function plain(text: string): string {
  return text
    .replace(/```[\s\S]*?(```|$)/g, " [代码] ")
    .replace(/[`*_>#~]+/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 100);
}

function userPreview(message: UIMessage): string {
  const cached = userPreviewCache.get(message);
  if (cached !== undefined) return cached;
  const parts = (message.parts ?? []) as any[];
  let text = plain(
    parts
      .filter((p) => p?.type === "text")
      .map((p) => p.text ?? "")
      .join(" "),
  );
  if (!text) {
    if (parts.some((p) => p?.type === "file")) text = "[图片]";
    else if (parts.some((p) => p?.type === "quote")) text = "[引用]";
    else text = "（空消息）";
  }
  userPreviewCache.set(message, text);
  return text;
}

function replyPreview(message: UIMessage | undefined): string {
  if (!message || message.role !== "assistant") return "";
  const parts = (message.parts ?? []) as any[];
  const text = plain(
    parts
      .filter((p) => p?.type === "text")
      .map((p) => p.text ?? "")
      .join(" "),
  );
  if (text) return text;
  return parts.some((p) => String(p?.type).startsWith("tool-")) ? "调用了工具…" : "";
}

function buildTurns(messages: UIMessage[]): Turn[] {
  const turns: Turn[] = [];
  for (let i = 0; i < messages.length; i++) {
    const m = messages[i];
    if (m.role !== "user") continue;
    turns.push({ id: m.id, user: userPreview(m), reply: replyPreview(messages[i + 1]) });
  }
  return turns;
}

const TurnItem = memo(function TurnItem({
  index,
  user,
  reply,
  active,
  focused,
  onPick,
}: {
  index: number;
  user: string;
  reply: string;
  active: boolean;
  focused: boolean;
  onPick: (index: number) => void;
}) {
  return (
    <button
      type="button"
      onClick={() => onPick(index)}
      style={{ height: ITEM_H }}
      className={cn(
        "flex w-full shrink-0 flex-col justify-center gap-0.5 rounded-md px-2 text-left transition-colors hover:bg-accent hover:text-accent-foreground",
        focused && "bg-accent/60",
        active && "bg-accent",
      )}
    >
      <span className="flex items-baseline gap-1.5">
        <span
          className={cn(
            "w-5 shrink-0 text-right text-[10px] tabular-nums",
            active ? "text-primary" : "text-muted-foreground",
          )}
        >
          {index + 1}
        </span>
        <span className={cn("min-w-0 flex-1 truncate text-xs", active ? "font-semibold" : "font-medium")}>{user}</span>
      </span>
      <span className="truncate pl-[26px] text-[11px] text-muted-foreground">{reply || "…"}</span>
    </button>
  );
});

/**
 * 对话消息导航条：贴在聊天区右缘的细刻度线，悬浮弹出可滚动的轮次缩略列表，点选跳转。
 * 刻度 = 提问轮次（超过 MAX_TICKS 分桶）；鼠标扫过刻度时列表同步滚到对应轮次，数百轮对话也能快速到达最早的消息。
 * 必须渲染在 ChatContainerRoot（StickToBottom）内部：需要其 scrollRef / stopScroll。
 */
export const ChatMessageRail = memo(function ChatMessageRail({ messages }: { messages: UIMessage[] }) {
  const { scrollRef, stopScroll } = useStickToBottomContext();
  const bridge = useContext(ChatNavBridgeContext);
  const turns = useMemo(() => buildTurns(messages), [messages]);
  const count = turns.length;
  const turnsRef = useRef(turns);
  turnsRef.current = turns;

  const [active, setActive] = useState(Math.max(0, count - 1));
  const activeRef = useRef(active);
  activeRef.current = active;
  const [focusIdx, setFocusIdx] = useState<number | null>(null);
  const [mounted, setMounted] = useState(false);
  const [open, setOpen] = useState(false);
  const listRef = useRef<HTMLDivElement | null>(null);
  const openTimer = useRef(0);
  const closeTimer = useRef(0);
  const exitTimer = useRef(0);

  const getEl = useCallback(
    (id: string): HTMLElement | null =>
      scrollRef.current?.querySelector<HTMLElement>(`[data-message-id="${CSS.escape(id)}"]`) ?? null,
    [scrollRef],
  );

  // 阅读位置：只在已渲染的消息元素里找"顶边不低于判定线的最后一个提问轮次"（渲染窗口外的消息不在 DOM 中）；
  // 判定线之上没有任何已渲染轮次时取窗口内第一个
  const computeActive = useCallback(() => {
    const scroll = scrollRef.current;
    if (!scroll) return;
    const indexOf = new Map<string, number>();
    turnsRef.current.forEach((t, i) => indexOf.set(t.id, i));
    const line = scroll.getBoundingClientRect().top + scroll.clientHeight * ACTIVE_LINE;
    let ans = -1;
    let first = -1;
    for (const el of scroll.querySelectorAll<HTMLElement>("[data-message-id]")) {
      const i = indexOf.get(el.dataset.messageId ?? "");
      if (i === undefined) continue;
      if (first < 0) first = i;
      if (el.getBoundingClientRect().top <= line) ans = i;
      else break;
    }
    const next = ans >= 0 ? ans : first;
    if (next >= 0) setActive((prev) => (prev === next ? prev : next));
  }, [scrollRef]);

  // biome-ignore lint/correctness/useExhaustiveDependencies: count 变化（新增轮次）需重绑并重算
  useEffect(() => {
    const scroll = scrollRef.current;
    if (!scroll) return;
    let raf = 0;
    const onScroll = () => {
      if (raf) return;
      raf = requestAnimationFrame(() => {
        raf = 0;
        computeActive();
      });
    };
    scroll.addEventListener("scroll", onScroll, { passive: true });
    onScroll();
    return () => {
      scroll.removeEventListener("scroll", onScroll);
      cancelAnimationFrame(raf);
    };
  }, [scrollRef, computeActive, count]);

  useEffect(
    () => () => {
      window.clearTimeout(openTimer.current);
      window.clearTimeout(closeTimer.current);
      window.clearTimeout(exitTimer.current);
    },
    [],
  );

  const scrollListTo = useCallback((index: number, smooth: boolean) => {
    const list = listRef.current;
    if (!list) return;
    const top = Math.max(0, index * ITEM_H - list.clientHeight / 2 + ITEM_H / 2);
    // 近距离平滑；远距离（扫刻度跨很多轮）直接到位——长距离平滑动画要一秒多，跟不上鼠标
    const near = Math.abs(top - list.scrollTop) <= ITEM_H * 8;
    list.scrollTo({ top, behavior: smooth && near ? "smooth" : "auto" });
  }, []);

  // 悬浮窗挂载后把当前阅读轮次定位到列表中央（无动画，避免从顶部"飞"过来）
  useLayoutEffect(() => {
    if (mounted) scrollListTo(activeRef.current, false);
  }, [mounted, scrollListTo]);

  const onEnter = () => {
    window.clearTimeout(closeTimer.current);
    window.clearTimeout(exitTimer.current);
    if (open) return;
    if (mounted) {
      setOpen(true);
      return;
    }
    window.clearTimeout(openTimer.current);
    openTimer.current = window.setTimeout(() => {
      setMounted(true);
      requestAnimationFrame(() => setOpen(true));
    }, OPEN_DELAY);
  };

  const onLeave = () => {
    window.clearTimeout(openTimer.current);
    window.clearTimeout(closeTimer.current);
    setFocusIdx(null);
    closeTimer.current = window.setTimeout(() => {
      setOpen(false);
      exitTimer.current = window.setTimeout(() => setMounted(false), EXIT_MS);
    }, CLOSE_DELAY);
  };

  const navigate = useCallback(
    (index: number) => {
      const turn = turnsRef.current[index];
      if (!turn) return;
      setOpen(false);
      window.clearTimeout(exitTimer.current);
      exitTimer.current = window.setTimeout(() => setMounted(false), EXIT_MS);
      stopScroll(); // 取消底部跟随弹簧，否则流式中会把视图拽回底部
      bridge?.current.ensureVisible?.(turn.id); // 目标在渲染窗口外时先把它挂出来
      let frames = 0;
      const go = () => {
        const scroll = scrollRef.current;
        const el = getEl(turn.id);
        if (!scroll) return;
        if (!el) {
          if (frames++ < 45) requestAnimationFrame(go); // 等窗口扩展提交（≈0.75s 上限）
          return;
        }
        const top = el.getBoundingClientRect().top - scroll.getBoundingClientRect().top + scroll.scrollTop - 16;
        const far = Math.abs(top - scroll.scrollTop) > scroll.clientHeight * 3;
        scroll.scrollTo({ top: Math.max(0, top), behavior: far ? "auto" : "smooth" });
        const motion = document.documentElement.dataset.motion;
        if (!motion || motion === "full") {
          el.animate(
            [
              { backgroundColor: "color-mix(in oklab, var(--primary) 14%, transparent)" },
              { backgroundColor: "transparent" },
            ],
            { duration: 1100, easing: "ease-out" },
          );
        }
      };
      go();
    },
    [scrollRef, getEl, stopScroll, bridge],
  );

  if (count < MIN_TURNS) return null;

  const ticks = Math.min(count, MAX_TICKS);
  const bucketOf = (k: number) => Math.min(ticks - 1, Math.floor((k * ticks) / count));
  const repOf = (t: number) => Math.ceil((t * count) / ticks);
  const activeTick = bucketOf(active);
  const focusTick = focusIdx === null ? -1 : bucketOf(focusIdx);

  const hoverTick = (t: number) => {
    const rep = repOf(t);
    setFocusIdx(rep);
    scrollListTo(rep, true);
  };

  return (
    <div className="pointer-events-none absolute inset-y-0 right-0 z-20 flex items-center">
      <div className="pointer-events-auto relative" onPointerEnter={onEnter} onPointerLeave={onLeave}>
        {mounted && (
          <div className="-translate-y-1/2 absolute top-1/2 right-full pr-1.5">
            <div
              className="flex w-60 origin-right flex-col overflow-hidden rounded-lg border bg-popover text-popover-foreground shadow-lg"
              style={{
                opacity: open ? 1 : 0,
                transform: open ? "none" : "translateX(var(--motion-slide)) scale(var(--motion-scale))",
                transition:
                  "opacity var(--motion-dur-base) var(--motion-ease), transform var(--motion-dur-base) var(--motion-ease)",
                pointerEvents: open ? "auto" : "none",
              }}
            >
              <div className="flex items-center justify-between border-b px-3 py-1.5 text-[11px] text-muted-foreground">
                <span>消息导航</span>
                <span className="tabular-nums">
                  {active + 1} / {count}
                </span>
              </div>
              <div
                ref={listRef}
                className="relative flex max-h-[min(60vh,22rem)] flex-col overflow-y-auto overscroll-contain p-1"
              >
                {turns.map((turn, i) => (
                  <TurnItem
                    key={turn.id}
                    index={i}
                    user={turn.user}
                    reply={turn.reply}
                    active={i === active}
                    focused={i === focusIdx}
                    onPick={navigate}
                  />
                ))}
              </div>
            </div>
          </div>
        )}
        <div
          className="flex max-h-[80vh] flex-col py-2 pr-1"
          style={{ height: ticks * 11 + 16 }}
          role="navigation"
          aria-label="消息导航"
        >
          {Array.from({ length: ticks }, (_, t) => (
            <button
              key={t}
              type="button"
              tabIndex={-1}
              aria-label={`跳转到第 ${repOf(t) + 1} 轮`}
              onPointerEnter={() => hoverTick(t)}
              onClick={() => navigate(repOf(t))}
              className="group/tick flex min-h-0 w-5 flex-1 items-center justify-end"
            >
              <span
                className={cn(
                  "block h-[2px] rounded-full transition-all duration-150",
                  t === activeTick
                    ? "w-3.5 bg-primary"
                    : t === focusTick
                      ? "w-3 bg-foreground/80"
                      : "w-2 bg-muted-foreground/35 group-hover/tick:w-3 group-hover/tick:bg-foreground/70",
                )}
              />
            </button>
          ))}
        </div>
      </div>
    </div>
  );
});

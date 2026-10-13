import { Markdown } from "@/components/prompt-kit/markdown";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { useIsChatPage } from "@/hooks/use-is-chat-page";
import { cn } from "@/lib/utils";
import { useReaderStore } from "@/pages/reader/components/reader-provider";
import { useChatReaderStore } from "@/store/chat-reader-store";
import { Loader, SquareArrowOutUpRight } from "lucide-react";
import { useCallback, useDeferredValue, useEffect, useRef, useState } from "react";
import { useAnnotationSearch } from "./hooks/use-annotation-search";

/** 正文 Markdown（remark-math/katex 解析较重）降为低优先级渲染：首帧先出弹窗外壳，不与入场动画抢帧 */
function DeferredMarkdown({ text }: { text: string }) {
  const deferred = useDeferredValue(text, "");
  return <Markdown>{deferred}</Markdown>;
}

/** 悬停弹出 / 收起的意图延迟：避免鼠标擦过引用标就弹窗、或移向弹窗途中就收起 */
const HOVER_OPEN_MS = 220;
const HOVER_CLOSE_MS = 180;

export function AnnotationPopover({ chunkId, children }: { chunkId: string; children: React.ReactNode }) {
  const [open, setOpen] = useState(false);
  // 点击"固定"：固定后移开鼠标不收起，点外部/Esc 才关；仅悬停弹出的移开即收
  const pinnedRef = useRef(false);
  const isChatPage = useIsChatPage();

  const chatActiveBookId = useChatReaderStore((state) => state.activeBookId);
  const readerBookId = useReaderStore((state) => state.bookId);
  const activeBookId = isChatPage ? chatActiveBookId : readerBookId;

  const { loading, chunkData, error, searching, source, fetchChunkData, searchAndNavigate, resetError } =
    useAnnotationSearch();

  // 跳转按钮：论文来源任何页面可跳（openPaper + quote 定位总线）；书籍来源维持原行为（全局聊天页隐藏，
  // 因为 foliate view 只活在书籍 tab 内）
  const canNavigate = source?.kind === "paper" || !isChatPage;
  // 弹窗标题：论文显示《论文标题》小节，书籍维持章节名
  const headingText = chunkData
    ? source?.kind === "paper"
      ? `《${chunkData.book_title}》${chunkData.related_chapter_titles ? ` ${chunkData.related_chapter_titles}` : ""}`
      : chunkData.related_chapter_titles
    : "";

  const handleSearchInReader = useCallback(async () => {
    const success = await searchAndNavigate();
    if (success) {
      pinnedRef.current = false;
      setOpen(false);
    }
  }, [searchAndNavigate]);

  const openTimer = useRef(0);
  const closeTimer = useRef(0);
  const prefetchTimer = useRef(0);
  useEffect(
    () => () => {
      window.clearTimeout(openTimer.current);
      window.clearTimeout(closeTimer.current);
      window.clearTimeout(prefetchTimer.current);
    },
    [],
  );

  const openNow = () => {
    if (!open) {
      resetError();
      if (!chunkData && !loading) fetchChunkData(chunkId);
    }
    setOpen(true);
  };

  // 悬停：约 120ms 预取原文片段，约 220ms 弹出；移开（触发器与弹窗都不在）约 180ms 后收起，已固定则不收
  const onTriggerEnter = () => {
    window.clearTimeout(closeTimer.current);
    window.clearTimeout(prefetchTimer.current);
    prefetchTimer.current = window.setTimeout(() => {
      if (!chunkData && !loading && !error) fetchChunkData(chunkId);
    }, 120);
    if (open) return;
    window.clearTimeout(openTimer.current);
    openTimer.current = window.setTimeout(openNow, HOVER_OPEN_MS);
  };
  const onHoverLeave = () => {
    window.clearTimeout(openTimer.current);
    window.clearTimeout(prefetchTimer.current);
    if (pinnedRef.current) return;
    window.clearTimeout(closeTimer.current);
    closeTimer.current = window.setTimeout(() => setOpen(false), HOVER_CLOSE_MS);
  };
  const onContentEnter = () => window.clearTimeout(closeTimer.current);

  // 点击：固定弹窗（再点已固定的则关闭）；preventDefault 拦掉 Radix 自带的开关切换，避免悬停已弹出时点击反而关掉
  const onTriggerClick = (event: React.MouseEvent) => {
    event.preventDefault();
    window.clearTimeout(openTimer.current);
    window.clearTimeout(closeTimer.current);
    if (open && pinnedRef.current) {
      pinnedRef.current = false;
      setOpen(false);
      return;
    }
    pinnedRef.current = true;
    openNow();
  };

  // 仅响应 Radix 的外部关闭（点外部 / Esc）
  const handleOpenChange = (newOpen: boolean) => {
    if (newOpen) return;
    pinnedRef.current = false;
    setOpen(false);
  };

  useEffect(() => {
    if (!open || !activeBookId) return;

    const handleIframeClick = (event: MessageEvent) => {
      if (event.data?.type === "iframe-single-click" && event.data?.bookId === activeBookId) {
        pinnedRef.current = false;
        setOpen(false);
      }
    };

    window.addEventListener("message", handleIframeClick);

    return () => {
      window.removeEventListener("message", handleIframeClick);
    };
  }, [open, activeBookId]);

  return (
    <Popover open={open} onOpenChange={handleOpenChange}>
      <PopoverTrigger asChild>
        <span
          className="cursor-pointer text-primary hover:underline"
          onPointerEnter={onTriggerEnter}
          onPointerLeave={onHoverLeave}
          onClick={onTriggerClick}
        >
          {children}
        </span>
      </PopoverTrigger>
      <PopoverContent
        // 贴着引用标弹出：优先上方，空间不足 Radix 自动翻到下方；不再把弹窗推到侧栏之外的阅读版面上
        side="top"
        align="center"
        sideOffset={8}
        collisionPadding={12}
        onOpenAutoFocus={(event) => event.preventDefault()}
        onPointerEnter={onContentEnter}
        onPointerLeave={onHoverLeave}
        className={cn(
          "max-h-96 overflow-auto p-0",
          // 有内容才撑固定宽；加载/空态/错误随内容自适应，不再撑 w-80 大框
          chunkData ? "w-80" : "w-auto max-w-72",
        )}
      >
        {loading ? (
          <div className="flex items-center justify-center px-4 py-3">
            <div className="whitespace-nowrap text-muted-foreground text-sm">加载中...</div>
          </div>
        ) : error ? (
          <div className="flex items-center gap-2 p-3 text-sm">
            <span className="text-red-600 dark:text-red-400">{error}</span>
            <Button
              size="sm"
              variant="ghost"
              className="h-6 flex-shrink-0 rounded-full px-2 text-xs"
              onClick={() => fetchChunkData(chunkId)}
            >
              重试
            </Button>
          </div>
        ) : chunkData ? (
          <div className="flex max-h-[320px] flex-col overflow-hidden bg-muted/80">
            <div className="border-b px-3 py-1 pr-2">
              <div className="flex items-center justify-between">
                <Tooltip>
                  <TooltipTrigger asChild>
                    <div className="mr-2 flex-1 truncate font-medium text-foreground">{headingText}</div>
                  </TooltipTrigger>
                  <TooltipContent side="bottom">{headingText}</TooltipContent>
                </Tooltip>
                {canNavigate && (
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={handleSearchInReader}
                        disabled={searching}
                        className="size-7 flex-shrink-0 rounded-full px-2 text-xs"
                      >
                        {searching ? (
                          <>
                            <Loader className="h-3 w-3 animate-spin" />
                          </>
                        ) : (
                          <>
                            <SquareArrowOutUpRight className="h-3 w-3" />
                          </>
                        )}
                      </Button>
                    </TooltipTrigger>
                    <TooltipContent side="bottom">查看原文</TooltipContent>
                  </Tooltip>
                )}
              </div>
            </div>

            <div className="flex-1 overflow-auto p-3 pt-0">
              <div className="prose prose-sm prose-neutral dark:prose-invert max-w-none text-foreground text-sm leading-relaxed">
                <DeferredMarkdown text={chunkData.chunk_text} />
              </div>
            </div>
          </div>
        ) : (
          <div className="whitespace-nowrap p-3 text-muted-foreground text-sm">未找到原文片段，可能已重新向量化</div>
        )}
      </PopoverContent>
    </Popover>
  );
}

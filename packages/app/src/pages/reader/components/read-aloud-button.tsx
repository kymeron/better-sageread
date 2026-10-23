import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { Loader2, Square, Volume2 } from "lucide-react";
import { useReadAloud } from "../hooks/use-read-aloud";

const LABELS = {
  idle: "从当前页开始朗读",
  loading: "正在合成语音…",
  playing: "停止朗读",
} as const;

/** 正文右下角的朗读入口：从当前页可见位置读起，再点一次停止 */
export default function ReadAloudButton() {
  const { state, toggle } = useReadAloud();

  return (
    <div className="absolute right-3 bottom-3 z-40">
      <Tooltip>
        <TooltipTrigger asChild>
          <Button
            type="button"
            variant="secondary"
            size="icon"
            aria-label={LABELS[state]}
            className="size-9 rounded-full border bg-background/90 shadow-md backdrop-blur hover:bg-accent"
            onClick={(event) => {
              // 容器上的 onClick 会翻页，朗读按钮不能透传
              event.stopPropagation();
              void toggle();
            }}
            onMouseDown={(event) => event.stopPropagation()}
          >
            {state === "loading" ? (
              <Loader2 className="size-4 animate-spin" />
            ) : state === "playing" ? (
              <Square className="size-4" />
            ) : (
              <Volume2 className="size-4" />
            )}
          </Button>
        </TooltipTrigger>
        <TooltipContent side="left">{LABELS[state]}</TooltipContent>
      </Tooltip>
    </div>
  );
}

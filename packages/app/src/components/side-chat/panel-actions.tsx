import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { History, ListChecks, MessageCirclePlus } from "lucide-react";

interface PanelActionsProps {
  /** 有消息且未在看历史列表时才显示"选择导出" */
  showSelection?: boolean;
  selectionMode?: boolean;
  onToggleSelection?: () => void;
  onNewThread: () => void;
  onShowThreads: () => void;
}

/** 对话面板操作组（选择导出 / 新对话 / 历史对话）：渲染在输入框顶行右侧。
 *  2026-10-22 从面板头部下移——头部整行腾给消息区，模型回复能多显示几行 */
export function PanelActions({
  showSelection = false,
  selectionMode = false,
  onToggleSelection,
  onNewThread,
  onShowThreads,
}: PanelActionsProps) {
  return (
    <div className="flex shrink-0 items-center gap-0.5">
      {showSelection && (
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              variant="ghost"
              size="icon"
              className={`size-7 shrink-0 rounded-full hover:bg-accent dark:hover:bg-accent ${
                selectionMode ? "bg-accent dark:bg-accent" : ""
              }`}
              onClick={onToggleSelection}
            >
              <ListChecks className="size-4" />
            </Button>
          </TooltipTrigger>
          <TooltipContent side="top">选择导出</TooltipContent>
        </Tooltip>
      )}
      <Tooltip>
        <TooltipTrigger asChild>
          <Button
            variant="ghost"
            size="icon"
            className="size-7 shrink-0 rounded-full hover:bg-accent dark:hover:bg-accent"
            onClick={onNewThread}
          >
            <MessageCirclePlus className="size-4" />
          </Button>
        </TooltipTrigger>
        <TooltipContent side="top">新对话</TooltipContent>
      </Tooltip>
      <Tooltip>
        <TooltipTrigger asChild>
          <Button
            variant="ghost"
            size="icon"
            className="size-7 shrink-0 rounded-full hover:bg-accent dark:hover:bg-accent"
            onClick={onShowThreads}
          >
            <History className="size-4" />
          </Button>
        </TooltipTrigger>
        <TooltipContent side="top">历史对话</TooltipContent>
      </Tooltip>
    </div>
  );
}

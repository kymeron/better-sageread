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

/** 对话面板操作组（选择导出 / 新对话 / 历史对话）：渲染在面板头部右上角（论文面板与书籍侧栏共用） */
export function PanelActions({
  showSelection = false,
  selectionMode = false,
  onToggleSelection,
  onNewThread,
  onShowThreads,
}: PanelActionsProps) {
  return (
    <div className="flex flex-shrink-0 items-center gap-0">
      {showSelection && (
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              variant="ghost"
              size="icon"
              className={`z-40 size-7 shrink-0 rounded-full hover:bg-accent dark:hover:bg-accent ${
                selectionMode ? "bg-accent dark:bg-accent" : ""
              }`}
              onClick={onToggleSelection}
            >
              <ListChecks className="h-5 w-5" />
            </Button>
          </TooltipTrigger>
          <TooltipContent side="bottom">选择导出</TooltipContent>
        </Tooltip>
      )}
      <Tooltip>
        <TooltipTrigger asChild>
          <Button
            variant="ghost"
            size="icon"
            className="z-40 size-7 shrink-0 rounded-full hover:bg-accent dark:hover:bg-accent"
            onClick={onNewThread}
          >
            <MessageCirclePlus className="h-5 w-5" />
          </Button>
        </TooltipTrigger>
        <TooltipContent side="bottom">新对话</TooltipContent>
      </Tooltip>
      <Tooltip>
        <TooltipTrigger asChild>
          <Button
            variant="ghost"
            size="icon"
            className="z-40 size-7 shrink-0 rounded-full hover:bg-accent dark:hover:bg-accent"
            onClick={onShowThreads}
          >
            <History className="h-5 w-5" />
          </Button>
        </TooltipTrigger>
        <TooltipContent side="bottom">历史对话</TooltipContent>
      </Tooltip>
    </div>
  );
}

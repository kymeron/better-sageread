import { X } from "lucide-react";
import { useReaderStore } from "./reader-provider";
import TOCView from "./toc-view";

/**
 * 桌面端固定目录侧栏：点击 header 的目录按钮后常驻在正文左侧（挤压正文宽度，不再浮层覆盖），
 * 选中条目后保持展开，由 header 按钮或侧栏关闭按钮收起。
 */
export default function TOCSidebar() {
  const bookId = useReaderStore((state) => state.bookId);
  const bookDoc = useReaderStore((state) => state.bookData?.bookDoc);
  const setOpenDropdown = useReaderStore((state) => state.setOpenDropdown);

  if (!bookId) return null;

  return (
    <aside
      aria-label="目录"
      className="flex h-full w-[220px] shrink-0 flex-col overflow-hidden rounded-l-md border-r bg-background"
    >
      <div className="flex h-10 shrink-0 items-center justify-between border-b px-3">
        <span className="font-medium text-neutral-800 text-sm dark:text-neutral-200">目录</span>
        <button
          type="button"
          aria-label="收起目录"
          className="flex size-6 cursor-pointer items-center justify-center rounded-full text-neutral-500 outline-none hover:bg-accent hover:text-neutral-800 dark:hover:text-neutral-200"
          onClick={() => setOpenDropdown?.(null)}
        >
          <X className="size-4" />
        </button>
      </div>
      <div className="min-h-0 flex-1 overflow-hidden">
        {bookDoc?.toc ? (
          <TOCView toc={bookDoc.toc} bookId={bookId} autoExpand={true} isVisible={true} />
        ) : (
          <div className="p-4 text-center text-muted-foreground text-sm">没有可用的目录</div>
        )}
      </div>
    </aside>
  );
}

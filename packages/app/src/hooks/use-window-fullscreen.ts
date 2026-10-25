import { getOSPlatform } from "@/utils/misc";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { useEffect, useState } from "react";

/**
 * 系统全屏状态（macOS 全屏时交通灯隐藏，窗口顶栏不再需要为其预留左侧空白）。
 * 进入/退出全屏会触发窗口 resize，故在 resize 时回查（留 120ms 缓冲，等窗口状态落定）。
 * 非 Tauri 环境（浏览器预览）或取值失败时按非全屏处理。
 */
export function useWindowFullscreen(): boolean {
  const [isFullscreen, setIsFullscreen] = useState(false);

  useEffect(() => {
    // Windows 顶栏没有交通灯预留，无需订阅
    if (getOSPlatform() === "windows") return;

    let disposed = false;
    let unlisten: (() => void) | null = null;
    let timer: number | null = null;

    let win: ReturnType<typeof getCurrentWindow> | null = null;
    try {
      win = getCurrentWindow();
    } catch {
      return;
    }
    const currentWindow = win;

    const sync = () => {
      if (timer) window.clearTimeout(timer);
      timer = window.setTimeout(() => {
        currentWindow
          .isFullscreen()
          .then((full) => {
            if (!disposed) setIsFullscreen(full);
          })
          .catch(() => {});
      }, 120);
    };

    sync();
    currentWindow
      .onResized(sync)
      .then((fn) => {
        if (disposed) fn();
        else unlisten = fn;
      })
      .catch(() => {});

    return () => {
      disposed = true;
      if (timer) window.clearTimeout(timer);
      unlisten?.();
    };
  }, []);

  return isFullscreen;
}

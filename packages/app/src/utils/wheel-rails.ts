/**
 * 滑轨（可滚动的公式 / 表格）上的滚轮语义，阅读器 iframe、对话区、论文区共用：
 * - 鼠标在滑轨上：优先让滑轨自己消化滚轮——表格先纵向（有纵向溢出时），公式与无纵向溢出的表格把竖直滚轮
 *   换算成横向滚动（鼠标没有横向滚轮，否则这类滑轨只能拖动）；
 * - 滑轨滚到头：若刚刚还在滚它（SWALLOW_MS 内），吞掉该事件，避免一路滚过去突然翻页 / 带动外层滚动；
 *   停顿后的下一次滚轮才放行给外层（翻页或滚动页面）；
 * - 触控板斜向滚动（dx、dy 同时非零）且滑轨双向溢出：两轴同时响应。
 * 注意：document 级 wheel 监听默认被动，preventDefault 无效——调用方必须以 { passive: false } 注册。
 */

const SWALLOW_MS = 320;

export interface WheelRailState {
  /** 最近一次滑轨消化滚轮的时刻 */
  at: number;
}

export const createWheelRailState = (): WheelRailState => ({ at: 0 });

const isScrollable = (value: string) => value === "auto" || value === "scroll";

/** 返回 true = 事件已被滑轨消化（或被吞掉），调用方不应再把它当作翻页 / 外层滚动 */
export function handleRailWheel(event: WheelEvent, rail: HTMLElement, state: WheelRailState): boolean {
  const view = rail.ownerDocument.defaultView;
  if (!view) return false;
  const style = view.getComputedStyle(rail);
  const scale = event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? rail.clientHeight : 1;
  const dx = event.deltaX * scale;
  const dy = event.deltaY * scale;
  if (dx === 0 && dy === 0) return false;

  const hasX = isScrollable(style.overflowX) && rail.scrollWidth > rail.clientWidth + 1;
  const hasY = isScrollable(style.overflowY) && rail.scrollHeight > rail.clientHeight + 1;
  if (!hasX && !hasY) return false;

  const xFwd = rail.scrollLeft + rail.clientWidth < rail.scrollWidth - 1;
  const xBack = rail.scrollLeft > 0;
  const yFwd = rail.scrollTop + rail.clientHeight < rail.scrollHeight - 1;
  const yBack = rail.scrollTop > 0;
  const now = performance.now();
  const consumed = () => {
    state.at = now;
    return true;
  };

  if (dx !== 0 && dy !== 0 && hasX && hasY) {
    const xOk = (dx > 0 && xFwd) || (dx < 0 && xBack);
    const yOk = (dy > 0 && yFwd) || (dy < 0 && yBack);
    if (xOk || yOk) {
      event.preventDefault();
      rail.scrollLeft += dx;
      rail.scrollTop += dy;
      return consumed();
    }
  } else if (Math.abs(dy) >= Math.abs(dx)) {
    if (hasY) {
      // 纵向有溢出：交给原生纵向滚动
      if ((dy > 0 && yFwd) || (dy < 0 && yBack)) return consumed();
    } else if (hasX && ((dy > 0 && xFwd) || (dy < 0 && xBack))) {
      event.preventDefault();
      rail.scrollLeft += dy;
      return consumed();
    }
  } else if (hasX && ((dx > 0 && xFwd) || (dx < 0 && xBack))) {
    return consumed(); // 横向滚轮：原生即可
  }

  if (now - state.at < SWALLOW_MS) {
    // 吞掉也刷新计时：只要还在持续滚动就一直留在滑轨上，停顿 ≥ SWALLOW_MS 后的下一次滚轮才放行
    event.preventDefault();
    state.at = now;
    return true;
  }
  return false;
}

/**
 * 给一个 Document 安装滑轨滚轮（对话区 / 论文区所在的宿主文档用）。
 * 命中 selector 的最近祖先作为滑轨；返回卸载函数。
 */
export function installRailWheel(doc: Document, selector: string): () => void {
  const state = createWheelRailState();
  const onWheel = (event: WheelEvent) => {
    if (event.ctrlKey) return; // 捏合缩放
    const rail = (event.target as Element | null)?.closest?.(selector) as HTMLElement | null;
    if (!rail) return;
    handleRailWheel(event, rail, state);
  };
  doc.addEventListener("wheel", onWheel, { passive: false, capture: true });
  return () => doc.removeEventListener("wheel", onWheel, true);
}

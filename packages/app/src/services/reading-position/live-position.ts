import type { RawReadingPosition } from "@/types/reading-position";

/**
 * 活阅读位置注册表（2026-10-20）。
 *
 * 渲染层（书籍 side-chat / 论文 chat panel）把最新位置写进来，提示词组装
 * （custom-chat-transport 的动态段）与 Agent 工具（getReadingPosition /
 * readAtReadingPosition）从这里读——避免把位置对象一路 prop 穿过 chat 状态。
 *
 * 仅保存"最新一条"，写入方负责在 scope 切换/关闭时用 clear 清理。
 * 不触发 React 渲染（消费方都在发送/工具调用的瞬时取快照），故不引入 store。
 */

const positions = new Map<string, RawReadingPosition>();

const keyOf = (scope: RawReadingPosition["scope"], id: string) => `${scope}:${id}`;

export function setLiveReadingPosition(pos: RawReadingPosition): void {
  positions.set(keyOf(pos.scope, pos.scope === "reader" ? pos.bookId : pos.paperId), pos);
}

export function clearLiveReadingPosition(scope: RawReadingPosition["scope"], id: string): void {
  positions.delete(keyOf(scope, id));
}

/** 取当前 scope + 文档 id 的活位置；不存在返回 null */
export function getLiveReadingPosition(
  scope: "reader",
  bookId: string,
): Extract<RawReadingPosition, { scope: "reader" }> | null;
export function getLiveReadingPosition(
  scope: "paper",
  paperId: string,
): Extract<RawReadingPosition, { scope: "paper" }> | null;
export function getLiveReadingPosition(scope: RawReadingPosition["scope"], id: string): RawReadingPosition | null {
  return positions.get(keyOf(scope, id)) ?? null;
}

/** 调试/单测用：清空全部 */
export function resetLiveReadingPositions(): void {
  positions.clear();
}

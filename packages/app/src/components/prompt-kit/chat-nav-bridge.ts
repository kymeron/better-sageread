import { type MutableRefObject, createContext } from "react";

/**
 * 聊天导航桥：ChatMessages 注册 ensureVisible（把目标消息挂进渲染窗口），消息导航条调用。
 * 两者同为 ChatContainerRoot 的后代，经 ref 通信而不经 state，避免流式期间引发额外重渲染。
 */
export interface ChatNavBridge {
  ensureVisible?: (messageId: string) => void;
}

export const ChatNavBridgeContext = createContext<MutableRefObject<ChatNavBridge> | null>(null);

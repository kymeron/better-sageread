import { createContext, useContext } from "react";
import { useStore } from "zustand";
import type { ReaderState, ReaderStore } from "../store/create-reader-store";

const ReaderStoreContext = createContext<ReaderStore | null>(null);

export function ReaderProvider({
  store,
  children,
}: {
  store: ReaderStore;
  children: React.ReactNode;
}) {
  return <ReaderStoreContext.Provider value={store}>{children}</ReaderStoreContext.Provider>;
}

export function useReaderStore<T>(selector: (state: ReaderState) => T): T | null {
  const store = useContext(ReaderStoreContext);

  if (!store) {
    return null;
  }

  return useStore(store, selector);
}

export function useReaderStoreApi(): ReaderStore {
  const store = useContext(ReaderStoreContext);

  if (!store) {
    throw new Error("useReaderStoreApi must be used within ReaderProvider");
  }

  return store;
}

/** 不抛错版：无 Provider 时返回 null。给"只在事件里读状态"的组件用，免去订阅高频字段（如阅读进度）引发的重渲染 */
export function useOptionalReaderStoreApi(): ReaderStore | null {
  return useContext(ReaderStoreContext);
}

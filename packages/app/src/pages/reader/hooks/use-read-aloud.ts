import { addExternalAudioStopListener, audioPlayerManager, synthesizeSpeechChunked } from "@/services/tts-service";
import { useTTSStore } from "@/store/tts-store";
import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { useReaderStore, useReaderStoreApi } from "../components/reader-provider";
import { extractReadableTextFromCurrentPage } from "../utils/read-aloud-text";

export type ReadAloudState = "idle" | "loading" | "playing";

/**
 * 正文朗读：从当前页可见起点读起，边合成边播放（分片串行入队）。
 * 独立播放器实例，避免与聊天区的 audioPlayerManager 队列互相覆盖；两者通过
 * addExternalAudioStopListener 互斥，任一方开始播放时打断另一方。
 */
export function useReadAloud() {
  const store = useReaderStoreApi();
  const [state, setState] = useState<ReadAloudState>("idle");

  const audioRef = useRef<HTMLAudioElement | null>(null);
  const queueRef = useRef<string[]>([]);
  const indexRef = useRef(0);
  const playingRef = useRef(false);
  const finishedRef = useRef(false);
  const runIdRef = useRef(0);

  const sectionIndex = useReaderStore((s) => s?.progress?.sectionIndex ?? null);
  const lastSectionRef = useRef<number | null>(null);

  const stop = useCallback(() => {
    runIdRef.current += 1;
    queueRef.current = [];
    indexRef.current = 0;
    playingRef.current = false;
    finishedRef.current = false;

    const audio = audioRef.current;
    audioRef.current = null;
    if (audio) {
      audio.onended = null;
      audio.onerror = null;
      audio.pause();
    }
    setState("idle");
  }, []);

  const playNext = useCallback((runId: number) => {
    if (runId !== runIdRef.current) return;

    const url = queueRef.current[indexRef.current];
    if (!url) {
      playingRef.current = false;
      audioRef.current = null;
      // 合成已结束且队列播放完毕 → 回到空闲
      if (finishedRef.current) setState("idle");
      return;
    }

    indexRef.current += 1;
    const audio = new Audio(url);
    audioRef.current = audio;
    playingRef.current = true;
    audio.onended = () => playNext(runId);
    audio.onerror = () => playNext(runId);
    setState("playing");
    void audio.play().catch(() => playNext(runId));
  }, []);

  const toggle = useCallback(async () => {
    if (state !== "idle") {
      stop();
      return;
    }

    const ttsConfig = useTTSStore.getState().config;
    if (!ttsConfig.apiKey.trim()) {
      toast.error("请先在设置 → 语音模型中配置 API Key");
      return;
    }

    const view = store.getState().view;
    if (!view) {
      toast.error("书籍尚未加载完成");
      return;
    }

    const text = extractReadableTextFromCurrentPage(view, store.getState().progress);
    if (!text.trim()) {
      toast.error("未找到可朗读的文本");
      return;
    }

    // 清理上一轮并开启新一轮（stop 自增 runId，旧回调随即失效）
    stop();
    const runId = runIdRef.current;
    setState("loading");
    audioPlayerManager.stop();

    try {
      await synthesizeSpeechChunked({
        text,
        onChunkReady: (url) => {
          if (runId !== runIdRef.current) return false;
          queueRef.current.push(url);
          if (!playingRef.current) playNext(runId);
          return true;
        },
      });

      if (runId !== runIdRef.current) return;
      finishedRef.current = true;
      if (!playingRef.current) playNext(runId);
    } catch (error) {
      if (runId !== runIdRef.current) return;
      stop();
      toast.error(`语音朗读失败：${error instanceof Error ? error.message : String(error)}`);
    }
  }, [state, stop, playNext, store]);

  // 聊天区朗读开始时打断正文朗读
  useEffect(() => addExternalAudioStopListener(stop), [stop]);

  // 卸载时释放音频
  useEffect(() => () => stop(), [stop]);

  // 切章自动停止（同章翻页继续朗读）
  useEffect(() => {
    if (lastSectionRef.current === null) {
      lastSectionRef.current = sectionIndex;
      return;
    }
    if (sectionIndex !== lastSectionRef.current) {
      lastSectionRef.current = sectionIndex;
      stop();
    }
  }, [sectionIndex, stop]);

  return { state, toggle, stop } as const;
}

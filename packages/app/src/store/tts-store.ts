import { create } from "zustand";
import { persist } from "zustand/middleware";

export type TTSProvider = "dashscope" | "minimax";

/** 各服务商的默认模型/音色（切换服务商时回落到该服务商的默认值） */
export const TTS_PROVIDER_DEFAULTS: Record<TTSProvider, { label: string; model: string; voice: string }> = {
  dashscope: { label: "阿里云 DashScope", model: "qwen3-tts-flash", voice: "Cherry" },
  minimax: { label: "MiniMax", model: "speech-2.8-hd", voice: "male-qn-qingse" },
};

export const TTS_PROVIDERS = Object.entries(TTS_PROVIDER_DEFAULTS).map(([value, { label }]) => ({
  value: value as TTSProvider,
  label,
}));

export interface TTSConfig {
  /** TTS 服务商：dashscope（qwen3-tts-flash）/ minimax（speech-2.8） */
  provider: TTSProvider;
  apiKey: string;
  /** 模型名，如 qwen3-tts-flash / speech-2.8-hd / speech-2.8-turbo */
  model: string;
  voice: string;
  languageType: string;
}

interface TTSStore {
  config: TTSConfig;
  setApiKey: (apiKey: string) => void;
  setProvider: (provider: TTSProvider) => void;
  setModel: (model: string) => void;
  setVoice: (voice: string) => void;
  setLanguageType: (languageType: string) => void;
  setConfig: (config: Partial<TTSConfig>) => void;
}

const DEFAULT_CONFIG: TTSConfig = {
  provider: "dashscope",
  apiKey: "",
  model: TTS_PROVIDER_DEFAULTS.dashscope.model,
  voice: TTS_PROVIDER_DEFAULTS.dashscope.voice,
  languageType: "Chinese",
};

export const useTTSStore = create<TTSStore>()(
  persist(
    (set) => ({
      config: DEFAULT_CONFIG,
      setApiKey: (apiKey) =>
        set((state) => ({
          config: { ...state.config, apiKey },
        })),
      setProvider: (provider) =>
        set((state) => {
          if (state.config.provider === provider) return state;
          const defaults = TTS_PROVIDER_DEFAULTS[provider];
          return {
            // apiKey 按服务商分别存放于 keyring，切换时先清空内存值，由设置页重新载入
            config: { ...state.config, provider, apiKey: "", model: defaults.model, voice: defaults.voice },
          };
        }),
      setModel: (model) =>
        set((state) => ({
          config: { ...state.config, model },
        })),
      setVoice: (voice) =>
        set((state) => ({
          config: { ...state.config, voice },
        })),
      setLanguageType: (languageType) =>
        set((state) => ({
          config: { ...state.config, languageType },
        })),
      setConfig: (config) =>
        set((state) => ({
          config: { ...state.config, ...config },
        })),
    }),
    {
      name: "tts-config-storage",
      // 老版本落盘数据只有 apiKey/voice/languageType，合并默认值补齐 provider/model
      merge: (persisted, current) => {
        const persistedState = (persisted ?? {}) as Partial<TTSStore>;
        const persistedConfig = (persistedState.config ?? {}) as Partial<TTSConfig>;
        return {
          ...current,
          ...persistedState,
          config: { ...DEFAULT_CONFIG, ...current.config, ...persistedConfig },
        };
      },
      partialize: (state) => ({
        // 安全（批次 A）：apiKey 由 keyring 保管（启动时载入内存），localStorage 不含密钥
        config: { ...state.config, apiKey: "" },
      }),
    },
  ),
);

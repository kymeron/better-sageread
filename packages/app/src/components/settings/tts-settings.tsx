import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { secretGetForRuntime } from "@/services/secret-service";
import { synthesizeSpeech } from "@/services/tts-service";
import { type TTSProvider, TTS_PROVIDERS, useTTSStore } from "@/store/tts-store";
import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import SecretInput from "./secret-input";

const TTS_MODEL_OPTIONS: Record<TTSProvider, { value: string; label: string }[]> = {
  dashscope: [{ value: "qwen3-tts-flash", label: "qwen3-tts-flash - 通义千问语音合成" }],
  minimax: [
    { value: "speech-2.8-hd", label: "speech-2.8-hd - Speech 2.8 音质优先" },
    { value: "speech-2.8-turbo", label: "speech-2.8-turbo - Speech 2.8 速度优先" },
    { value: "speech-2.6-hd", label: "speech-2.6-hd - Speech 2.6 音质优先" },
    { value: "speech-2.6-turbo", label: "speech-2.6-turbo - Speech 2.6 速度优先" },
  ],
};

const DASHSCOPE_VOICES: { value: string; label: string }[] = [
  { value: "Cherry", label: "芊悦 Cherry - 阳光积极、亲切自然" },
  { value: "Ethan", label: "晨煦 Ethan - 阳光温暖、活力朝气" },
  { value: "Nofish", label: "不吃鱼 Nofish - 不会翘舌音的设计师" },
  { value: "Ryan", label: "甜茶 Ryan - 节奏拉满、戏感炸裂" },
  { value: "Katerina", label: "卡捷琳娜 Katerina - 御姐音色" },
  { value: "Dylan", label: "北京-晓东 Dylan - 北京胡同少年" },
  { value: "Sunny", label: "四川-晴儿 Sunny - 甜到心里的川妹子" },
  { value: "Peter", label: "天津-李彼得 Peter - 天津相声、专业捧人" },
  { value: "Rocky", label: "粤语-阿强 Rocky - 幽默风趣、在线陪聊" },
  { value: "Kiki", label: "粤语-阿清 Kiki - 甜美的港妹闺蜜" },
];

/** MiniMax 常用系统音色（也可直接粘贴自定义/克隆音色 ID） */
const MINIMAX_VOICE_PRESETS: { value: string; label: string }[] = [
  { value: "male-qn-qingse", label: "青涩青年" },
  { value: "male-qn-jingying", label: "精英青年" },
  { value: "male-qn-badao", label: "霸道青年" },
  { value: "female-shaonv", label: "少女" },
  { value: "female-yujie", label: "御姐" },
  { value: "female-chengshu", label: "成熟女性" },
  { value: "female-tianmei", label: "甜美女性" },
];

const API_KEY_HINT: Record<TTSProvider, string> = {
  dashscope: "DashScope API Key，用于调用阿里云通义千问 TTS 服务",
  minimax: "MiniMax API Key（账户管理 > 接口密钥），用于调用 Speech 2.8 语音合成",
};

const DEFAULT_TEST_TEXT = "你好，这是一段语音合成测试，用来确认当前音色与参数是否正常。";

type TestState = "idle" | "loading" | "playing";

export default function TTSSettings() {
  const { config, setApiKey, setProvider, setModel, setVoice, setLanguageType } = useTTSStore();
  const provider = config.provider;
  const isFirstLoad = useRef(true);

  const [testText, setTestText] = useState(DEFAULT_TEST_TEXT);
  const [testState, setTestState] = useState<TestState>("idle");
  const testAudioRef = useRef<HTMLAudioElement | null>(null);
  const testRunIdRef = useRef(0);

  const stopTestAudio = useCallback(() => {
    testRunIdRef.current++;
    if (testAudioRef.current) {
      testAudioRef.current.pause();
      testAudioRef.current = null;
    }
    setTestState("idle");
  }, []);

  // 卸载时释放音频
  useEffect(() => () => stopTestAudio(), [stopTestAudio]);

  // 服务商/模型/音色变更时停止试听，避免继续播放旧配置合成的音频
  const changeProvider = (value: TTSProvider) => {
    stopTestAudio();
    setProvider(value);
  };
  const changeModel = (value: string) => {
    stopTestAudio();
    setModel(value);
  };
  const changeVoice = (value: string) => {
    stopTestAudio();
    setVoice(value);
  };

  const handleTest = async () => {
    if (testState !== "idle") {
      stopTestAudio();
      return;
    }

    const text = testText.trim();
    if (!text) {
      toast.error("请输入试听文本");
      return;
    }
    if (!config.apiKey.trim()) {
      toast.error("请先配置 API Key");
      return;
    }

    const runId = ++testRunIdRef.current;
    setTestState("loading");
    try {
      const url = await synthesizeSpeech({ text });
      if (runId !== testRunIdRef.current) return;

      const audio = new Audio(url);
      testAudioRef.current = audio;
      audio.onended = () => {
        testAudioRef.current = null;
        setTestState("idle");
      };
      audio.onerror = () => {
        testAudioRef.current = null;
        setTestState("idle");
        toast.error("音频播放失败");
      };
      await audio.play();
      if (runId !== testRunIdRef.current) {
        audio.pause();
        return;
      }
      setTestState("playing");
    } catch (error) {
      if (runId !== testRunIdRef.current) return;
      testAudioRef.current = null;
      setTestState("idle");
      toast.error(`语音测试失败：${error instanceof Error ? error.message : String(error)}`);
    }
  };

  const testButtonLabel = testState === "loading" ? "合成中…" : testState === "playing" ? "停止" : "试听";

  // 切换服务商时从 keyring 载入对应 API Key（首次挂载由 secret-init 负责，不重复清空）
  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      if (!isFirstLoad.current) setApiKey("");
      isFirstLoad.current = false;
      try {
        const key = await secretGetForRuntime("tts", provider);
        if (!cancelled && key) setApiKey(key);
      } catch {
        // keyring 不可用时保持内存值
      }
    };
    load();
    return () => {
      cancelled = true;
    };
  }, [provider, setApiKey]);

  return (
    <div className="space-y-4 p-4 pt-3">
      <section className="rounded-lg bg-muted/80 p-4 pt-3">
        <div>
          <h3 className="mb-4 font-medium text-base text-neutral-900 dark:text-neutral-100">语音模型配置</h3>
          <p className="mb-4 text-neutral-600 text-sm dark:text-neutral-400">配置文本转语音（TTS）服务的相关参数</p>
        </div>

        <div className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="tts-provider" className="text-sm">
              服务商
            </Label>
            <Select value={provider} onValueChange={(value) => changeProvider(value as TTSProvider)}>
              <SelectTrigger id="tts-provider" className="h-8">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {TTS_PROVIDERS.map((item) => (
                  <SelectItem key={item.value} value={item.value}>
                    {item.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <p className="text-neutral-500 text-xs dark:text-neutral-400">
              每个服务商的 API Key 独立保存，切换后自动载入
            </p>
          </div>

          <div className="space-y-2">
            <Label htmlFor="tts-api-key" className="text-sm">
              API Key
            </Label>
            {/* 批次 A：key 由 keyring 保管，不回显真值 */}
            <SecretInput
              key={provider}
              category="tts"
              secretKey={provider}
              id="tts-api-key"
              placeholder="sk-..."
              className="h-8 font-mono"
              onSaved={setApiKey}
              onCleared={() => setApiKey("")}
            />
            <p className="text-neutral-500 text-xs dark:text-neutral-400">{API_KEY_HINT[provider]}</p>
          </div>

          <div className="space-y-2">
            <Label htmlFor="tts-model" className="text-sm">
              模型
            </Label>
            <Select value={config.model} onValueChange={changeModel}>
              <SelectTrigger id="tts-model" className="h-8">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {TTS_MODEL_OPTIONS[provider].map((item) => (
                  <SelectItem key={item.value} value={item.value}>
                    {item.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-2">
            <Label htmlFor="tts-voice" className="text-sm">
              语音选择
            </Label>
            {provider === "dashscope" ? (
              <Select value={config.voice} onValueChange={changeVoice}>
                <SelectTrigger id="tts-voice" className="h-8">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {DASHSCOPE_VOICES.map((item) => (
                    <SelectItem key={item.value} value={item.value}>
                      {item.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            ) : (
              <>
                <Input
                  id="tts-voice"
                  list="minimax-voice-presets"
                  value={config.voice}
                  onChange={(e) => changeVoice(e.target.value)}
                  placeholder="male-qn-qingse"
                  className="h-8 font-mono"
                />
                <datalist id="minimax-voice-presets">
                  {MINIMAX_VOICE_PRESETS.map((item) => (
                    <option key={item.value} value={item.value}>
                      {item.label}
                    </option>
                  ))}
                </datalist>
                <p className="text-neutral-500 text-xs dark:text-neutral-400">
                  填 MiniMax Voice ID（如 male-qn-qingse、female-yujie），也可使用自己的克隆音色 ID
                </p>
              </>
            )}
          </div>

          <div className="space-y-2">
            <Label htmlFor="tts-language" className="text-sm">
              {provider === "minimax" ? "语言增强" : "语言类型"}
            </Label>
            <Select value={config.languageType} onValueChange={setLanguageType}>
              <SelectTrigger id="tts-language" className="h-8">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="Chinese">中文</SelectItem>
                <SelectItem value="English">英文</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-2">
            <Label htmlFor="tts-test-text" className="text-sm">
              语音测试
            </Label>
            <div className="flex items-center gap-2">
              <Input
                id="tts-test-text"
                value={testText}
                onChange={(e) => setTestText(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") handleTest();
                }}
                placeholder="输入一段试听文本"
                className="h-8"
              />
              <Button
                type="button"
                variant={testState === "idle" ? "default" : "secondary"}
                className="shrink-0"
                onClick={handleTest}
              >
                {testButtonLabel}
              </Button>
            </div>
            <p className="text-neutral-500 text-xs dark:text-neutral-400">
              用当前服务商、模型与音色合成一小段语音；试听会消耗少量额度
            </p>
          </div>
        </div>
      </section>
    </div>
  );
}

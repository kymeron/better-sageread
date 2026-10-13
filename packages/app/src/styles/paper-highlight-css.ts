/**
 * 论文阅读器 CSS Custom Highlight 的样式规则（搜索 / 标注 / 译文侧镜像），按高亮名分组。
 *
 * 为什么不写进 index.css：页面里每存在一条 `::highlight(name)` 规则，浏览器每次样式重算都要对每个元素
 * 多解析一次——不管这个名字有没有注册。实测 46 条常驻规则让 2 万元素的页面一次整页重算要 2.1s
 * （Radix 弹窗开合会连续强制好几次重算，引用预览因此卡 4 秒）。所以改为：某个高亮名被注册时才把它的规则
 * 放进 <style>，注销即撤。`paperHighlightRegistry` 是 CSS.highlights 的代理，paper-reader 经它读写。
 *
 * 五色与 services/constants.ts 的 HIGHLIGHT_COLOR_HEX 对齐（tailwind 400 色的 oklch 值）；
 * *-tgt 为英文标注经句对齐映射到译文区的镜像（与原名同色、透明度略低，用于区分"事实源侧"与"映射侧"）；
 * paper-anno-current 为侧栏定位的闪烁强调。underline / squiggly 为笔触变体（::highlight 支持 text-decoration）。
 */
const PAPER_HIGHLIGHT_RULES: Record<string, string> = {
  "paper-search":
    "::highlight(paper-search) {\n  background-color: oklch(0.86 0.14 90 / 0.7);\n}\n.dark ::highlight(paper-search) {\n  background-color: oklch(0.6 0.13 85 / 0.65);\n}",
  "paper-search-current":
    "::highlight(paper-search-current) {\n  background-color: oklch(0.75 0.17 70 / 0.85);\n}\n.dark ::highlight(paper-search-current) {\n  background-color: oklch(0.55 0.15 65 / 0.9);\n}",
  "paper-anno-red":
    "::highlight(paper-anno-red) {\n  background-color: oklch(0.704 0.191 22.216 / 0.4);\n}\n.dark ::highlight(paper-anno-red) {\n  background-color: oklch(0.704 0.191 22.216 / 0.5);\n}",
  "paper-anno-yellow":
    "::highlight(paper-anno-yellow) {\n  background-color: oklch(0.852 0.199 91.936 / 0.4);\n}\n.dark ::highlight(paper-anno-yellow) {\n  background-color: oklch(0.852 0.199 91.936 / 0.5);\n}",
  "paper-anno-green":
    "::highlight(paper-anno-green) {\n  background-color: oklch(0.792 0.209 151.711 / 0.4);\n}\n.dark ::highlight(paper-anno-green) {\n  background-color: oklch(0.792 0.209 151.711 / 0.5);\n}",
  "paper-anno-blue":
    "::highlight(paper-anno-blue) {\n  background-color: oklch(0.707 0.165 254.624 / 0.4);\n}\n.dark ::highlight(paper-anno-blue) {\n  background-color: oklch(0.707 0.165 254.624 / 0.5);\n}",
  "paper-anno-violet":
    "::highlight(paper-anno-violet) {\n  background-color: oklch(0.702 0.183 293.541 / 0.4);\n}\n.dark ::highlight(paper-anno-violet) {\n  background-color: oklch(0.702 0.183 293.541 / 0.5);\n}",
  "paper-anno-underline-red":
    "::highlight(paper-anno-underline-red) {\n  text-decoration-line: underline;\n  text-decoration-color: oklch(0.704 0.191 22.216);\n  text-decoration-thickness: 2px;\n}",
  "paper-anno-squiggly-red":
    "::highlight(paper-anno-squiggly-red) {\n  text-decoration-line: underline;\n  text-decoration-style: wavy;\n  text-decoration-color: oklch(0.704 0.191 22.216);\n  text-decoration-thickness: 2px;\n}",
  "paper-anno-underline-yellow":
    "::highlight(paper-anno-underline-yellow) {\n  text-decoration-line: underline;\n  text-decoration-color: oklch(0.852 0.199 91.936);\n  text-decoration-thickness: 2px;\n}",
  "paper-anno-squiggly-yellow":
    "::highlight(paper-anno-squiggly-yellow) {\n  text-decoration-line: underline;\n  text-decoration-style: wavy;\n  text-decoration-color: oklch(0.852 0.199 91.936);\n  text-decoration-thickness: 2px;\n}",
  "paper-anno-underline-green":
    "::highlight(paper-anno-underline-green) {\n  text-decoration-line: underline;\n  text-decoration-color: oklch(0.792 0.209 151.711);\n  text-decoration-thickness: 2px;\n}",
  "paper-anno-squiggly-green":
    "::highlight(paper-anno-squiggly-green) {\n  text-decoration-line: underline;\n  text-decoration-style: wavy;\n  text-decoration-color: oklch(0.792 0.209 151.711);\n  text-decoration-thickness: 2px;\n}",
  "paper-anno-underline-blue":
    "::highlight(paper-anno-underline-blue) {\n  text-decoration-line: underline;\n  text-decoration-color: oklch(0.707 0.165 254.624);\n  text-decoration-thickness: 2px;\n}",
  "paper-anno-squiggly-blue":
    "::highlight(paper-anno-squiggly-blue) {\n  text-decoration-line: underline;\n  text-decoration-style: wavy;\n  text-decoration-color: oklch(0.707 0.165 254.624);\n  text-decoration-thickness: 2px;\n}",
  "paper-anno-underline-violet":
    "::highlight(paper-anno-underline-violet) {\n  text-decoration-line: underline;\n  text-decoration-color: oklch(0.702 0.183 293.541);\n  text-decoration-thickness: 2px;\n}",
  "paper-anno-squiggly-violet":
    "::highlight(paper-anno-squiggly-violet) {\n  text-decoration-line: underline;\n  text-decoration-style: wavy;\n  text-decoration-color: oklch(0.702 0.183 293.541);\n  text-decoration-thickness: 2px;\n}",
  "paper-anno-current":
    "::highlight(paper-anno-current) {\n  background-color: oklch(0.75 0.17 70 / 0.85);\n}\n.dark ::highlight(paper-anno-current) {\n  background-color: oklch(0.55 0.15 65 / 0.9);\n}",
  "paper-anno-red-tgt":
    "::highlight(paper-anno-red-tgt) {\n  background-color: oklch(0.704 0.191 22.216 / 0.22);\n}\n.dark ::highlight(paper-anno-red-tgt) {\n  background-color: oklch(0.704 0.191 22.216 / 0.3);\n}",
  "paper-anno-yellow-tgt":
    "::highlight(paper-anno-yellow-tgt) {\n  background-color: oklch(0.852 0.199 91.936 / 0.22);\n}\n.dark ::highlight(paper-anno-yellow-tgt) {\n  background-color: oklch(0.852 0.199 91.936 / 0.3);\n}",
  "paper-anno-green-tgt":
    "::highlight(paper-anno-green-tgt) {\n  background-color: oklch(0.792 0.209 151.711 / 0.22);\n}\n.dark ::highlight(paper-anno-green-tgt) {\n  background-color: oklch(0.792 0.209 151.711 / 0.3);\n}",
  "paper-anno-blue-tgt":
    "::highlight(paper-anno-blue-tgt) {\n  background-color: oklch(0.707 0.165 254.624 / 0.22);\n}\n.dark ::highlight(paper-anno-blue-tgt) {\n  background-color: oklch(0.707 0.165 254.624 / 0.3);\n}",
  "paper-anno-violet-tgt":
    "::highlight(paper-anno-violet-tgt) {\n  background-color: oklch(0.702 0.183 293.541 / 0.22);\n}\n.dark ::highlight(paper-anno-violet-tgt) {\n  background-color: oklch(0.702 0.183 293.541 / 0.3);\n}",
  "paper-anno-underline-red-tgt":
    "::highlight(paper-anno-underline-red-tgt) {\n  text-decoration-line: underline;\n  text-decoration-color: oklch(0.704 0.191 22.216 / 0.55);\n  text-decoration-thickness: 2px;\n}",
  "paper-anno-squiggly-red-tgt":
    "::highlight(paper-anno-squiggly-red-tgt) {\n  text-decoration-line: underline;\n  text-decoration-style: wavy;\n  text-decoration-color: oklch(0.704 0.191 22.216 / 0.55);\n  text-decoration-thickness: 2px;\n}",
  "paper-anno-underline-yellow-tgt":
    "::highlight(paper-anno-underline-yellow-tgt) {\n  text-decoration-line: underline;\n  text-decoration-color: oklch(0.852 0.199 91.936 / 0.55);\n  text-decoration-thickness: 2px;\n}",
  "paper-anno-squiggly-yellow-tgt":
    "::highlight(paper-anno-squiggly-yellow-tgt) {\n  text-decoration-line: underline;\n  text-decoration-style: wavy;\n  text-decoration-color: oklch(0.852 0.199 91.936 / 0.55);\n  text-decoration-thickness: 2px;\n}",
  "paper-anno-underline-green-tgt":
    "::highlight(paper-anno-underline-green-tgt) {\n  text-decoration-line: underline;\n  text-decoration-color: oklch(0.792 0.209 151.711 / 0.55);\n  text-decoration-thickness: 2px;\n}",
  "paper-anno-squiggly-green-tgt":
    "::highlight(paper-anno-squiggly-green-tgt) {\n  text-decoration-line: underline;\n  text-decoration-style: wavy;\n  text-decoration-color: oklch(0.792 0.209 151.711 / 0.55);\n  text-decoration-thickness: 2px;\n}",
  "paper-anno-underline-blue-tgt":
    "::highlight(paper-anno-underline-blue-tgt) {\n  text-decoration-line: underline;\n  text-decoration-color: oklch(0.707 0.165 254.624 / 0.55);\n  text-decoration-thickness: 2px;\n}",
  "paper-anno-squiggly-blue-tgt":
    "::highlight(paper-anno-squiggly-blue-tgt) {\n  text-decoration-line: underline;\n  text-decoration-style: wavy;\n  text-decoration-color: oklch(0.707 0.165 254.624 / 0.55);\n  text-decoration-thickness: 2px;\n}",
  "paper-anno-underline-violet-tgt":
    "::highlight(paper-anno-underline-violet-tgt) {\n  text-decoration-line: underline;\n  text-decoration-color: oklch(0.702 0.183 293.541 / 0.55);\n  text-decoration-thickness: 2px;\n}",
  "paper-anno-squiggly-violet-tgt":
    "::highlight(paper-anno-squiggly-violet-tgt) {\n  text-decoration-line: underline;\n  text-decoration-style: wavy;\n  text-decoration-color: oklch(0.702 0.183 293.541 / 0.55);\n  text-decoration-thickness: 2px;\n}",
};

const STYLE_ID = "paper-highlight-css";
const active = new Set<string>();

function syncStyle(): void {
  const existing = document.getElementById(STYLE_ID);
  if (active.size === 0) {
    existing?.remove();
    return;
  }
  const css = [...active].map((name) => PAPER_HIGHLIGHT_RULES[name] ?? "").join("\n");
  if (existing) {
    if (existing.textContent !== css) existing.textContent = css;
    return;
  }
  const el = document.createElement("style");
  el.id = STYLE_ID;
  el.textContent = css;
  document.head.appendChild(el);
}

type HighlightRegistryLike = { set(name: string, value: unknown): unknown; delete(name: string): unknown };

/** CSS.highlights 的代理：注册时按需挂载该名的规则，注销时撤掉；不支持 Highlight API 时返回 undefined */
export function getPaperHighlightRegistry(): HighlightRegistryLike | undefined {
  const registry = (CSS as unknown as { highlights?: HighlightRegistryLike }).highlights;
  if (!registry) return undefined;
  return {
    set(name, value) {
      if (!active.has(name) && name in PAPER_HIGHLIGHT_RULES) {
        active.add(name);
        syncStyle();
      }
      return registry.set(name, value);
    },
    delete(name) {
      const r = registry.delete(name);
      if (active.delete(name)) syncStyle();
      return r;
    },
  };
}

// 阅读位置桥实盘验证（2026-10-20）：在 dev 实例（CDP 9223）上直调三个新 IPC 命令 + 前端 position-service，
// 用真实书库数据断言「foliate spine href → mdbook md 坐标 → 分块区间 → 按位置读原文」全链路。
// 前置：dev 实例在跑（CDP 9223 / localhost:1420），开发数据目录 com.bettersageread.dev 有已建 mdbook 的书。
import { existsSync } from "node:fs";
import { readdirSync, readFileSync, statSync } from "node:fs";

const APP_DATA = "C:/Users/20995/AppData/Roaming/com.bettersageread.dev";
const BOOKS = `${APP_DATA}/books`;

let failed = 0;
const ok = (cond, msg, detail) => {
  if (cond) console.log(`ok - ${msg}`);
  else {
    failed++;
    console.error(`FAIL - ${msg}${detail !== undefined ? ` | ${JSON.stringify(detail)}` : ""}`);
  }
};

/* ---------- 找真实测试数据 ---------- */
const bookDirs = readdirSync(BOOKS).filter((n) => !n.startsWith("__"));
const findMdSrcRoot = (dir) => {
  const mdbook = `${dir}/mdbook`;
  if (!existsSync(mdbook)) return null;
  for (const name of readdirSync(mdbook)) {
    const src = `${mdbook}/${name}/src`;
    if (existsSync(src) && readdirSync(src).some((f) => f.endsWith(".md"))) return src;
  }
  return null;
};
const walkMd = (dir, out = []) => {
  for (const name of readdirSync(dir)) {
    const p = `${dir}/${name}`;
    if (statSync(p).isDirectory()) walkMd(p, out);
    else if (name.endsWith(".md")) out.push(p);
  }
  return out;
};

/** 选一本已建 mdbook 的书：优先带 vectors.sqlite 的（验证分块区间），并优先正文章节而非 cover/back */
const candidates = [];
for (const id of bookDirs) {
  const dir = `${BOOKS}/${id}`;
  if (!existsSync(dir) || !statSync(dir).isDirectory()) continue;
  const src = findMdSrcRoot(dir);
  if (!src) continue;
  const mds = walkMd(src).filter((p) => !/SUMMARY\.md$/.test(p));
  if (mds.length === 0) continue;
  const rels = mds
    .map((mdAbs) => mdAbs.slice(src.length + 1).replace(/\\/g, "/"))
    .filter((rel) => /\.md$/i.test(rel));
  const rel =
    rels.find((r) => /chapter[_-]?0*1\.md$/i.test(r)) ??
    rels.find((r) => !/SUMMARY|nav|cover|back|front/i.test(r)) ??
    rels[0];
  if (!rel) continue;
  const mdAbs = `${src}/${rel}`;
  candidates.push({ id, dir, src, mdAbs, rel, indexed: existsSync(`${dir}/vectors.sqlite`) });
}
const readerCase = candidates.find((c) => c.indexed) ?? candidates[0];
if (!readerCase) throw new Error("找不到已建 mdbook 的书作为测试数据");

/** 选一篇带正文字数的论文 */
let paperCase = null;
for (const id of bookDirs) {
  const p = `${BOOKS}/${id}/paper.md`;
  if (existsSync(p)) {
    const md = readFileSync(p, "utf8");
    if (md.length > 2000) {
      paperCase = { id, md };
      break;
    }
  }
}
if (!paperCase) throw new Error("找不到论文 paper.md 作为测试数据");

const sectionHref = readerCase.rel.replace(/\.md$/i, ".xhtml");
const sectionFraction = 0.42;
console.log(`数据：书 ${readerCase.id} · md=${readerCase.rel} · indexed=${readerCase.indexed}；论文 ${paperCase.id} · paper.md ${paperCase.md.length} chars`);

/* ---------- CDP ---------- */
const list = await (await fetch("http://127.0.0.1:9223/json/list")).json();
const page = list.find((t) => t.type === "page" && t.url.includes("localhost:1420"));
if (!page) throw new Error("未找到 dev 页面（1420）");
const ws = new WebSocket(page.webSocketDebuggerUrl);
let mid = 0;
const pending = new Map();
const call = (method, params) => {
  const id = ++mid;
  const promise = new Promise((resolve) => pending.set(id, { resolve }));
  ws.send(JSON.stringify({ id, method, params }));
  return promise;
};
ws.onmessage = (e) => {
  const msg = JSON.parse(e.data);
  if (msg.id && pending.has(msg.id)) {
    pending.get(msg.id).resolve(msg.result);
    pending.delete(msg.id);
  }
};
await new Promise((r) => {
  ws.onopen = r;
});
const evalJS = async (expr) => {
  const r = await call("Runtime.evaluate", { expression: expr, awaitPromise: true, returnByValue: true });
  if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description ?? r.exceptionDetails.text);
  return r.result.value;
};

const t0 = Date.now();
const snap = await evalJS(`
  (async () => {
    const lp = await import("/src/services/reading-position/live-position.ts");
    const ps = await import("/src/services/reading-position/position-service.ts");
    lp.setLiveReadingPosition({
      scope: "reader",
      bookId: "${readerCase.id}",
      sectionIndex: 12,
      sectionHref: "${sectionHref}",
      sectionFraction: ${sectionFraction},
      locCurrent: 4200,
      locTotal: 10000,
      label: "第三章 测试章节",
      tocAvailable: true,
      cfi: "epubcfi(/6/26!/4/2/1:0)",
    });
    const snapshot = await ps.resolveLiveReadingPosition("reader", "${readerCase.id}");
    const prompt = snapshot ? ps.formatPositionForPrompt(snapshot) : null;
    const tool = snapshot ? ps.formatPositionForTool(snapshot) : null;
    let window = null;
    let windowErr = null;
    try {
      window = snapshot ? await ps.readPositionWindow(snapshot, { before: 600, after: 2000 }) : null;
    } catch (e) {
      windowErr = String(e);
    }
    return { snapshot, prompt, tool, window, windowErr };
  })()
`);
console.log(`[IPC] resolve+read 用时 ${Date.now() - t0}ms`);

ok(snap.snapshot != null, "resolve_reading_position 返回快照（mdbook 产物可用）", snap.snapshot);
if (snap.snapshot) {
  const s = snap.snapshot;
  ok(s.mdRelPath === readerCase.rel, `md 相对路径精确映射（${readerCase.rel}）`, s.mdRelPath);
  ok(s.mdLength > 0, "mdLength > 0", s.mdLength);
  ok(Math.abs(s.charOffset - Math.round(sectionFraction * s.mdLength)) <= 2, "charOffset ≈ fraction × mdLength", {
    charOffset: s.charOffset,
    expect: Math.round(sectionFraction * s.mdLength),
  });
  ok(Math.abs(s.percentInDoc - 42) < 0.5, "percentInDoc ≈ 42", s.percentInDoc);
  ok(s.spineIndex === 12, "spineIndex 透传", s.spineIndex);
  ok(s.label === "第三章 测试章节", "TOC label 透传", s.label);
  if (readerCase.indexed) {
    ok(s.chunkTotal != null && s.chunkRange != null, "已索引书返回估算分块区间", {
      chunkRange: s.chunkRange,
      chunkTotal: s.chunkTotal,
    });
    ok(s.chunkRange[0] >= 1 && s.chunkRange[1] <= s.chunkTotal, "分块区间在 [1, total] 内", s.chunkRange);
  } else {
    ok(s.chunkTotal == null, "未索引书无分块区间（indexed=false）", s.chunkTotal);
  }
  ok(typeof snap.prompt === "string" && snap.prompt.includes("【当前阅读位置】"), "提示词注入段格式正确");
  ok(typeof snap.prompt === "string" && snap.prompt.includes("以此为准"), "提示词含「以此为准」口径");
  ok(snap.prompt.length <= 600, "提示词位置段 ≤600 字符（缓存/预算）", snap.prompt.length);
  ok(snap.windowErr == null && snap.window != null && snap.window.text.length > 0, "read_position_window 返回正文", snap.windowErr);
  ok(snap.window != null && snap.window.totalLength === s.mdLength, "窗口 totalLength = mdLength", {
    total: snap.window?.totalLength,
    mdLength: s.mdLength,
  });
  ok(
    snap.window != null && snap.window.start >= 0 && snap.window.end > snap.window.start,
    "窗口区间有效",
    snap.window && [snap.window.start, snap.window.end],
  );
  console.log("---- 注入段预览 ----");
  console.log(snap.prompt);
  console.log("----");
}

/* ---------- 论文坐标 ---------- */
const paperDocLength = 20000;
const paperRes = await evalJS(`
  (async () => {
    const ps = await import("/src/services/reading-position/position-service.ts");
    try {
      const coords = await ps.resolveReadingPosition({
        scope: "paper",
        paperId: "${paperCase.id}",
        headingId: "introduction",
        headingText: "Introduction",
        headingLevel: 2,
        charOffset: ${paperDocLength * 0.3},
        docLength: ${paperDocLength},
        docFraction: 0.3,
        tocAvailable: true,
      });
      return { coords, err: null };
    } catch (e) {
      return { coords: null, err: String(e) };
    }
  })()
`);
ok(paperRes.err == null && paperRes.coords != null, "resolve_paper_position 返回快照", paperRes.err ?? paperRes.coords);
if (paperRes.coords) {
  const c = paperRes.coords;
  ok(c.mdRelPath === "paper.md", "论文 mdRelPath = paper.md", c.mdRelPath);
  ok(c.mdLength > 0 && c.charOffset > 0 && c.charOffset <= c.mdLength, "论文 charOffset ∈ (0, mdLength]", {
    charOffset: c.charOffset,
    mdLength: c.mdLength,
  });
  ok(Math.abs(c.percentInDoc - 30) < 1, "论文 percentInDoc ≈ 30（正文比例）", c.percentInDoc);
  ok(c.overallPercent != null && Math.abs(c.overallPercent - 30) < 1, "论文 overallPercent ≈ 30", c.overallPercent);
}

/* ---------- 错误路径：越界 href / 非法 rel_path 必须拒绝 ---------- */
const bad = await evalJS(`
  (async () => {
    const ps = await import("/src/services/reading-position/position-service.ts");
    // 服务层对坐标换算失败是"降级返回 null"（不阻塞聊天）；这里断言含 .. 的 href 不会返回坐标，
    // 即 Rust 命令侧确实拒绝了非法路径（否则会返回真实 md 坐标）。
    const degraded = await ps.resolveReadingPosition({
      scope: "reader",
      bookId: "${readerCase.id}",
      sectionIndex: 0,
      sectionHref: "../../etc/passwd.xhtml",
      sectionFraction: 0.1,
      locCurrent: 1,
      locTotal: 10,
      label: "",
      tocAvailable: false,
      cfi: "",
    });
    return { degraded };
  })()
`);
ok(bad.degraded == null, "含 .. 的 href 被拒绝（服务降级为 null，未返回坐标）", bad.degraded);

/* ---------- mdbook 缺失书的幂等转换（非向量化老书也能拿到坐标） ---------- */
const unindexed = bookDirs
  .map((id) => ({ id, dir: `${BOOKS}/${id}` }))
  .filter(({ dir }) => {
    if (!existsSync(dir) || !statSync(dir).isDirectory()) return false;
    if (existsSync(`${dir}/mdbook`)) return false;
    try {
      return readdirSync(dir).some((f) => f.toLowerCase().endsWith(".epub"));
    } catch {
      return false;
    }
  })
  .map((c) => {
    const epub = readdirSync(c.dir).find((f) => f.toLowerCase().endsWith(".epub"));
    return { ...c, size: statSync(`${c.dir}/${epub}`).size };
  })
  .sort((a, b) => a.size - b.size)[0];

if (!unindexed) {
  console.log("skip - 没有「有 EPUB 但无 mdbook」的书可用于转换路径验证");
} else {
  console.log(`转换路径用例：书 ${unindexed.id}（${(unindexed.size / 1024 / 1024).toFixed(1)}MB，无 mdbook）`);
  // 先用占位 href 触发 ensure（mdbook 缺失 → 命令内部幂等转换），再把真实 href 换上重试
  const first = await evalJS(`
    (async () => {
      const core = await import("/node_modules/.vite/deps/@tauri-apps_api_core.js");
      try {
        const r = await core.invoke("plugin:epub|resolve_reading_position", {
          bookId: "${unindexed.id}",
          sectionHref: "EPUB/chapter_001.xhtml",
          sectionFraction: 0.1,
          locCurrent: 1,
          locTotal: 10,
        });
        return { ok: true, r, err: null };
      } catch (e) {
        return { ok: false, r: null, err: String(e) };
      }
    })()
  `);
  ok(first.ok || /md|未找到|不存在/i.test(first.err ?? ""), "占位 href 触发 mdbook 转换（返回坐标或明确的 md 文件缺失错误）", first.err ?? first.r);

  // 等磁盘上 mdbook 产物出现（转换可能数秒）
  const deadline = Date.now() + 120_000;
  let src = null;
  while (Date.now() < deadline) {
    const dir = `${BOOKS}/${unindexed.id}`;
    if (existsSync(`${dir}/mdbook`)) {
      src = findMdSrcRoot(dir);
      if (src) break;
    }
    await new Promise((r) => setTimeout(r, 500));
  }
  ok(src != null, "mdbook 产物已由命令幂等转换生成", src);
  if (src) {
    const mds = walkMd(src).filter((p) => !/SUMMARY\.md$/i.test(p));
    const rel = (mds[0] ?? "").slice(src.length + 1).replace(/\\/g, "/");
    ok(mds.length > 0 && rel.length > 0, "转换产物含可映射 md 文件", { count: mds.length, rel });
    if (rel) {
      const second = await evalJS(`
        (async () => {
          const core = await import("/node_modules/.vite/deps/@tauri-apps_api_core.js");
          const sectionHref = "${rel}".replace(/\.md$/i, ".xhtml");
          try {
            const coords = await core.invoke("plugin:epub|resolve_reading_position", {
              bookId: "${unindexed.id}",
              sectionHref,
              sectionFraction: 0.3,
              locCurrent: 3,
              locTotal: 10,
            });
            const win = await core.invoke("plugin:epub|read_position_window", {
              kind: "book",
              id: "${unindexed.id}",
              relPath: coords.mdRelPath,
              offset: 0,
              maxChars: 200,
            });
            return { coords, win, err: null };
          } catch (e) {
            return { coords: null, win: null, err: String(e) };
          }
        })()
      `);
      ok(second.err == null && second.coords != null, "非向量化书转换后可换算 md 坐标", second.err);
      if (second.coords) {
        ok(second.coords.mdRelPath === rel, "转换后 md 相对路径映射一致", {
          got: second.coords.mdRelPath,
          expect: rel,
        });
        ok(second.coords.indexed === false, "非向量化书 indexed=false（无分块区间）", second.coords.indexed);
        ok(second.win != null && second.win.text.length > 0, "非向量化书可按位置读 md 原文", second.win?.text?.length);
      }
    }
  }
}

console.log(failed === 0 ? "\nALL PASS" : `\n${failed} FAILED`);
process.exit(failed === 0 ? 0 : 1);

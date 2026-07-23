/**
 * highlight.worker.ts — Web Worker，把 highlight.js 跑在后台线程。
 *
 * 主线程不会因为长 code block 的同步 tokenize 阻塞 →
 * 切到长 session / 滚到 deep history 时主线程保持响应。
 *
 * 协议：
 *   request  = { id, code, language }
 *   response = { id, html } | { id, error }
 *
 * Worker 单实例处理所有请求。最新请求的 id 是唯一相关信号；
 * 主线程根据 id 决定哪些 response 是有效的（旧的 superseded 直接丢弃）。
 *
 * 借鉴 OpenCode `markdown-worker.ts` 的 transport 设计，但简化为单请求
 * 单响应（OpenCode 还有 stable/unstable token 流式分片；我们这里不
 * 流式高亮 —— streaming markdown 里 unclosed fence 已经在 prefix/tail
 * 拆分里整段走 tail，worker 只处理已闭合的整段）。
 */

import hljs from "highlight.js/lib/core";

import bash from "highlight.js/lib/languages/bash";
import c from "highlight.js/lib/languages/c";
import cpp from "highlight.js/lib/languages/cpp";
import csharp from "highlight.js/lib/languages/csharp";
import css from "highlight.js/lib/languages/css";
import diff from "highlight.js/lib/languages/diff";
import dockerfile from "highlight.js/lib/languages/dockerfile";
import elixir from "highlight.js/lib/languages/elixir";
import go from "highlight.js/lib/languages/go";
import graphql from "highlight.js/lib/languages/graphql";
import haskell from "highlight.js/lib/languages/haskell";
import ini from "highlight.js/lib/languages/ini";
import java from "highlight.js/lib/languages/java";
import javascript from "highlight.js/lib/languages/javascript";
import json from "highlight.js/lib/languages/json";
import kotlin from "highlight.js/lib/languages/kotlin";
import lua from "highlight.js/lib/languages/lua";
import makefile from "highlight.js/lib/languages/makefile";
import markdown from "highlight.js/lib/languages/markdown";
import objectivec from "highlight.js/lib/languages/objectivec";
import perl from "highlight.js/lib/languages/perl";
import php from "highlight.js/lib/languages/php";
import plaintext from "highlight.js/lib/languages/plaintext";
import python from "highlight.js/lib/languages/python";
import r from "highlight.js/lib/languages/r";
import ruby from "highlight.js/lib/languages/ruby";
import rust from "highlight.js/lib/languages/rust";
import scala from "highlight.js/lib/languages/scala";
import scss from "highlight.js/lib/languages/scss";
import shell from "highlight.js/lib/languages/shell";
import sql from "highlight.js/lib/languages/sql";
import swift from "highlight.js/lib/languages/swift";
import typescript from "highlight.js/lib/languages/typescript";
import xml from "highlight.js/lib/languages/xml";
import yaml from "highlight.js/lib/languages/yaml";

hljs.registerLanguage("bash", bash);
hljs.registerLanguage("c", c);
hljs.registerLanguage("cpp", cpp);
hljs.registerLanguage("csharp", csharp);
hljs.registerLanguage("css", css);
hljs.registerLanguage("diff", diff);
hljs.registerLanguage("dockerfile", dockerfile);
hljs.registerLanguage("elixir", elixir);
hljs.registerLanguage("go", go);
hljs.registerLanguage("graphql", graphql);
hljs.registerLanguage("haskell", haskell);
hljs.registerLanguage("ini", ini);
hljs.registerLanguage("java", java);
hljs.registerLanguage("javascript", javascript);
hljs.registerLanguage("json", json);
hljs.registerLanguage("kotlin", kotlin);
hljs.registerLanguage("lua", lua);
hljs.registerLanguage("makefile", makefile);
hljs.registerLanguage("markdown", markdown);
hljs.registerLanguage("objectivec", objectivec);
hljs.registerLanguage("perl", perl);
hljs.registerLanguage("php", php);
hljs.registerLanguage("plaintext", plaintext);
hljs.registerLanguage("python", python);
hljs.registerLanguage("r", r);
hljs.registerLanguage("ruby", ruby);
hljs.registerLanguage("rust", rust);
hljs.registerLanguage("scala", scala);
hljs.registerLanguage("scss", scss);
hljs.registerLanguage("shell", shell);
hljs.registerLanguage("sql", sql);
hljs.registerLanguage("swift", swift);
hljs.registerLanguage("typescript", typescript);
hljs.registerLanguage("xml", xml);
hljs.registerLanguage("yaml", yaml);

export interface HighlightRequest {
  id: number;
  code: string;
  language: string;
}

export interface HighlightSuccess {
  id: number;
  html: string;
}
export interface HighlightError {
  id: number;
  error: string;
}
export type HighlightResponse = HighlightSuccess | HighlightError;

self.addEventListener("message", (event: MessageEvent<HighlightRequest>) => {
  const { id, code, language } = event.data;
  try {
    let html: string;
    if (language && hljs.getLanguage(language)) {
      html = hljs.highlight(code, { language, ignoreIllegals: true }).value;
    } else {
      html = hljs.highlightAuto(code).value;
    }
    const response: HighlightResponse = { id, html };
    (self as unknown as Worker).postMessage(response);
  } catch (e) {
    const response: HighlightResponse = {
      id,
      error: e instanceof Error ? e.message : String(e),
    };
    (self as unknown as Worker).postMessage(response);
  }
});
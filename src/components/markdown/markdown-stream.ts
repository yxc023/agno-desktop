/**
 * markdown-stream.ts — 旧版 prefix/tail 切分逻辑（**已废弃**，保留导出仅用于
 * 现有 unit test 与未来可能需要的 block-level cache 工作）。
 *
 * ## 历史
 * v1 用 prefix/tail 二分：tail 是 plain text，目的是避免"半截 fence"视觉错乱。
 * 但这个策略在**短单行消息**上完全退化（找不到 \n\n 边界 → 整段进 tail →
 * `**text**` 显示成原文，用户截图证据）。
 *
 * v2（当前生产路径）改用 `remend`：始终走 markdown parse + 治愈不完整语法。
 * 见 `MarkdownStream.tsx`。本文件保留是单元测试覆盖 + 后续 follow-up 优化
 * （block-level cache、token-level memo）时可能复用 helper 函数。
 *
 * 借鉴对象：OpenCode (anomalyco/opencode,
 * packages/session-ui/src/components/markdown-stream.ts) 的 block projection。
 */

/**
 * 计算 markdown 的"切分点"：prefix 长度。
 *
 * 找到**最后一个稳定边界**，返回该位置（含）的长度。
 * 找不到稳定边界，返回 0（prefix 为空）。
 *
 * ## 边界优先级（从最强 → 最弱）：
 *   1. last `\n\n` 之后（段落分隔）—— 任何 markdown 元素都以此稳定
 *   2. last list item break（`\n- ` / `\n* ` / `\n1. `）—— 列表也是稳定元素
 *   3. last thematic break `---` / `***` —— 边界稳定
 *   4. 0（找不到任何边界）—— 整段都是 tail
 */
export function splitAtStableBoundary(text: string): { prefix: string; tail: string } {
  if (!text) return { prefix: "", tail: "" };

  // 1. 检测 link reference 定义：触发时整段视为 live（simplest safe fallback）
  if (hasLinkReferences(text)) {
    return { prefix: "", tail: text };
  }

  // 2. 检测未闭合 code fence：
  //
  //   ```ts
  //   some streaming code...
  //
  //  找到**最后一个**未闭合的 fence **起点**，把 prefix 切到这里（让 fence 完整出现在
  //  prefix 里，避免 tail 把 fence 拆成两半）；但其实更安全的做法是 prefix 切到 fence 起点
  //  之前，fence 起点起的所有字符都走 tail —— 因为 streaming 中的 code 不能被 highlight。
  //
  //  选 conservative 路线：fence 一旦开始未闭合，整段内容都视为 tail，fence 起点之前的
  //  内容作为 prefix。
  const unclosedFenceStart = lastUnclosedFenceStart(text);
  if (unclosedFenceStart !== -1) {
    const prefix = text.slice(0, unclosedFenceStart);
    const tail = text.slice(unclosedFenceStart);
    return { prefix, tail };
  }

  // 3. 找最后一个 \n\n —— paragraph 分隔
  const lastParagraphBreak = text.lastIndexOf("\n\n");
  if (lastParagraphBreak !== -1) {
    const prefix = text.slice(0, lastParagraphBreak + 2); // 含 "\n\n"
    const tail = text.slice(lastParagraphBreak + 2);
    return { prefix, tail };
  }

  // 4. 找最后一个 list-item-start（`\n- ` / `\n* ` / `\n1. `）
  //    用 lastIndexOf 多个候选模式的最右一个
  const listBreak = findLastListBreak(text);
  if (listBreak !== -1) {
    const prefix = text.slice(0, listBreak + 1); // 含 "\n"
    const tail = text.slice(listBreak + 1);
    return { prefix, tail };
  }

  // 5. 找最后一个 thematic break（`\n---\n` / `\n***\n` 等）
  const thematicBreak = findLastThematicBreak(text);
  if (thematicBreak !== -1) {
    const prefix = text.slice(0, thematicBreak);
    const tail = text.slice(thematicBreak);
    return { prefix, tail };
  }

  // 6. 没找到任何边界：整段是 tail
  return { prefix: "", tail: text };
}

/**
 * 检测 `[label]: url` 形式 reference 定义。
 *
 * 即便在 streaming 中出现一行 `[foo]: http://...`，reference 必须全局可见。
 * 简单粗暴的做法：检测到就整段视为 live（与 OpenCode 一致）。
 */
function hasLinkReferences(text: string): boolean {
  if (!text.includes("]:")) return false;
  // 简化：仅匹配最常见的行起始形式
  return /^[ \t]{0,3}\[[^\]\n]+\]:[ \t]*(?:https?:\/\/[^\s]+|\S+)/m.test(text);
}

/**
 * 找**最后一个未闭合**的 ``` 或 ~~~ fence 的起点。
 *
 * ## 算法
 * 用栈做 fence 配对：
 *   - 从前向后扫描所有 fence mark（行首 `[ \t]{0,3}` + 3+ 个 ` 或 ~）
 *   - 遇到 opening：压栈
 *   - 遇到 closing（与栈顶字符相同 + 长度 ≥ 栈顶，且**不在该行内有任何其他内容**——即闭合 fence 占满整行）：
 *     弹栈
 *
 * 配对完成后，**栈顶**若存在，即为未闭合的 fence；其起点索引即返回值。
 *
 * ⚠️ **同字符不同长度**：`` ``` `` 不能被 `` ```` `` 闭合（CommonMark spec：
 *    闭合 fence 的字符数必须 ≥ 起始 fence 的字符数）。我们用相同字符 +
 *    长度阈值判定。
 *
 * 返回该起点索引；若最近没有未闭合 fence，返回 -1。
 */
function lastUnclosedFenceStart(text: string): number {
  const regex = /^[ \t]{0,3}(`{3,}|~{3,})/gm;
  type Fence = { index: number; ch: string; len: number; mark: string };
  const stack: Fence[] = [];
  let m: RegExpExecArray | null;
  while ((m = regex.exec(text)) !== null) {
    const fullMatchStart = m.index;
    const leadLen = m[0].length - m[1]!.length; // [ \t]{0,3}
    const markStart = fullMatchStart + leadLen;
    const mark = m[1]!;
    const ch = mark.charAt(0);
    const len = mark.length;

    // 检查这一行除 `[ \t]{0,3}` + fence 外是否还有其他字符。
    // 多行模式下，匹配 `m[0]` 是从行首到 fence 结束的整段（我们的 regex 没限定
    // 行尾），所以 `m[0]` 后面紧接的是行剩余内容。如果 `m[0]` 行末还有非空白，
    // 说明这是 opening（info string 或其他内容），不是 closing。
    const afterMarkInLine = text
      .slice(markStart + len, markStart + len + 64)
      .split("\n", 1)[0]!;
    const lineRemainderTrimmed = afterMarkInLine.replace(/[ \t]+$/, "");

    if (lineRemainderTrimmed.length > 0) {
      // 行内 fence 后面还有其他字符（典型 info string）→ opening
      stack.push({ index: markStart, ch, len, mark });
    } else {
      // 行内只有 fence → 可能是 closing。匹配条件：栈顶字符相同、长度 ≥ 栈顶。
      const top = stack[stack.length - 1];
      if (top && top.ch === ch && len >= top.len) {
        stack.pop();
      } else {
        // 没匹配的 opening → 视为 opening（信息字符串丢失场景）
        stack.push({ index: markStart, ch, len, mark });
      }
    }
    if (m.index === regex.lastIndex) regex.lastIndex++;
  }
  return stack.length > 0 ? stack[stack.length - 1]!.index : -1;
}

/**
 * 找最后一个 list-item 起始位置（`\n- ` / `\n* ` / `\n1. ` / `\n123. `）。
 *
 * 返回该 `\n` 的索引（即 prefix 切到 `\n` 的位置，含 `\n`）。
 */
function findLastListBreak(text: string): number {
  // 用正则找到最后一个 \n + 空白 + marker + 空格
  const re = /\n[ \t]*([-*+]|[0-9]+\.)[ \t]+/g;
  let lastIdx = -1;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    lastIdx = m.index;
    if (m.index === re.lastIndex) re.lastIndex++;
  }
  return lastIdx;
}

/**
 * 找最后一个 thematic break（`\n---` / `\n***` / `\n___`）。
 *
 * 返回该 break 行的起点（即 prefix 切到前一行末尾）。如果没找到，返回 -1。
 */
function findLastThematicBreak(text: string): number {
  // 整行只有 - * _（≥3 个），可选前后空白
  const re = /\n[ \t]{0,3}(-{3,}|\*{3,}|_{3,})[ \t]*(\n|$)/g;
  let lastIdx = -1;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    lastIdx = m.index;
    if (m.index === re.lastIndex) re.lastIndex++;
  }
  return lastIdx;
}

/**
 * 增量投影：当 tick A → tick B 时，A 的 prefix 可以被 B 的 prefix 包含（prefix 增长），
 * 此时 A 的 parsed result 可被 B 复用（仅追加 / rebuild 最后一段）。
 *
 * 这里我们不做完整 token 级别复用（那是 OpenCode 用 marked.lexer 做的）——
 * 仅做最小有用的缓存：prefix 文本相同时，prefix 的 React 渲染会因 React.memo 而跳过
 * 工作；prefix 不同时，让 react-markdown 重新走 prefix 部分。
 *
 * 因此函数返回 `{prefix, tail}`，prefix 字符串一致时被 `React.memo(Markdown)` 跳过；
 * 当前 Markdown 组件并未做 token 级 cache（OpenCode 的 morphdom cache），这是后续
 * 优化项。
 */
export function splitStreamingMarkdown(text: string): { prefix: string; tail: string } {
  return splitAtStableBoundary(text);
}

/**
 * 检测 `text` 在 streaming 状态下是否需要"完整渲染"（不走 prefix/tail 拆分）。
 *
 * 触发场景：
 *   - text 为空 / 全是空白
 *   - text 中包含 reference 定义（避免错配）
 */
export function shouldSkipSplit(text: string): boolean {
  if (!text) return true;
  return hasLinkReferences(text);
}

/**
 * 把 marked.lexer 当作只读 utility 暴露，供 follow-up 优化（block-level cache）使用。
 * 当前不直接使用 —— 保留以便后续迭代。
 */
// Re-export for tests / future use (currently empty - kept for future block-level cache work)

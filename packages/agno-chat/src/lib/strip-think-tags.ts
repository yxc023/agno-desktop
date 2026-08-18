/**
 * strip-think-tags — 把模型 inline 推理标签从 text 字符串里去掉
 *
 * 背景：
 * 一些模型(DeepSeek-R1 / Qwen3 / QwQ / Yi / 部分 Llama 变体)会把推理内容
 * 直接以 inline 标签的形式塞进模型输出文本:
 *
 *   <think>the user wants X, so I'll do Y</think>The answer is 42.
 *
 * AGNO 后端如果没把这些标签 strip / parse 进 reasoning_content 通道,前端
 * 拿到的 text part 里就会包含字面的 `<think>...` 字符。默认渲染就会泄漏
 * 到用户视野,看着像 bug。
 *
 * 覆盖范围(业界常见):
 *   - <think>...</think>       DeepSeek-R1 / Qwen3 / QwQ / Yi / Hunyuan /
 *                               HuggingFace open-source 事实标准
 *   - <thinking>...</thinking>  部分 Anthropic-style 开源变体
 *   - <reasoning>...</reasoning> 部分自定义 / 内部训练模型
 *
 * 处理规则:
 *   1. 成对 block:用栈式平衡匹配(不是正则)。`<think>A<think>B</think>C</think>`
 *      里外层都要被识别 —— lazy 正则会漏掉外层 close 与内层 close 之间的内容
 *   2. 未闭合 open:从 `<tagname>` 起到末尾全删(模型在推理中没说完)
 *   3. 孤儿 close:单独的 `</tagname>` 标签字面删掉(前后内容保留)
 *
 * 大小写不敏感(某些模型偶发 `<THINK>`)。
 *
 * 这是个纯函数;不在 chat-runner / store 里改数据,只在渲染层 `MessageContent`
 * 出口过滤 —— 隐藏设置随时切换,chat 历史不受影响。
 */

const TAG_NAMES = ["think", "thinking", "reasoning"] as const;

export function stripThinkTags(text: string): string {
  if (!text) return text;
  let s = text;
  for (const tagName of TAG_NAMES) {
    s = stripOneTag(s, tagName);
  }
  return s;
}

/**
 * 平衡括号式 stripper — 比正则正确地处理嵌套。
 *
 * 走单遍指针 + 栈深度计数:
 *   - 遇 open:depth++,找下一个 open / close
 *     - 如果下一个是 open 且更近 → 嵌套,继续
 *     - 如果下一个是 close → 平衡一层,depth--;depth=0 时匹配完成,跳过整段
 *   - 遇 close 而 depth=0:孤儿 close,字面跳过标签本身
 *   - 找不到 close:open 到末尾全是孤儿,删
 */
function stripOneTag(text: string, tagName: string): string {
  const open = `<${tagName}>`;
  const close = `</${tagName}>`;
  const openLower = open.toLowerCase();
  const closeLower = close.toLowerCase();
  const lower = text.toLowerCase();

  let out = "";
  let i = 0;
  const n = text.length;

  while (i < n) {
    const isOpen = lower.startsWith(openLower, i);
    const isClose = lower.startsWith(closeLower, i);

    if (isOpen) {
      // 平衡匹配
      let depth = 1;
      let j = i + open.length;
      let matched = false;
      while (j <= n) {
        const nextOpen = lower.indexOf(openLower, j);
        const nextClose = lower.indexOf(closeLower, j);
        if (nextClose === -1) {
          // 没有 close → 从 i 到末尾全删;out 已经是 text[0..i-1],直接返回
          return out;
        }
        if (nextOpen !== -1 && nextOpen < nextClose) {
          depth++;
          j = nextOpen + open.length;
        } else {
          depth--;
          j = nextClose + close.length;
          if (depth === 0) {
            matched = true;
            break;
          }
        }
      }
      if (!matched) {
        // depth 没回到 0(理论上到不了这里) — 删到末尾
        return out;
      }
      // 跳过整段成对内容(可能含嵌套)
      i = j;
    } else if (isClose) {
      // 孤儿 close → 跳过标签字面,保留前后文本
      i += close.length;
    } else {
      out += text[i];
      i++;
    }
  }

  return out;
}
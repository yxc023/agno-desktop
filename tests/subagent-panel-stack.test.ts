/**
 * Test: ui-store sub-agent panel navigation.
 *
 * Verifies:
 *   - openSubAgentPanel(sessionId, subId) sets the stack to a single entry
 *   - pushSubAgentPanel pushes a new entry on the stack
 *   - popSubAgentPanel pops the top entry
 *   - closeSubAgentPanel clears the stack
 */
import { useUIStore } from "../src/stores/ui-store";

async function main() {
  let failed = 0;
  function assert(cond: boolean, msg: string) {
    if (cond) console.log(`✓ ${msg}`);
    else {
      console.log(`✗ ${msg}`);
      failed++;
    }
  }

  console.log("=== openSubAgentPanel ===");
  // clear state first
  useUIStore.getState().closeSubAgentPanel();
  useUIStore.getState().openSubAgentPanel("sess-1", "sub-a");
  let stack = useUIStore.getState().subAgentPanel.stack;
  assert(stack.length === 1, `after open: stack.length=${stack.length}`);
  assert(
    stack[0].sessionId === "sess-1" && stack[0].subMessageId === "sub-a",
    "after open: top is sub-a"
  );

  console.log("=== pushSubAgentPanel ===");
  useUIStore.getState().pushSubAgentPanel("sess-1", "sub-b");
  stack = useUIStore.getState().subAgentPanel.stack;
  assert(stack.length === 2, `after push: stack.length=${stack.length}`);
  assert(stack[1].subMessageId === "sub-b", `top is now sub-b`);

  useUIStore.getState().pushSubAgentPanel("sess-1", "sub-c");
  stack = useUIStore.getState().subAgentPanel.stack;
  assert(stack.length === 3, "after 2nd push: stack.length=3");
  assert(stack[2].subMessageId === "sub-c", "top is sub-c");

  console.log("=== popSubAgentPanel ===");
  useUIStore.getState().popSubAgentPanel();
  stack = useUIStore.getState().subAgentPanel.stack;
  assert(stack.length === 2, "after pop: stack.length=2");
  assert(stack[1].subMessageId === "sub-b", "top after pop = sub-b");

  // pop all the way down
  useUIStore.getState().popSubAgentPanel();
  useUIStore.getState().popSubAgentPanel();
  stack = useUIStore.getState().subAgentPanel.stack;
  assert(stack.length === 0, "after popping all: stack.length=0");

  console.log("=== closeSubAgentPanel ===");
  useUIStore.getState().openSubAgentPanel("sess-2", "sub-x");
  useUIStore.getState().pushSubAgentPanel("sess-2", "sub-y");
  assert(useUIStore.getState().subAgentPanel.stack.length === 2, "stack has 2 entries");
  useUIStore.getState().closeSubAgentPanel();
  assert(useUIStore.getState().subAgentPanel.stack.length === 0, "after close: stack cleared");

  console.log("=== dedupe open ===");
  useUIStore.getState().openSubAgentPanel("sess-A", "sub-1");
  useUIStore.getState().openSubAgentPanel("sess-A", "sub-1");
  assert(useUIStore.getState().subAgentPanel.stack.length === 1, "duplicate open doesn't add");

  console.log(`\n${failed === 0 ? "✅ all passed" : `❌ ${failed} failed`}`);
  process.exit(failed === 0 ? 0 : 1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

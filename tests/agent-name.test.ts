/**
 * tests/agent-name.test.ts — src/lib/agent-name.ts
 *
 * displayNameForRun 是 chat-runner / loadHistory 路径上唯一"display name 来源"。
 * 8 级优先级链很容易被破坏（多加一个字段、改 extra_data 顺序）。
 * 这里直接覆盖纯函数，省得拖一整套 store fixture。
 */
import { displayNameForRun } from "../src/lib/agent-name";

let failed = 0;
function assert(cond: unknown, msg: string): void {
  if (cond) console.log(`✓ ${msg}`);
  else {
    console.log(`✗ ${msg}`);
    failed++;
  }
}

function main(): void {
  console.log("=== displayNameForRun: 优先级链 ===");
  {
    assert(
      displayNameForRun({
        agent_name: "TopAgent",
        team_name: "TopTeam",
        member_name: "Member1",
        agent_id: "aid",
        team_id: "tid",
        extra_data: { agent_name: "FromExtra" },
      }) === "FromExtra",
      "1. extra_data.agent_name wins over everything"
    );

    assert(
      displayNameForRun({
        agent_name: "TopAgent",
        team_name: "TopTeam",
        member_name: "Member1",
        extra_data: { team_name: "FromExtraTeam" },
      }) === "FromExtraTeam",
      "2. extra_data.team_name wins when no extra agent_name"
    );

    assert(
      displayNameForRun({ agent_name: "TopAgent", team_name: "TopTeam" }) ===
        "TopAgent",
      "3. agent_name next"
    );

    assert(
      displayNameForRun({ team_name: "TopTeam" }) === "TopTeam",
      "4. team_name next"
    );

    assert(
      displayNameForRun({ member_name: "Member1" }) === "Member1",
      "5. member_name next"
    );

    assert(
      displayNameForRun({ agent_id: "aid" }) === "aid",
      "6. agent_id fallback"
    );

    assert(
      displayNameForRun({ team_id: "tid" }) === "tid",
      "7. team_id fallback when no agent_id"
    );
  }

  console.log("\n=== displayNameForRun: 边界 ===");
  {
    assert(
      displayNameForRun({ agent_name: "  ", extra_data: { agent_name: "  " } }) ===
        undefined,
      "whitespace-only name strings are skipped"
    );

    assert(
      displayNameForRun(null) === undefined &&
        displayNameForRun(undefined) === undefined,
      "null/undefined input → undefined"
    );

    assert(
      displayNameForRun({}) === undefined,
      "空对象 → undefined"
    );
  }

  console.log(
    `\n${failed === 0 ? "✅ all assertions passed" : `❌ ${failed} assertions failed`}`
  );
  process.exit(failed === 0 ? 0 : 1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
import { useState } from "react";
import { RequirementList } from "@/components/works/requirement-list";
import { RequirementDetail } from "@/components/works/requirement-detail";
import { useRequirement } from "@/components/works/selectors";
import type { RequirementStatus } from "@/components/works/types";

export function WorksPage() {
  const [selectedId, setSelectedId] = useState<string | null>("REQ-234");
  const [statusFilter, setStatusFilter] = useState<"all" | RequirementStatus>("all");
  const [search, setSearch] = useState("");
  const requirement = useRequirement(selectedId);

  return (
    <div className="flex min-h-0 flex-1 overflow-hidden">
      <aside className="flex w-[380px] shrink-0 flex-col border-r border-sidebar-border bg-sidebar">
        <RequirementList
          selectedId={selectedId}
          onSelect={setSelectedId}
          statusFilter={statusFilter}
          setStatusFilter={setStatusFilter}
          search={search}
          setSearch={setSearch}
        />
      </aside>
      <main className="flex min-w-0 flex-1 flex-col overflow-hidden">
        <RequirementDetail requirement={requirement} />
      </main>
    </div>
  );
}
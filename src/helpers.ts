// Pure data transformation helpers for Attio MCP server.
// No API calls — all functions take pre-fetched data and return shaped results.
//
// Attio's data model stores everything as generic objects with dynamic attributes.
// Values are nested unions: personal-name has first_name/last_name/full_name,
// email has email_address, currency has currency_value/currency_code,
// status has status.title, etc. These helpers extract readable fields from that structure.

// --- Record name extraction ---

/**
 * Extract a readable name from an Attio record's values dict.
 * Checks for personal-name type, text name, company name, deal title, etc.
 */
export function extractRecordName(record: any): string {
  const values = record?.values || record?.attributes || {};

  // personal-name type (people records)
  const nameVal = values.name?.[0] || values.primary_name?.[0];
  if (nameVal) {
    if (nameVal.full_name) return nameVal.full_name;
    if (nameVal.first_name || nameVal.last_name) {
      return `${nameVal.first_name || ""} ${nameVal.last_name || ""}`.trim();
    }
    // Simple text value
    if (typeof nameVal === "string") return nameVal;
    if (nameVal.value) return String(nameVal.value);
  }

  // Company/deal name (text type)
  const titleVal = values.title?.[0] || values.company_name?.[0] || values.deal_name?.[0];
  if (titleVal) {
    if (typeof titleVal === "string") return titleVal;
    if (titleVal.value) return String(titleVal.value);
  }

  // Fallback: check any field that looks like a name
  for (const key of ["name", "title", "company", "deal_name", "primary_name"]) {
    const v = values[key];
    if (Array.isArray(v) && v[0]) {
      const first = v[0];
      if (first.full_name) return first.full_name;
      if (typeof first === "string") return first;
      if (first.value) return String(first.value);
    }
  }

  return record?.id?.record_id || record?.id || "Unknown";
}

/**
 * Flatten an Attio values dict into a more readable key-value structure.
 * Extracts the primary value from each attribute's array.
 */
export function flattenValues(values: any): Record<string, any> {
  if (!values || typeof values !== "object") return {};

  const flat: Record<string, any> = {};

  for (const [key, arr] of Object.entries(values)) {
    if (!Array.isArray(arr) || arr.length === 0) {
      flat[key] = null;
      continue;
    }

    const first = arr[0] as any;

    // Personal name
    if (first.full_name !== undefined) {
      flat[key] = first.full_name || `${first.first_name || ""} ${first.last_name || ""}`.trim();
      continue;
    }

    // Email
    if (first.email_address !== undefined) {
      flat[key] = first.email_address;
      continue;
    }

    // Phone
    if (first.phone_number !== undefined) {
      flat[key] = first.phone_number;
      continue;
    }

    // Currency
    if (first.currency_value !== undefined) {
      flat[key] = { amount: first.currency_value, currency: first.currency_code || null };
      continue;
    }

    // Status
    if (first.status !== undefined) {
      flat[key] = first.status?.title || first.status;
      continue;
    }

    // Record reference
    if (first.target_record_id !== undefined) {
      flat[key] = { recordId: first.target_record_id, objectType: first.target_object || null };
      continue;
    }

    // Select / option
    if (first.option !== undefined) {
      flat[key] = first.option?.title || first.option;
      continue;
    }

    // Date
    if (first.value !== undefined && typeof first.value === "string" && /^\d{4}-\d{2}/.test(first.value)) {
      flat[key] = first.value;
      continue;
    }

    // Simple value
    if (first.value !== undefined) {
      flat[key] = first.value;
      continue;
    }

    // Number, boolean, or string directly
    if (typeof first === "string" || typeof first === "number" || typeof first === "boolean") {
      flat[key] = first;
      continue;
    }

    // Fallback: keep raw
    flat[key] = first;
  }

  return flat;
}

// --- Search results shaping ---

export interface ShapedRecord {
  id: string;
  objectType: string | null;
  name: string;
  email: string | null;
  company: string | null;
  flatValues: Record<string, any>;
}

export function shapeSearchResults(records: any[], objectType?: string): ShapedRecord[] {
  return records
    .filter((r) => !objectType || r.object === objectType || r.parent_object === objectType)
    .map((r) => {
      const values = r.values || r.attributes || {};
      const emailArr = values.email_addresses || values.email || [];
      const email = emailArr[0]?.email_address || emailArr[0]?.value || null;

      const companyArr = values.company || values.companies || [];
      const company = companyArr[0]?.full_name || companyArr[0]?.value || null;

      return {
        id: r.id?.record_id || r.id,
        objectType: r.object || r.parent_object || objectType || null,
        name: extractRecordName(r),
        email,
        company,
        flatValues: flattenValues(values),
      };
    });
}

// --- Pipeline summary ---

export interface PipelineStageSummary {
  stage: string;
  count: number;
  totalValue: number | null;
}

export interface PipelineSummary {
  listId: string;
  listName: string;
  totalEntries: number;
  stages: PipelineStageSummary[];
  entries: {
    id: string;
    recordName: string;
    stage: string | null;
    value: number | null;
  }[];
}

export function computePipelineSummary(
  listId: string,
  listName: string,
  entries: any[],
  recordNameMap: Map<string, string>,
): PipelineSummary {
  const entryList = Array.isArray(entries) ? entries : (entries as any)?.data || [];

  const stageMap = new Map<string, { count: number; total: number; hasValue: boolean }>();

  const shapedEntries = entryList.map((entry: any) => {
    const values = entry.entry_values || entry.values || {};

    // Extract stage
    const stageVal = values.stage?.[0];
    const stage = stageVal?.status?.title || stageVal?.option?.title || stageVal?.value || null;

    // Extract value/amount
    const valueVal = values.value?.[0] || values.amount?.[0] || values.deal_value?.[0];
    const value = valueVal?.currency_value ?? valueVal?.value ?? null;
    const numValue = value !== null ? Number(value) : null;

    // Record name
    const recordId = entry.record_id || entry.parent_record_id;
    const recordName = recordId ? (recordNameMap.get(recordId) || `Record ${recordId}`) : "Unknown";

    // Accumulate stage stats
    const stageKey = stage || "No Stage";
    if (!stageMap.has(stageKey)) stageMap.set(stageKey, { count: 0, total: 0, hasValue: false });
    const s = stageMap.get(stageKey)!;
    s.count++;
    if (numValue !== null) {
      s.total += numValue;
      s.hasValue = true;
    }

    return {
      id: entry.entry_id || entry.id,
      recordName,
      stage,
      value: numValue,
    };
  });

  const stages = Array.from(stageMap.entries()).map(([stage, s]) => ({
    stage,
    count: s.count,
    totalValue: s.hasValue ? s.total : null,
  }));

  return {
    listId,
    listName,
    totalEntries: shapedEntries.length,
    stages,
    entries: shapedEntries,
  };
}

// --- Task enrichment ---

export interface EnrichedTask {
  id: string;
  content: string | null;
  isCompleted: boolean;
  deadline: string | null;
  assignees: string[];
  linkedRecords: string[];
}

export function enrichTasks(
  tasks: any[],
  memberMap: Map<string, string>,
  recordNameMap: Map<string, string>,
): { open: EnrichedTask[]; completed: EnrichedTask[] } {
  const enriched = tasks.map((t: any) => {
    const assignees = (t.assignees || []).map((a: any) => {
      const id = a.referenced_actor_id || a.id || a;
      return memberMap.get(id) || `User ${id}`;
    });

    const linkedRecords = (t.linked_records || []).map((lr: any) => {
      const rid = lr.record_id || lr.target_record_id;
      return recordNameMap.get(rid) || `Record ${rid}`;
    });

    return {
      id: t.id?.task_id || t.id,
      content: t.content_plaintext || t.content || t.title || null,
      isCompleted: !!t.is_completed,
      deadline: t.deadline || t.due_date || null,
      assignees,
      linkedRecords,
    };
  });

  // Sort by deadline (nulls last)
  const withDeadline = enriched.filter((t) => t.deadline).sort((a, b) => (a.deadline! < b.deadline! ? -1 : 1));
  const noDeadline = enriched.filter((t) => !t.deadline);
  const sorted = [...withDeadline, ...noDeadline];

  return {
    open: sorted.filter((t) => !t.isCompleted),
    completed: sorted.filter((t) => t.isCompleted),
  };
}

// --- Activity timeline ---

export interface TimelineEvent {
  type: "note" | "meeting" | "thread";
  id: string;
  date: string | null;
  title: string | null;
  content: string | null;
}

export function buildActivityTimeline(
  notes: any[],
  meetings: any[],
  threads: any[],
): TimelineEvent[] {
  const events: TimelineEvent[] = [];

  for (const n of notes) {
    events.push({
      type: "note",
      id: n.id?.note_id || n.id,
      date: n.created_at || null,
      title: n.title || null,
      content: n.content_plaintext || n.content || null,
    });
  }

  for (const m of meetings) {
    events.push({
      type: "meeting",
      id: m.id?.meeting_id || m.id,
      date: m.start_time || m.created_at || null,
      title: m.title || m.subject || null,
      content: m.description || null,
    });
  }

  for (const t of threads) {
    events.push({
      type: "thread",
      id: t.id?.thread_id || t.id,
      date: t.created_at || null,
      title: t.subject || null,
      content: t.body_plaintext || t.body || null,
    });
  }

  // Sort by date descending (most recent first), nulls last
  return events.sort((a, b) => {
    if (!a.date && !b.date) return 0;
    if (!a.date) return 1;
    if (!b.date) return -1;
    return b.date.localeCompare(a.date);
  });
}

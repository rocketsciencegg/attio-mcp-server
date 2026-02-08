import { describe, it, expect } from "vitest";
import {
  extractRecordName,
  flattenValues,
  shapeSearchResults,
  computePipelineSummary,
  enrichTasks,
  buildActivityTimeline,
} from "./helpers.js";

// --- extractRecordName ---

describe("extractRecordName", () => {
  it("extracts personal name (full_name)", () => {
    const record = { values: { name: [{ full_name: "Alice Smith", first_name: "Alice", last_name: "Smith" }] } };
    expect(extractRecordName(record)).toBe("Alice Smith");
  });

  it("extracts personal name (first + last)", () => {
    const record = { values: { name: [{ first_name: "Bob", last_name: "Jones" }] } };
    expect(extractRecordName(record)).toBe("Bob Jones");
  });

  it("extracts company name from title", () => {
    const record = { values: { title: [{ value: "Acme Corp" }] } };
    expect(extractRecordName(record)).toBe("Acme Corp");
  });

  it("extracts string title value", () => {
    const record = { values: { title: ["My Deal"] } };
    expect(extractRecordName(record)).toBe("My Deal");
  });

  it("extracts from company_name", () => {
    const record = { values: { company_name: [{ value: "Widget Inc" }] } };
    expect(extractRecordName(record)).toBe("Widget Inc");
  });

  it("extracts from primary_name", () => {
    const record = { values: { primary_name: [{ full_name: "Jane Doe" }] } };
    expect(extractRecordName(record)).toBe("Jane Doe");
  });

  it("falls back to record ID", () => {
    const record = { id: { record_id: "abc123" }, values: {} };
    expect(extractRecordName(record)).toBe("abc123");
  });

  it("handles string name value in fallback loop", () => {
    const record = { values: { name: ["Simple Name"] } };
    expect(extractRecordName(record)).toBe("Simple Name");
  });

  it("handles null record gracefully", () => {
    expect(extractRecordName(null)).toBe("Unknown");
  });

  it("handles record with no values", () => {
    expect(extractRecordName({ id: "xyz" })).toBe("xyz");
  });

  it("extracts from .value on name field", () => {
    const record = { values: { name: [{ value: "Value Name" }] } };
    expect(extractRecordName(record)).toBe("Value Name");
  });

  it("extracts from deal_name via title fallback", () => {
    const record = { values: { deal_name: [{ value: "Big Deal" }] } };
    expect(extractRecordName(record)).toBe("Big Deal");
  });

  it("extracts string from deal_name", () => {
    const record = { values: { deal_name: ["Direct String Deal"] } };
    expect(extractRecordName(record)).toBe("Direct String Deal");
  });

  it("uses fallback loop for company field with full_name", () => {
    const record = { values: { company: [{ full_name: "Acme via fallback" }] } };
    expect(extractRecordName(record)).toBe("Acme via fallback");
  });

  it("uses fallback loop for company field with .value", () => {
    const record = { values: { company: [{ value: "Widget via fallback" }] } };
    expect(extractRecordName(record)).toBe("Widget via fallback");
  });

  it("extracts first_name only from personal name", () => {
    const record = { values: { name: [{ first_name: "Solo" }] } };
    expect(extractRecordName(record)).toBe("Solo");
  });
});

// --- flattenValues ---

describe("flattenValues", () => {
  it("flattens personal name", () => {
    const values = { name: [{ full_name: "Alice Smith", first_name: "Alice", last_name: "Smith" }] };
    expect(flattenValues(values).name).toBe("Alice Smith");
  });

  it("flattens personal name from first+last when no full_name", () => {
    const values = { name: [{ full_name: "", first_name: "Bob", last_name: "J" }] };
    expect(flattenValues(values).name).toBe("Bob J");
  });

  it("flattens email", () => {
    const values = { email_addresses: [{ email_address: "alice@co.com" }] };
    expect(flattenValues(values).email_addresses).toBe("alice@co.com");
  });

  it("flattens phone", () => {
    const values = { phone: [{ phone_number: "+1234567890" }] };
    expect(flattenValues(values).phone).toBe("+1234567890");
  });

  it("flattens currency", () => {
    const values = { value: [{ currency_value: 50000, currency_code: "USD" }] };
    expect(flattenValues(values).value).toEqual({ amount: 50000, currency: "USD" });
  });

  it("flattens status", () => {
    const values = { stage: [{ status: { title: "Qualified" } }] };
    expect(flattenValues(values).stage).toBe("Qualified");
  });

  it("flattens record reference", () => {
    const values = { company: [{ target_record_id: "rec123", target_object: "companies" }] };
    expect(flattenValues(values).company).toEqual({ recordId: "rec123", objectType: "companies" });
  });

  it("flattens select/option", () => {
    const values = { priority: [{ option: { title: "High" } }] };
    expect(flattenValues(values).priority).toBe("High");
  });

  it("flattens date value", () => {
    const values = { created: [{ value: "2026-01-15" }] };
    expect(flattenValues(values).created).toBe("2026-01-15");
  });

  it("flattens simple value", () => {
    const values = { count: [{ value: 42 }] };
    expect(flattenValues(values).count).toBe(42);
  });

  it("flattens primitive values", () => {
    const values = { tags: ["important"] };
    expect(flattenValues(values).tags).toBe("important");
  });

  it("handles empty array", () => {
    const values = { empty: [] };
    expect(flattenValues(values).empty).toBeNull();
  });

  it("handles null values", () => {
    expect(flattenValues(null)).toEqual({});
  });

  it("keeps unrecognized object as raw", () => {
    const values = { weird: [{ foo: "bar", baz: 1 }] };
    expect(flattenValues(values).weird).toEqual({ foo: "bar", baz: 1 });
  });

  it("flattens number primitive", () => {
    const values = { score: [99] };
    expect(flattenValues(values).score).toBe(99);
  });

  it("flattens boolean primitive", () => {
    const values = { active: [true] };
    expect(flattenValues(values).active).toBe(true);
  });
});

// --- shapeSearchResults ---

describe("shapeSearchResults", () => {
  const records = [
    {
      id: { record_id: "r1" },
      object: "people",
      values: {
        name: [{ full_name: "Alice Smith" }],
        email_addresses: [{ email_address: "alice@co.com" }],
        company: [{ full_name: "Acme" }],
      },
    },
    {
      id: { record_id: "r2" },
      object: "companies",
      values: {
        name: [{ value: "Widget Inc" }],
      },
    },
  ];

  it("shapes all records", () => {
    const results = shapeSearchResults(records);
    expect(results).toHaveLength(2);
    expect(results[0].name).toBe("Alice Smith");
    expect(results[0].email).toBe("alice@co.com");
    expect(results[0].company).toBe("Acme");
  });

  it("filters by objectType", () => {
    const results = shapeSearchResults(records, "people");
    expect(results).toHaveLength(1);
    expect(results[0].name).toBe("Alice Smith");
  });

  it("handles records with no email/company", () => {
    const results = shapeSearchResults([records[1]]);
    expect(results[0].email).toBeNull();
    expect(results[0].company).toBeNull();
  });
});

// --- computePipelineSummary ---

describe("computePipelineSummary", () => {
  const entries = [
    {
      entry_id: "e1",
      record_id: "r1",
      entry_values: {
        stage: [{ status: { title: "Qualified" } }],
        value: [{ currency_value: 50000 }],
      },
    },
    {
      entry_id: "e2",
      record_id: "r2",
      entry_values: {
        stage: [{ status: { title: "Qualified" } }],
        value: [{ currency_value: 30000 }],
      },
    },
    {
      entry_id: "e3",
      record_id: "r3",
      entry_values: {
        stage: [{ status: { title: "Proposal" } }],
        value: [{ currency_value: 100000 }],
      },
    },
  ];

  const nameMap = new Map([
    ["r1", "Acme Deal"],
    ["r2", "Widget Deal"],
    ["r3", "Big Corp Deal"],
  ]);

  it("computes stage summaries", () => {
    const result = computePipelineSummary("list1", "Sales Pipeline", entries, nameMap);
    expect(result.totalEntries).toBe(3);
    const qualified = result.stages.find((s) => s.stage === "Qualified")!;
    expect(qualified.count).toBe(2);
    expect(qualified.totalValue).toBe(80000);
  });

  it("resolves record names", () => {
    const result = computePipelineSummary("list1", "Sales Pipeline", entries, nameMap);
    expect(result.entries[0].recordName).toBe("Acme Deal");
  });

  it("handles entries with no stage", () => {
    const noStage = [{ entry_id: "e4", record_id: "r1", entry_values: {} }];
    const result = computePipelineSummary("list1", "Test", noStage, nameMap);
    expect(result.stages[0].stage).toBe("No Stage");
  });

  it("handles entries with no value", () => {
    const noValue = [{ entry_id: "e5", record_id: "r1", entry_values: { stage: [{ status: { title: "New" } }] } }];
    const result = computePipelineSummary("list1", "Test", noValue, nameMap);
    expect(result.stages[0].totalValue).toBeNull();
    expect(result.entries[0].value).toBeNull();
  });

  it("extracts value from option title on stage", () => {
    const entries = [{
      entry_id: "e10",
      record_id: "r10",
      entry_values: { stage: [{ option: { title: "Won" } }] },
    }];
    const result = computePipelineSummary("l1", "Test", entries, new Map());
    expect(result.entries[0].stage).toBe("Won");
  });

  it("extracts value from .value on stage", () => {
    const entries = [{
      entry_id: "e11",
      record_id: "r11",
      entry_values: { stage: [{ value: "Custom Stage" }] },
    }];
    const result = computePipelineSummary("l1", "Test", entries, new Map());
    expect(result.entries[0].stage).toBe("Custom Stage");
  });

  it("extracts amount from .value on deal_value", () => {
    const entries = [{
      entry_id: "e12",
      record_id: "r12",
      entry_values: { deal_value: [{ value: 75000 }], stage: [{ status: { title: "X" } }] },
    }];
    const result = computePipelineSummary("l1", "Test", entries, new Map());
    expect(result.entries[0].value).toBe(75000);
  });

  it("handles non-array entries (data wrapper)", () => {
    const wrapped = { data: entries };
    const result = computePipelineSummary("list1", "Test", wrapped as any, nameMap);
    expect(result.totalEntries).toBe(3);
  });

  it("handles missing record in name map", () => {
    const missing = [{ entry_id: "e6", record_id: "unknown", entry_values: {} }];
    const result = computePipelineSummary("list1", "Test", missing, new Map());
    expect(result.entries[0].recordName).toBe("Record unknown");
  });
});

// --- enrichTasks ---

describe("enrichTasks", () => {
  const tasks = [
    {
      id: { task_id: "t1" },
      content_plaintext: "Follow up with Acme",
      is_completed: false,
      deadline: "2026-02-15",
      assignees: [{ referenced_actor_id: "m1" }],
      linked_records: [{ record_id: "r1" }],
    },
    {
      id: { task_id: "t2" },
      content_plaintext: "Send proposal",
      is_completed: true,
      deadline: "2026-02-10",
      assignees: [{ referenced_actor_id: "m2" }],
      linked_records: [],
    },
    {
      id: { task_id: "t3" },
      content_plaintext: "No deadline task",
      is_completed: false,
      deadline: null,
      assignees: [],
      linked_records: [],
    },
  ];

  const memberMap = new Map([["m1", "Alice Smith"], ["m2", "Bob Jones"]]);
  const recordMap = new Map([["r1", "Acme Corp"]]);

  it("separates open and completed tasks", () => {
    const result = enrichTasks(tasks, memberMap, recordMap);
    expect(result.open).toHaveLength(2);
    expect(result.completed).toHaveLength(1);
  });

  it("resolves assignee names", () => {
    const result = enrichTasks(tasks, memberMap, recordMap);
    expect(result.open[0].assignees[0]).toBe("Alice Smith");
  });

  it("resolves linked record names", () => {
    const result = enrichTasks(tasks, memberMap, recordMap);
    expect(result.open[0].linkedRecords[0]).toBe("Acme Corp");
  });

  it("sorts by deadline (with deadline first)", () => {
    const result = enrichTasks(tasks, memberMap, recordMap);
    expect(result.open[0].deadline).toBe("2026-02-15");
    expect(result.open[1].deadline).toBeNull();
  });

  it("handles unknown assignee", () => {
    const unknownTasks = [
      { id: "t99", content: "Test", is_completed: false, assignees: [{ id: "unknown" }], linked_records: [] },
    ];
    const result = enrichTasks(unknownTasks, new Map(), new Map());
    expect(result.open[0].assignees[0]).toBe("User unknown");
  });

  it("handles task with title fallback", () => {
    const titleTask = [
      { id: "t101", title: "Title Fallback", is_completed: false, assignees: [], linked_records: [] },
    ];
    const result = enrichTasks(titleTask, new Map(), new Map());
    expect(result.open[0].content).toBe("Title Fallback");
  });

  it("handles task with content fallback", () => {
    const contentTask = [
      { id: "t102", content: "Content Field", is_completed: false, assignees: [], linked_records: [] },
    ];
    const result = enrichTasks(contentTask, new Map(), new Map());
    expect(result.open[0].content).toBe("Content Field");
  });

  it("handles linked record with target_record_id", () => {
    const task = [
      { id: "t103", content: "Test", is_completed: false, assignees: [], linked_records: [{ target_record_id: "rec99" }] },
    ];
    const result = enrichTasks(task, new Map(), new Map([["rec99", "Resolved Name"]]));
    expect(result.open[0].linkedRecords[0]).toBe("Resolved Name");
  });

  it("handles task with due_date fallback", () => {
    const task = [
      { id: "t104", content: "Test", is_completed: false, due_date: "2026-03-01", assignees: [], linked_records: [] },
    ];
    const result = enrichTasks(task, new Map(), new Map());
    expect(result.open[0].deadline).toBe("2026-03-01");
  });

  it("handles string assignee ID", () => {
    const strTasks = [
      { id: "t100", content: "Test", is_completed: false, assignees: ["direct-id"], linked_records: [] },
    ];
    const result = enrichTasks(strTasks, new Map(), new Map());
    expect(result.open[0].assignees[0]).toBe("User direct-id");
  });
});

// --- buildActivityTimeline ---

describe("buildActivityTimeline", () => {
  const notes = [
    { id: { note_id: "n1" }, created_at: "2026-02-05T10:00:00Z", title: "Meeting notes", content_plaintext: "Discussed roadmap" },
    { id: { note_id: "n2" }, created_at: "2026-02-01T09:00:00Z", title: null, content: "Quick note" },
  ];

  const meetings = [
    { id: { meeting_id: "m1" }, start_time: "2026-02-06T14:00:00Z", title: "Strategy call", description: "Q1 planning" },
  ];

  const threads = [
    { id: { thread_id: "th1" }, created_at: "2026-02-04T08:00:00Z", subject: "Re: Proposal", body_plaintext: "Thanks for the update" },
  ];

  it("merges all event types into unified timeline", () => {
    const timeline = buildActivityTimeline(notes, meetings, threads);
    expect(timeline).toHaveLength(4);
  });

  it("sorts by date descending", () => {
    const timeline = buildActivityTimeline(notes, meetings, threads);
    expect(timeline[0].type).toBe("meeting"); // Feb 6
    expect(timeline[1].type).toBe("note"); // Feb 5
    expect(timeline[2].type).toBe("thread"); // Feb 4
    expect(timeline[3].type).toBe("note"); // Feb 1
  });

  it("extracts content correctly", () => {
    const timeline = buildActivityTimeline(notes, meetings, threads);
    const note = timeline.find((e) => e.id === "n1")!;
    expect(note.content).toBe("Discussed roadmap");
    const thread = timeline.find((e) => e.id === "th1")!;
    expect(thread.content).toBe("Thanks for the update");
  });

  it("handles empty arrays", () => {
    const timeline = buildActivityTimeline([], [], []);
    expect(timeline).toHaveLength(0);
  });

  it("handles events with null dates (sorted to end)", () => {
    const noDate = [{ id: "n99", created_at: null, title: "No date" }];
    const timeline = buildActivityTimeline(noDate as any, meetings, []);
    expect(timeline[timeline.length - 1].date).toBeNull();
  });

  it("uses content fallback for notes", () => {
    const timeline = buildActivityTimeline(notes, [], []);
    const note2 = timeline.find((e) => e.id === "n2")!;
    expect(note2.content).toBe("Quick note");
  });

  it("uses body fallback for threads", () => {
    const bodyThread = [{ id: "th2", created_at: "2026-01-01", subject: "Test", body: "Body text" }];
    const timeline = buildActivityTimeline([], [], bodyThread);
    expect(timeline[0].content).toBe("Body text");
  });

  it("uses meeting subject fallback when no title", () => {
    const meeting = [{ id: "m2", start_time: "2026-01-01T10:00:00Z", subject: "Subj", description: "Desc" }];
    const timeline = buildActivityTimeline([], meeting, []);
    expect(timeline[0].title).toBe("Subj");
  });

  it("uses meeting created_at when no start_time", () => {
    const meeting = [{ id: "m3", created_at: "2026-01-02T10:00:00Z", title: "T" }];
    const timeline = buildActivityTimeline([], meeting, []);
    expect(timeline[0].date).toBe("2026-01-02T10:00:00Z");
  });

  it("uses string id when no nested meeting_id", () => {
    const meeting = [{ id: "plain-id", start_time: "2026-01-01" }];
    const timeline = buildActivityTimeline([], meeting, []);
    expect(timeline[0].id).toBe("plain-id");
  });

  it("uses string id when no nested thread_id", () => {
    const thread = [{ id: "plain-tid", created_at: "2026-01-01", subject: "S" }];
    const timeline = buildActivityTimeline([], [], thread);
    expect(timeline[0].id).toBe("plain-tid");
  });

  it("uses string id when no nested note_id", () => {
    const note = [{ id: "plain-nid", created_at: "2026-01-01", title: "N" }];
    const timeline = buildActivityTimeline(note, [], []);
    expect(timeline[0].id).toBe("plain-nid");
  });

  it("sorts two null dates as equal", () => {
    const a = [{ id: "n1", created_at: null, title: "A" }];
    const b = [{ id: "n2", created_at: null, title: "B" }];
    const timeline = buildActivityTimeline([...a, ...b] as any, [], []);
    expect(timeline).toHaveLength(2);
  });

  it("handles meeting with null description", () => {
    const meeting = [{ id: "m4", start_time: "2026-01-01", title: "T" }];
    const timeline = buildActivityTimeline([], meeting, []);
    expect(timeline[0].content).toBeNull();
  });

  it("handles thread with null body_plaintext but body present", () => {
    const thread = [{ id: "th3", created_at: "2026-01-01", body: "Fallback body" }];
    const timeline = buildActivityTimeline([], [], thread);
    expect(timeline[0].content).toBe("Fallback body");
  });
});

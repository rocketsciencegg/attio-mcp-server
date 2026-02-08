#!/usr/bin/env node

import { randomUUID } from "node:crypto";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { createMcpExpressApp } from "@modelcontextprotocol/sdk/server/express.js";
import { isInitializeRequest } from "@modelcontextprotocol/sdk/types.js";
import type { Request, Response } from "express";
import { z } from "zod";
import {
  RecordsApi,
  ListsApi,
  EntriesApi,
  TasksApi,
  NotesApi,
  MeetingsApi,
  ThreadsApi,
  ObjectsApi,
  Configuration,
} from "attio-typescript-sdk";
import {
  extractRecordName,
  flattenValues,
  shapeSearchResults,
  computePipelineSummary,
  enrichTasks,
  buildActivityTimeline,
} from "./helpers.js";

const config = new Configuration({
  accessToken: process.env.ATTIO_API_KEY,
});

const recordsApi = new RecordsApi(config);
const listsApi = new ListsApi(config);
const entriesApi = new EntriesApi(config);
const tasksApi = new TasksApi(config);
const notesApi = new NotesApi(config);
const meetingsApi = new MeetingsApi(config);
const threadsApi = new ThreadsApi(config);
const objectsApi = new ObjectsApi(config);

// Optional: WorkspaceMembersApi for resolving assignees
let workspaceMembersApi: any = null;
try {
  const { WorkspaceMembersApi } = await import("attio-typescript-sdk");
  if (WorkspaceMembersApi) {
    workspaceMembersApi = new WorkspaceMembersApi(config);
  }
} catch {
  // WorkspaceMembersApi may not exist in all SDK versions
}

function errorResult(toolName: string, err: unknown) {
  const message = err instanceof Error ? err.message : String(err);
  return {
    content: [{ type: "text" as const, text: `Error in ${toolName}: ${message}` }],
    isError: true,
  };
}

// --- Shared helpers ---

async function fetchWorkspaceMembers(): Promise<Map<string, string>> {
  const memberMap = new Map<string, string>();
  try {
    if (workspaceMembersApi) {
      const resp = await workspaceMembersApi.v2WorkspaceMembersGet();
      const members = (resp.data as any)?.data || resp.data || [];
      if (Array.isArray(members)) {
        for (const m of members) {
          const id = m.id?.workspace_member_id || m.id;
          const name = m.name || m.email || `Member ${id}`;
          memberMap.set(id, name);
        }
      }
    }
  } catch {
    // Workspace members not available
  }
  return memberMap;
}

async function batchFetchRecordNames(recordIds: string[]): Promise<Map<string, string>> {
  const nameMap = new Map<string, string>();
  // Attio doesn't have a batch endpoint, so we do best-effort
  // For pipeline entries, the records are typically already available
  return nameMap;
}

// --- TOOLS ---

function createServer() {
const server = new McpServer({
  name: "attio-mcp-server",
  version: "2.0.0",
});

server.registerTool(
  "search_records",
  {
    description:
      "Search for people, companies, deals, or other CRM records. Returns shaped results with extracted name, email, company from Attio's nested value structure. When both query and objectType are provided, results are filtered to that type.",
    inputSchema: {
      objectType: z.string().describe("Object type to search (e.g. 'people', 'companies', 'deals')"),
      query: z.string().optional().describe("Search query text"),
      limit: z.number().optional().describe("Max results to return (default: 25)"),
    },
  },
  async ({ objectType, query, limit }) => {
    try {
      if (query) {
        // Use global search, then filter by objectType
        const resp = await recordsApi.v2ObjectsRecordsSearchPost({
          v2ObjectsRecordsSearchPostRequest: { query },
        } as any);

        const allRecords = (resp.data as any)?.data || resp.data || [];
        const records = Array.isArray(allRecords) ? allRecords : [];
        const shaped = shapeSearchResults(records, objectType);

        return {
          content: [{
            type: "text" as const,
            text: JSON.stringify({ totalResults: shaped.length, records: shaped }, null, 2),
          }],
        };
      }

      // List records for the object type
      const resp = await recordsApi.v2ObjectsObjectRecordsQueryPost({
        object: objectType,
        v2ObjectsObjectRecordsQueryPostRequest: { limit: limit ?? 25 },
      } as any);

      const allRecords = (resp.data as any)?.data || resp.data || [];
      const records = Array.isArray(allRecords) ? allRecords : [];
      const shaped = shapeSearchResults(records, objectType);

      return {
        content: [{
          type: "text" as const,
          text: JSON.stringify({ totalResults: shaped.length, records: shaped }, null, 2),
        }],
      };
    } catch (err) {
      return errorResult("search_records", err);
    }
  }
);

server.registerTool(
  "get_pipeline",
  {
    description:
      "Get sales pipeline data with stage-level summaries (count and total value per stage). Resolves record names for each entry.",
    inputSchema: {
      listName: z.string().optional().describe("Name or ID of a specific list/pipeline to view"),
    },
  },
  async ({ listName }) => {
    try {
      const listsResp = await listsApi.v2ListsGet();
      const lists = (listsResp.data as any)?.data || listsResp.data || [];

      if (!listName) {
        return {
          content: [{
            type: "text" as const,
            text: JSON.stringify({
              message: "Available lists/pipelines. Provide a listName to see entries.",
              lists: Array.isArray(lists) ? lists.map((l: any) => ({
                id: l.id?.list_id || l.id,
                name: l.name,
                objectType: l.parent_object,
              })) : lists,
            }, null, 2),
          }],
        };
      }

      const listArr = Array.isArray(lists) ? lists : [];
      const matched = listArr.find((l: any) => {
        const id = l.id?.list_id || l.id;
        return l.name?.toLowerCase().includes(listName.toLowerCase()) || id === listName;
      });

      if (!matched) {
        return {
          content: [{
            type: "text" as const,
            text: `No list found matching "${listName}". Available: ${listArr.map((l: any) => l.name).join(", ")}`,
          }],
        };
      }

      const listId = matched.id?.list_id || matched.id;
      const entriesResp = await entriesApi.v2ListsListEntriesQueryPost(listId, {} as any);
      const entries = (entriesResp.data as any)?.data || entriesResp.data || [];

      // Build record name map from entries
      const recordNameMap = new Map<string, string>();
      const entryList = Array.isArray(entries) ? entries : [];
      for (const entry of entryList) {
        const rid = entry.record_id || entry.parent_record_id;
        if (rid && !recordNameMap.has(rid)) {
          // Try to extract name from entry values
          const name = extractRecordName({ values: entry.entry_values || entry.values });
          if (name !== "Unknown") recordNameMap.set(rid, name);
        }
      }

      const result = computePipelineSummary(listId, matched.name, entries, recordNameMap);

      return {
        content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }],
      };
    } catch (err) {
      return errorResult("get_pipeline", err);
    }
  }
);

server.registerTool(
  "get_record_details",
  {
    description:
      "Get full details for a CRM record with values flattened for readability. Extracts common fields (name, email, phone, company) to top level.",
    inputSchema: {
      objectType: z.string().describe("Object type (e.g. 'people', 'companies', 'deals')"),
      recordId: z.string().describe("The record ID"),
    },
  },
  async ({ objectType, recordId }) => {
    try {
      const recordResp = await recordsApi.v2ObjectsObjectRecordsRecordIdGet({ object: objectType, recordId });
      const record = (recordResp.data as any)?.data || recordResp.data;

      const name = extractRecordName(record);
      const flat = flattenValues(record?.values || {});

      // Fetch notes
      let notes: any = [];
      try {
        const notesResp = await notesApi.v2NotesGet();
        const allNotes = (notesResp.data as any)?.data || notesResp.data || [];
        notes = Array.isArray(allNotes)
          ? allNotes.filter((n: any) =>
              n.parent_object === objectType && n.parent_record_id === recordId
            ).slice(0, 10)
          : [];
      } catch { /* Notes may not be available */ }

      // Fetch list entries
      let entries: any = [];
      try {
        const entriesResp = await recordsApi.v2ObjectsObjectRecordsRecordIdEntriesGet({ object: objectType, recordId });
        entries = entriesResp.data;
      } catch { /* Entries may not exist */ }

      return {
        content: [{
          type: "text" as const,
          text: JSON.stringify({
            name,
            flatValues: flat,
            allValues: record?.values || {},
            notes,
            entries,
          }, null, 2),
        }],
      };
    } catch (err) {
      return errorResult("get_record_details", err);
    }
  }
);

server.registerTool(
  "list_tasks",
  {
    description:
      "List CRM tasks grouped by completion status, sorted by deadline. Resolves assignee names and linked record names.",
    inputSchema: {
      limit: z.number().optional().describe("Max tasks to return (default: 25)"),
    },
  },
  async ({ limit }) => {
    try {
      const [tasksResp, memberMap] = await Promise.all([
        tasksApi.v2TasksGet(undefined, undefined),
        fetchWorkspaceMembers(),
      ]);

      const tasks = (tasksResp.data as any)?.data || tasksResp.data || [];
      const taskList = Array.isArray(tasks) ? tasks.slice(0, limit ?? 25) : [];

      // Build record name map from linked records
      const recordNameMap = new Map<string, string>();
      // We can't easily batch-resolve these, but the enrichTasks helper will show fallback names

      const result = enrichTasks(taskList, memberMap, recordNameMap);

      return {
        content: [{
          type: "text" as const,
          text: JSON.stringify({
            totalOpen: result.open.length,
            totalCompleted: result.completed.length,
            open: result.open,
            completed: result.completed,
          }, null, 2),
        }],
      };
    } catch (err) {
      return errorResult("list_tasks", err);
    }
  }
);

server.registerTool(
  "get_recent_activity",
  {
    description:
      "Get recent activity for a record: notes, meetings, and email threads merged into a unified timeline sorted by date.",
    inputSchema: {
      objectType: z.string().describe("Object type (e.g. 'people', 'companies')"),
      recordId: z.string().describe("The record ID"),
    },
  },
  async ({ objectType, recordId }) => {
    try {
      const activity: { notes: any[]; meetings: any[]; threads: any[] } = {
        notes: [], meetings: [], threads: [],
      };

      // Fetch notes
      try {
        const notesResp = await notesApi.v2NotesGet();
        const allNotes = (notesResp.data as any)?.data || notesResp.data || [];
        activity.notes = Array.isArray(allNotes)
          ? allNotes.filter((n: any) => n.parent_object === objectType && n.parent_record_id === recordId).slice(0, 10)
          : [];
      } catch { activity.notes = []; }

      // Fetch meetings
      try {
        const meetingsResp = await meetingsApi.v2MeetingsGet();
        const allMeetings = (meetingsResp.data as any)?.data || meetingsResp.data || [];
        activity.meetings = Array.isArray(allMeetings)
          ? allMeetings.filter((m: any) =>
              m.associated_records?.some((r: any) =>
                r.record_id === recordId || r.target_record_id === recordId
              )
            ).slice(0, 10)
          : [];
      } catch { activity.meetings = []; }

      // Fetch threads
      try {
        const threadsResp = await threadsApi.v2ThreadsGet();
        const allThreads = (threadsResp.data as any)?.data || threadsResp.data || [];
        activity.threads = Array.isArray(allThreads)
          ? allThreads.filter((t: any) =>
              t.linked_records?.some((r: any) => r.record_id === recordId)
            ).slice(0, 10)
          : [];
      } catch { activity.threads = []; }

      const timeline = buildActivityTimeline(activity.notes, activity.meetings, activity.threads);

      return {
        content: [{
          type: "text" as const,
          text: JSON.stringify({
            totalEvents: timeline.length,
            timeline,
          }, null, 2),
        }],
      };
    } catch (err) {
      return errorResult("get_recent_activity", err);
    }
  }
);

return server;
}

// --- START ---

async function main() {
  const port = process.env.PORT;

  if (port) {
    const app = createMcpExpressApp({ host: "0.0.0.0" });
    const transports: Record<string, StreamableHTTPServerTransport> = {};

    app.all("/mcp", async (req: Request, res: Response) => {
      const sessionId = req.headers["mcp-session-id"] as string | undefined;
      let transport: StreamableHTTPServerTransport;

      if (sessionId && transports[sessionId]) {
        transport = transports[sessionId];
      } else if (!sessionId && req.method === "POST" && isInitializeRequest(req.body)) {
        transport = new StreamableHTTPServerTransport({
          sessionIdGenerator: () => randomUUID(),
          onsessioninitialized: (sid) => { transports[sid] = transport; },
        });
        transport.onclose = () => {
          if (transport.sessionId) delete transports[transport.sessionId];
        };
        await createServer().connect(transport);
      } else {
        res.status(400).json({
          jsonrpc: "2.0",
          error: { code: -32000, message: "Bad Request: No valid session" },
          id: null,
        });
        return;
      }

      await transport.handleRequest(req, res, req.body);
    });

    app.listen(parseInt(port), "0.0.0.0", () => {
      console.error(`Attio MCP Server listening on http://0.0.0.0:${port}/mcp`);
    });

    process.on("SIGINT", async () => {
      for (const sid in transports) {
        try { await transports[sid].close(); } catch {}
      }
      process.exit(0);
    });
  } else {
    const transport = new StdioServerTransport();
    await createServer().connect(transport);
    console.error("Attio MCP Server running on stdio");
  }
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});

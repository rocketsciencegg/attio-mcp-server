#!/usr/bin/env node

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
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

const server = new McpServer({
  name: "attio-mcp-server",
  version: "1.0.0",
});

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

function errorResult(toolName: string, err: unknown) {
  const message = err instanceof Error ? err.message : String(err);
  return {
    content: [{ type: "text" as const, text: `Error in ${toolName}: ${message}` }],
    isError: true,
  };
}

// --- TOOLS ---

server.registerTool(
  "search_records",
  {
    description:
      "Search for people, companies, deals, or other CRM records by criteria. Uses Attio's full-text search across record types.",
    inputSchema: {
      objectType: z.string().describe("Object type to search (e.g. 'people', 'companies', 'deals')"),
      query: z.string().optional().describe("Search query text"),
      limit: z.number().optional().describe("Max results to return (default: 25)"),
    },
  },
  async ({ objectType, query, limit }) => {
    try {
      if (query) {
        // Use global search
        const resp = await recordsApi.v2ObjectsRecordsSearchPost({
          v2ObjectsRecordsSearchPostRequest: {
            query,
          },
        } as any);

        const data = resp.data;
        return {
          content: [{ type: "text" as const, text: JSON.stringify(data, null, 2) }],
        };
      }

      // List records for the object type
      const resp = await recordsApi.v2ObjectsObjectRecordsQueryPost({
        object: objectType,
        v2ObjectsObjectRecordsQueryPostRequest: {
          limit: limit ?? 25,
        },
      } as any);

      return {
        content: [{ type: "text" as const, text: JSON.stringify(resp.data, null, 2) }],
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
      "Get sales pipeline data. Lists available lists (pipelines) and their entries with stage, value, and status.",
    inputSchema: {
      listName: z.string().optional().describe("Name or ID of a specific list/pipeline to view"),
    },
  },
  async ({ listName }) => {
    try {
      // Get all lists
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

      // Find matching list
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
      const entriesResp = await entriesApi.v2ListsListEntriesQueryPost(
        listId,
        {} as any
      );

      return {
        content: [{
          type: "text" as const,
          text: JSON.stringify({
            list: { id: listId, name: matched.name },
            entries: entriesResp.data,
          }, null, 2),
        }],
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
      "Get full details for a specific CRM record including all attributes, notes, and list entries.",
    inputSchema: {
      objectType: z.string().describe("Object type (e.g. 'people', 'companies', 'deals')"),
      recordId: z.string().describe("The record ID"),
    },
  },
  async ({ objectType, recordId }) => {
    try {
      const recordResp = await recordsApi.v2ObjectsObjectRecordsRecordIdGet({ object: objectType, recordId });
      const record = recordResp.data;

      // Also fetch notes for this record
      let notes: any = [];
      try {
        const notesResp = await notesApi.v2NotesGet();
        const allNotes = (notesResp.data as any)?.data || notesResp.data || [];
        notes = Array.isArray(allNotes)
          ? allNotes.filter((n: any) =>
              n.parent_object === objectType && n.parent_record_id === recordId
            ).slice(0, 10)
          : [];
      } catch {
        // Notes may not be available for all record types
      }

      // Fetch list entries
      let entries: any = [];
      try {
        const entriesResp = await recordsApi.v2ObjectsObjectRecordsRecordIdEntriesGet({ object: objectType, recordId });
        entries = entriesResp.data;
      } catch {
        // Entries may not exist
      }

      return {
        content: [{
          type: "text" as const,
          text: JSON.stringify({ record, notes, entries }, null, 2),
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
      "List CRM tasks with their assignees, due dates, and linked records.",
    inputSchema: {
      limit: z.number().optional().describe("Max tasks to return (default: 25)"),
    },
  },
  async ({ limit }) => {
    try {
      const resp = await tasksApi.v2TasksGet(
        undefined, // limit
        undefined, // offset
      );

      const tasks = (resp.data as any)?.data || resp.data || [];
      const taskList = Array.isArray(tasks) ? tasks.slice(0, limit ?? 25) : tasks;

      return {
        content: [{ type: "text" as const, text: JSON.stringify({ tasks: taskList }, null, 2) }],
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
      "Get recent activity for a record including notes, meetings, and email threads.",
    inputSchema: {
      objectType: z.string().describe("Object type (e.g. 'people', 'companies')"),
      recordId: z.string().describe("The record ID"),
    },
  },
  async ({ objectType, recordId }) => {
    try {
      const activity: Record<string, any> = {};

      // Fetch notes
      try {
        const notesResp = await notesApi.v2NotesGet();
        const allNotes = (notesResp.data as any)?.data || notesResp.data || [];
        activity.notes = Array.isArray(allNotes)
          ? allNotes
              .filter((n: any) => n.parent_object === objectType && n.parent_record_id === recordId)
              .slice(0, 10)
          : [];
      } catch {
        activity.notes = [];
      }

      // Fetch threads
      try {
        const threadsResp = await threadsApi.v2ThreadsGet();
        const allThreads = (threadsResp.data as any)?.data || threadsResp.data || [];
        activity.threads = Array.isArray(allThreads)
          ? allThreads
              .filter((t: any) =>
                t.linked_records?.some((r: any) => r.record_id === recordId)
              )
              .slice(0, 10)
          : [];
      } catch {
        activity.threads = [];
      }

      return {
        content: [{ type: "text" as const, text: JSON.stringify(activity, null, 2) }],
      };
    } catch (err) {
      return errorResult("get_recent_activity", err);
    }
  }
);

// --- START ---

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error("Attio MCP Server running on stdio");
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});

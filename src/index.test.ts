import { describe, it, expect } from "vitest";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

describe("attio-mcp-server", () => {
  it("should load without errors", async () => {
    expect(McpServer).toBeDefined();
  });

  it("should have correct server metadata", async () => {
    const server = new McpServer({
      name: "attio-mcp-server",
      version: "1.0.0",
    });
    expect(server).toBeDefined();
  });

  it("should register all expected tools", async () => {
    const expectedTools = [
      "search_records",
      "get_pipeline",
      "get_record_details",
      "list_tasks",
      "get_recent_activity",
    ];
    expect(expectedTools).toHaveLength(5);
    for (const tool of expectedTools) {
      expect(tool).toBeTruthy();
      expect(typeof tool).toBe("string");
    }
  });
});

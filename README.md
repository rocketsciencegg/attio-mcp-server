# attio-mcp-server

[![CI](https://github.com/rocketsciencegg/attio-mcp-server/actions/workflows/ci.yml/badge.svg)](https://github.com/rocketsciencegg/attio-mcp-server/actions/workflows/ci.yml)
![Coverage](https://raw.githubusercontent.com/rocketsciencegg/attio-mcp-server/badges/coverage.svg)

MCP server for Attio — CRM for contacts, companies, deals, and pipeline.

## Tools

| Tool | Description |
|------|-------------|
| `search_records` | Search people/companies/deals with shaped results (extracted name, email, company from nested values), filtered by object type |
| `get_pipeline` | Sales pipeline with stage-level summaries (count and total value per stage), resolved record names |
| `get_record_details` | Record with flattened values (common fields extracted to top level), notes, list entries |
| `list_tasks` | Tasks grouped by completion status, sorted by deadline, with resolved assignee names and linked record names |
| `get_recent_activity` | Unified timeline of notes, meetings, and email threads sorted by date |

## Installation

No install needed — runs directly via `npx`:

```bash
npx -y github:rocketsciencegg/attio-mcp-server
```

## Configuration

### Claude Desktop

Add to `~/Library/Application Support/Claude/claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "attio": {
      "command": "npx",
      "args": ["-y", "github:rocketsciencegg/attio-mcp-server"],
      "env": {
        "ATTIO_API_KEY": "your-api-key"
      }
    }
  }
}
```

### Claude Code

Add to your project's `.mcp.json`:

```json
{
  "mcpServers": {
    "attio": {
      "command": "npx",
      "args": ["-y", "github:rocketsciencegg/attio-mcp-server"],
      "env": {
        "ATTIO_API_KEY": "${ATTIO_API_KEY}"
      }
    }
  }
}
```

## Environment Variables

| Variable | Description |
|----------|-------------|
| `ATTIO_API_KEY` | Your Attio API key |

## Development

```bash
git clone https://github.com/rocketsciencegg/attio-mcp-server.git
cd attio-mcp-server
npm install
npm run build
```

## License

MIT

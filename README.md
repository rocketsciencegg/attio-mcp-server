# attio-mcp-server

MCP server for Attio — CRM for contacts, companies, deals, and pipeline.

## Tools

| Tool | Description |
|------|-------------|
| `search_records` | Search for people, companies, deals, or other CRM records by criteria |
| `get_pipeline` | Get sales pipeline data with list entries, stages, and values |
| `get_record_details` | Get full details for a specific record including attributes, notes, and list entries |
| `list_tasks` | List CRM tasks with assignees, due dates, and linked records |
| `get_recent_activity` | Get recent activity for a record including notes, meetings, and email threads |

## Installation

```bash
npm install -g github:rocketsciencegg/attio-mcp-server
```

## Configuration

### Claude Desktop

Add to `~/Library/Application Support/Claude/claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "attio": {
      "command": "attio-mcp-server",
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
      "command": "attio-mcp-server",
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

# M3n0ko0g Skills MCP server

Serves the M3n0ko0g skills library over the Model Context Protocol, so an agent can find and read the right skill on demand instead of you pasting one in.

Twelve skills. Ten of them form an audit pass for legacy AI systems: the prompt chains, RAG v1 pipelines, fine-tunes, vector stores and orchestration glue assembled between 2021 and 2026 that nobody inside can explain, audit, or sign off on.

Zero dependencies. A tool that audits other people's dependency surface should be careful about its own.

## Install

Nothing to install. Point your client at `server.mjs` with Node 18 or newer.

**Claude Desktop**, in `claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "m3n0ko0g-skills": {
      "command": "node",
      "args": ["/absolute/path/to/m3n0ko0g-skills/mcp/server.mjs"]
    }
  }
}
```

On Windows a full path with forward slashes works:

```json
"args": ["C:/src/m3n0ko0g-skills/mcp/server.mjs"]
```

**Claude Code**, from the repo root:

```
claude mcp add m3n0ko0g-skills -- node ./mcp/server.mjs
```

**Anything else that speaks MCP over stdio**: run `node server.mjs` and talk JSON-RPC to it.

Restart the client after adding it. Then ask something like *"our RAG gives confident wrong answers, which M3n0ko0g skill applies?"*

## What it exposes

### Tools

| Tool | What it does |
|---|---|
| `list_skills` | Every skill with version and description. The audit pass comes back in the order you would run it. Optional `track` filter: `audit` or `general`. |
| `get_skill` | The full SKILL.md for one skill: method, what to look for, output format, receipt, rules. |
| `search_skills` | Find the right skill from a description of the problem. Searches names, descriptions and full text, and returns a snippet so the agent can judge relevance before pulling the whole file. |
| `new_receipt` | Build a compliant run receipt with a fresh random id and a UTC timestamp. `human` always starts at `pending`. |

### Resources

Every skill is also a resource at `skill://<name>`, plus `skill://TRACEABILITY` for the receipt convention.

## Where it finds the skills

In this order:

1. `$M3N0KO0G_SKILLS_DIR`, if set
2. `./skills/` next to `server.mjs` (how the standalone bundle ships)
3. `../skills/` (a checkout of this repo)

## Test it

```
node test-server.mjs
```

Spawns the real server and speaks actual JSON-RPC to it over stdio. No mock. If it passes, an MCP client can drive it.

```
node server.mjs --list      # print the library and exit
node server.mjs --version
```

## License

Apache-2.0. See the LICENSE file at the repo root.

Part of the free skills library by M3n0ko0g.

LAHA, Love All Humans Always.

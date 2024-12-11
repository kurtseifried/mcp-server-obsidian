# Obsidian Model Context Protocol

This is a connector to allow Claude Desktop (or any MCP client) to interact with any directory containing Markdown notes (such as an Obsidian vault). It supports reading and searching by default, with optional write capabilities.

## Features

- **Read Notes**: Read the contents of multiple notes simultaneously
- **Search Notes**: Search for notes by name with case-insensitive matching and regex support
- **Write Notes** (optional): Create new notes or overwrite existing ones
- **Update Notes** (optional): Modify existing notes with options to replace, append, or prepend content

## Installation

### Prerequisites
1. Node.js and npm installed
2. Claude Desktop installed
3. An Obsidian vault or directory with markdown files

### Global Installation
```bash
npm install -g mcp-obsidian
```

### Configuration
Modify your Claude Desktop config located at:

`~/Library/Application\ Support/Claude/claude_desktop_config.json`

You can find this through the Claude Desktop menu:
1. Open Claude Desktop
2. Click Claude on the Mac menu bar
3. Click "Settings"
4. Click "Developer"

If the config file doesn't exist, create it with this structure:

```json
{
    "mcpServers": {
        "markdown": {
            "command": "mcp-obsidian",
            "args": [
                "<path-to-your-vault>"
            ]
        }
    }
}
```

To enable write operations, add the `--enable-write` flag:

```json
{
    "mcpServers": {
        "markdown": {
            "command": "mcp-obsidian",
            "args": [
                "<path-to-your-vault>",
                "--enable-write"
            ]
        }
    }
}
```

Replace `<path-to-your-vault>` with the actual path to your notes directory.

### Quick Start with npx
Alternatively, you can use npx for a quick start:

```json
{
    "mcpServers": {
        "markdown": {
            "command": "npx",
            "args": [
                "-y",
                "mcp-obsidian",
                "<path-to-your-vault>"
            ]
        }
    }
}
```

## Available Tools

### Always Available
#### read_notes
Read the contents of multiple notes. Each note's content is returned with its path as a reference.

#### search_notes
Search for notes by name. The search is case-insensitive and matches partial names. Queries can also use regex patterns.

### Available with --enable-write Flag
#### write_note
Create a new note or completely overwrite an existing note. Can optionally create parent directories if they don't exist.

#### update_note
Update an existing note using one of three modes:
- replace: Replace entire content
- append: Add new content to the end
- prepend: Add new content to the beginning

## Security Features

- Read-only by default
- Path validation to prevent directory traversal
- Restricted to specified vault directory
- Hidden file protections
- Symlink security checks
- Enforced .md extension for all operations

## Command Line Options

- `<vault-directory>`: Required. Path to your notes directory
- `--enable-write` or `-w`: Optional. Enable write operations (disabled by default)

## Example Usage

After installation and configuration, start Claude Desktop and you should see the MCP tools listed:

![image](./images/mcp-tools.png)

You can interact with your notes through Claude using natural language. For example:
- "Search for notes about project ideas"
- "Find all notes that mention 'machine learning'"
- "Read the contents of meeting-notes.md"
- "Create a new note called 'meeting-notes.md' with today's date" (requires --enable-write)
- "Add a new task to my todo.md file" (requires --enable-write)
- "Update my project-status.md with the latest progress" (requires --enable-write)

## Development

### Building from Source
```bash
git clone https://github.com/your-username/mcp-server-obsidian.git
cd mcp-server-obsidian
npm install
npm run build
```

### Running Tests
```bash
npm test
```

## Version
1.0.0

## Author
Henry Mao (https://calclavia.com)

## License
MIT
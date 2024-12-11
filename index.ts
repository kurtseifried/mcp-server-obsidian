#!/usr/bin/env node

import { Server } from "@modelcontextprotocol/sdk/server/index.js"
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js"
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  ToolSchema,
} from "@modelcontextprotocol/sdk/types.js"
import fs from "fs/promises"
import path from "path"
import os from "os"
import { z } from "zod"
import { zodToJsonSchema } from "zod-to-json-schema"

// Maximum number of search results to return
const SEARCH_LIMIT = 200

// Parse command line arguments with flags
interface ServerConfig {
  vaultPath: string
  enableWrite: boolean
}

function parseArgs(): ServerConfig {
  const args = process.argv.slice(2)
  let config: ServerConfig = {
    vaultPath: '',
    enableWrite: false
  }

  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--enable-write' || args[i] === '-w') {
      config.enableWrite = true
    } else if (!config.vaultPath) {
      config.vaultPath = args[i]
    }
  }

  if (!config.vaultPath) {
    console.error("Usage: mcp-obsidian <vault-directory> [--enable-write|-w]")
    process.exit(1)
  }

  return config
}

const config = parseArgs()

// Normalize all paths consistently
function normalizePath(p: string): string {
  return path.normalize(p).toLowerCase()
}

function expandHome(filepath: string): string {
  if (filepath.startsWith("~/") || filepath === "~") {
    return path.join(os.homedir(), filepath.slice(1))
  }
  return filepath
}

// Store allowed directories in normalized form
const vaultDirectories = [normalizePath(path.resolve(expandHome(config.vaultPath)))]

// Validate that directory exists and is accessible
try {
  const stats = await fs.stat(config.vaultPath)
  if (!stats.isDirectory()) {
    console.error(`Error: ${config.vaultPath} is not a directory`)
    process.exit(1)
  }
} catch (error) {
  console.error(`Error accessing directory ${config.vaultPath}:`, error)
  process.exit(1)
}

// Security utilities
async function validatePath(requestedPath: string): Promise<string> {
  // Ignore hidden files/directories starting with "."
  const pathParts = requestedPath.split(path.sep)
  if (pathParts.some((part) => part.startsWith("."))) {
    throw new Error("Access denied - hidden files/directories not allowed")
  }

  const expandedPath = expandHome(requestedPath)
  const absolute = path.isAbsolute(expandedPath)
    ? path.resolve(expandedPath)
    : path.resolve(process.cwd(), expandedPath)

  const normalizedRequested = normalizePath(absolute)

  // Check if path is within allowed directories
  const isAllowed = vaultDirectories.some((dir) =>
    normalizedRequested.startsWith(dir)
  )
  if (!isAllowed) {
    throw new Error(
      `Access denied - path outside allowed directories: ${absolute} not in ${vaultDirectories.join(
        ", "
      )}`
    )
  }

  // Handle symlinks by checking their real path
  try {
    const realPath = await fs.realpath(absolute)
    const normalizedReal = normalizePath(realPath)
    const isRealPathAllowed = vaultDirectories.some((dir) =>
      normalizedReal.startsWith(dir)
    )
    if (!isRealPathAllowed) {
      throw new Error(
        "Access denied - symlink target outside allowed directories"
      )
    }
    return realPath
  } catch (error) {
    // For new files that don't exist yet, verify parent directory
    const parentDir = path.dirname(absolute)
    try {
      const realParentPath = await fs.realpath(parentDir)
      const normalizedParent = normalizePath(realParentPath)
      const isParentAllowed = vaultDirectories.some((dir) =>
        normalizedParent.startsWith(dir)
      )
      if (!isParentAllowed) {
        throw new Error(
          "Access denied - parent directory outside allowed directories"
        )
      }
      return absolute
    } catch {
      throw new Error(`Parent directory does not exist: ${parentDir}`)
    }
  }
}

// Ensure directory exists
async function ensureDirectory(dirPath: string): Promise<void> {
  try {
    await fs.access(dirPath)
  } catch {
    await fs.mkdir(dirPath, { recursive: true })
  }
}

/**
 * Search for notes in the allowed directories that match the query.
 * @param query - The query to search for.
 * @returns An array of relative paths to the notes (from root) that match the query.
 */
async function searchNotes(query: string): Promise<string[]> {
  const results: string[] = []

  async function search(basePath: string, currentPath: string) {
    const entries = await fs.readdir(currentPath, { withFileTypes: true })

    for (const entry of entries) {
      const fullPath = path.join(currentPath, entry.name)

      try {
        // Validate each path before processing
        await validatePath(fullPath)

        let matches = entry.name.toLowerCase().includes(query.toLowerCase())
        try {
          matches =
            matches ||
            new RegExp(query.replace(/[*]/g, ".*"), "i").test(entry.name)
        } catch {
          // Ignore invalid regex
        }

        if (entry.name.endsWith(".md") && matches) {
          // Turn into relative path
          results.push(fullPath.replace(basePath, ""))
        }

        if (entry.isDirectory()) {
          await search(basePath, fullPath)
        }
      } catch (error) {
        // Skip invalid paths during search
        continue
      }
    }
  }

  await Promise.all(vaultDirectories.map((dir) => search(dir, dir)))
  return results
}

// Schema definitions
const ReadNotesArgsSchema = z.object({
  paths: z.array(z.string()),
})

const SearchNotesArgsSchema = z.object({
  query: z.string(),
})

const WriteNoteArgsSchema = z.object({
  path: z.string(),
  content: z.string(),
  createDirectories: z.boolean().optional().default(false),
})

const UpdateNoteArgsSchema = z.object({
  path: z.string(),
  content: z.string(),
  mode: z.enum(['replace', 'append', 'prepend']).default('replace'),
})

const ToolInputSchema = ToolSchema.shape.inputSchema
type ToolInput = z.infer<typeof ToolInputSchema>

// Server setup
const server = new Server(
  {
    name: "mcp-obsidian",
    version: "1.0.0",
  },
  {
    capabilities: {
      tools: {},
    },
  }
)

// Tool handlers
server.setRequestHandler(ListToolsRequestSchema, async () => {
  // Base tools always available
  const tools = [
    {
      name: "read_notes",
      description:
        "Read the contents of multiple notes. Each note's content is returned with its " +
        "path as a reference. Failed reads for individual notes won't stop " +
        "the entire operation. Reading too many at once may result in an error.",
      inputSchema: zodToJsonSchema(ReadNotesArgsSchema) as ToolInput,
    },
    {
      name: "search_notes",
      description:
        "Searches for a note by its name. The search " +
        "is case-insensitive and matches partial names. " +
        "Queries can also be a valid regex. Returns paths of the notes " +
        "that match the query.",
      inputSchema: zodToJsonSchema(SearchNotesArgsSchema) as ToolInput,
    },
  ]

  // Add write tools only if enabled
  if (config.enableWrite) {
    tools.push(
      {
        name: "write_note",
        description:
          "Creates a new note or completely overwrites an existing note. " +
          "Can optionally create parent directories if they don't exist. " +
          "Path must end in .md extension.",
        inputSchema: zodToJsonSchema(WriteNoteArgsSchema) as ToolInput,
      },
      {
        name: "update_note",
        description:
          "Updates an existing note. Can replace entire content, append to end, " +
          "or prepend to beginning. Path must end in .md extension.",
        inputSchema: zodToJsonSchema(UpdateNoteArgsSchema) as ToolInput,
      }
    )
  }

  return { tools }
})

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  try {
    const { name, arguments: args } = request.params

    // Check write permission for write operations
    if ((name === 'write_note' || name === 'update_note') && !config.enableWrite) {
      throw new Error('Write operations are disabled. Start the server with --enable-write to enable them.')
    }

    switch (name) {
      case "read_notes": {
        const parsed = ReadNotesArgsSchema.safeParse(args)
        if (!parsed.success) {
          throw new Error(`Invalid arguments for read_notes: ${parsed.error}`)
        }
        const results = await Promise.all(
          parsed.data.paths.map(async (filePath: string) => {
            try {
              const validPath = await validatePath(
                path.join(vaultDirectories[0], filePath)
              )
              const content = await fs.readFile(validPath, "utf-8")
              return `${filePath}:\n${content}\n`
            } catch (error) {
              const errorMessage =
                error instanceof Error ? error.message : String(error)
              return `${filePath}: Error - ${errorMessage}`
            }
          })
        )
        return {
          content: [{ type: "text", text: results.join("\n---\n") }],
        }
      }

      case "search_notes": {
        const parsed = SearchNotesArgsSchema.safeParse(args)
        if (!parsed.success) {
          throw new Error(`Invalid arguments for search_notes: ${parsed.error}`)
        }
        const results = await searchNotes(parsed.data.query)

        const limitedResults = results.slice(0, SEARCH_LIMIT)
        return {
          content: [
            {
              type: "text",
              text:
                (limitedResults.length > 0
                  ? limitedResults.join("\n")
                  : "No matches found") +
                (results.length > SEARCH_LIMIT
                  ? `\n\n... ${
                      results.length - SEARCH_LIMIT
                    } more results not shown.`
                  : ""),
            },
          ],
        }
      }

      case "write_note": {
        const parsed = WriteNoteArgsSchema.safeParse(args)
        if (!parsed.success) {
          throw new Error(`Invalid arguments for write_note: ${parsed.error}`)
        }

        if (!parsed.data.path.endsWith('.md')) {
          throw new Error('Note path must end with .md extension')
        }

        const fullPath = path.join(vaultDirectories[0], parsed.data.path)
        const validPath = await validatePath(fullPath)

        if (parsed.data.createDirectories) {
          await ensureDirectory(path.dirname(validPath))
        }

        await fs.writeFile(validPath, parsed.data.content, 'utf-8')
        return {
          content: [{ type: "text", text: `Successfully wrote note to ${parsed.data.path}` }],
        }
      }

      case "update_note": {
        const parsed = UpdateNoteArgsSchema.safeParse(args)
        if (!parsed.success) {
          throw new Error(`Invalid arguments for update_note: ${parsed.error}`)
        }

        if (!parsed.data.path.endsWith('.md')) {
          throw new Error('Note path must end with .md extension')
        }

        const fullPath = path.join(vaultDirectories[0], parsed.data.path)
        const validPath = await validatePath(fullPath)

        let finalContent: string
        if (parsed.data.mode !== 'replace') {
          const existingContent = await fs.readFile(validPath, 'utf-8')
          finalContent = parsed.data.mode === 'append'
            ? `${existingContent}\n${parsed.data.content}`
            : `${parsed.data.content}\n${existingContent}`
        } else {
          finalContent = parsed.data.content
        }

        await fs.writeFile(validPath, finalContent, 'utf-8')
        return {
          content: [{ type: "text", text: `Successfully updated note at ${parsed.data.path}` }],
        }
      }

      default:
        throw new Error(`Unknown tool: ${name}`)
    }
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error)
    return {
      content: [{ type: "text", text: `Error: ${errorMessage}` }],
      isError: true,
    }
  }
})

// Start server
async function runServer() {
  const transport = new StdioServerTransport()
  await server.connect(transport)
  console.error("MCP Obsidian Server running on stdio")
  console.error("Allowed directories:", vaultDirectories)
  console.error("Write operations:", config.enableWrite ? "enabled" : "disabled")
}

runServer().catch((error) => {
  console.error("Fatal error running server:", error)
  process.exit(1)
})
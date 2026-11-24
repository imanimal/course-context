# Connecting AI apps

`course-context connect` (or `setup`) writes the MCP entry for every AI app it finds. `course-context connect --list` shows found and connected apps. `course-context connect ID` targets one. Restart the app afterwards.

The entry launches `node /path/to/course-context/src/cli.js mcp` (absolute paths, so GUI apps with a short PATH still find it). When course-context runs from an npx cache, the entry is `npx -y course-context@latest mcp` (`cmd /c npx ...` on Windows).

Edits keep every other entry, back the file up once as `FILE.bak-course-context`, and never rewrite a JSON file that contains comments: then the result is `action: "manual"` with a `snippet` and `where` to paste it.

## Local apps (stdio)

| id | App | File | Key |
| --- | --- | --- | --- |
| `claude-desktop` | Claude Desktop | macOS `~/Library/Application Support/Claude/claude_desktop_config.json`, Windows `%APPDATA%\Claude\claude_desktop_config.json`, Linux `~/.config/Claude/claude_desktop_config.json` | `mcpServers` |
| `claude-code` | Claude Code | `claude mcp add --scope user` when the `claude` CLI exists, else `~/.claude.json` | `mcpServers` |
| `cursor` | Cursor | `~/.cursor/mcp.json` | `mcpServers` |
| `windsurf` | Windsurf | `~/.codeium/windsurf/mcp_config.json` | `mcpServers` |
| `antigravity` | Google Antigravity | `~/.gemini/config/mcp_config.json` (or `~/.gemini/antigravity/mcp_config.json` when that one exists) | `mcpServers` |
| `vscode` / `vscode-insiders` | VS Code with GitHub Copilot | `<user data>/Code/User/mcp.json` | `servers` (`type: "stdio"`) |
| `copilot-cli` | GitHub Copilot CLI (and VS Code's native Copilot config) | `~/.copilot/mcp-config.json` | `mcpServers` (`type: "local"`) |
| `cline` | Cline in VS Code | `<user data>/Code/User/globalStorage/saoudrizwan.claude-dev/settings/cline_mcp_settings.json` | `mcpServers` |
| `cline-cli` | Cline CLI | `~/.cline/data/settings/cline_mcp_settings.json` | `mcpServers` |
| `roo` | Roo Code | `<user data>/Code/User/globalStorage/rooveterinaryinc.roo-cline/settings/mcp_settings.json` | `mcpServers` |
| `codex` | OpenAI Codex (CLI, IDE extension, app) | `~/.codex/config.toml` | `[mcp_servers.course-context]` |
| `gemini-cli` | Gemini CLI | `~/.gemini/settings.json` | `mcpServers` |
| `qwen-code` | Qwen Code | `~/.qwen/settings.json` | `mcpServers` |
| `kiro` | Kiro | `~/.kiro/settings/mcp.json` | `mcpServers` |
| `lm-studio` | LM Studio | `~/.lmstudio/mcp.json` | `mcpServers` |
| `opencode` | opencode | `~/.config/opencode/opencode.json` | `mcp` (or `mcp.servers` in the newer format) |
| `amp` | Amp | `~/.config/amp/settings.json` | `amp.mcpServers` |
| `zed` | Zed | `~/.config/zed/settings.json` (JSONC: usually `manual`) | `context_servers` |
| `warp` | Warp | `~/.warp/.mcp.json` | `mcpServers` |
| `junie` | JetBrains Junie | `~/.junie/mcp/mcp.json` | `mcpServers` |
| `augment` | Augment (Auggie) | `~/.augment/settings.json` | `mcpServers` |
| `continue` | Continue | `~/.continue/mcpServers/course-context.yaml` (own file) | YAML block |
| `goose` | Goose | `~/.config/goose/config.yaml` | manual snippet under `extensions:` |
| `jetbrains` | JetBrains AI Assistant | Settings → Tools → AI Assistant → MCP | manual snippet |
| `trae` | Trae | Settings → MCP, or project `.trae/mcp.json` | manual snippet |

Any other MCP client: command = the `launch.command` and `launch.args` printed by `course-context connect --json`.

The entry holds absolute paths to Node and the package. After upgrading or moving Node (nvm, Homebrew) or reinstalling course-context somewhere else, run `course-context connect` again.

One-click links (they use npx): Cursor `cursor://anysphere.cursor-deeplink/mcp/install?name=course-context&config=BASE64` and VS Code `vscode:mcp/install?...`; `connect --json` prints both under `deeplinks`.

## Agent skill

`course-context skill install` copies skills/course-context/SKILL.md into `~/.claude/skills`, `~/.codex/skills`, `~/.agents/skills`, `~/.gemini/skills`, `~/.copilot/skills`, `~/.cursor/skills` (those whose parent folder exists). The skill tells coding agents how to use the CLI and the folder when MCP is not loaded.

## Web chatbots (remote MCP)

These need `course-context serve` reachable over HTTPS (docs/self-host.md). `course-context connect remote --public-url https://HOST` prints the exact steps with the URL and token filled in.

| Chatbot | How |
| --- | --- |
| claude.ai, Claude desktop and mobile | Settings → Connectors → Add custom connector → URL `https://HOST/k/TOKEN/mcp`, no OAuth. Works on every device of the account. |
| ChatGPT | Developer mode (Settings → Apps → Advanced settings) → create app → MCP URL `https://HOST/k/TOKEN/mcp`, No authentication. Without developer mode: Custom GPT → Actions → import `https://HOST/openapi.json`, API key, Bearer, TOKEN. |
| Perplexity (Pro, Max) | Settings → Connectors → custom remote connector, same URL |
| Mistral Le Chat | Connectors → Custom MCP connector, same URL (an admin may need to allow it) |
| Microsoft 365 Copilot | Copilot Studio → agent → Tools → Model Context Protocol, same URL |
| Gemini app, NotebookLM | Custom MCP apps where offered (Settings → Connected apps); otherwise keep the folder in Google Drive and use @Google Drive, a Gem or a notebook |
| Grok, DeepSeek, Meta AI, Poe | no connectors: upload now.md, README-for-AI.md and todo.md to a project or chat |

The token in the URL is the password. Rotate it with `course-context server token --rotate` and update the connectors.

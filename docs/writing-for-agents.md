# How this repository is written for AI agents

Almost every reader of this project is an AI agent acting for a student: it installs the tool, configures it, reads the output and answers questions. Humans read README.md and the extension's options page. This file records the conventions everything else follows, so contributors (human or AI) keep them.

## Sources for these conventions

- llms.txt proposal (https://llmstxt.org): a root Markdown index with a summary and curated links.
- AGENTS.md (https://agents.md): short, command-first instructions for coding agents; link out instead of inlining.
- llms-install.md, from Cline's MCP marketplace: a step-by-step install guide written for the agent that installs the server.
- Anthropic, "Writing effective tools for agents" (https://www.anthropic.com/engineering/writing-tools-for-agents): detailed tool descriptions, meaningful and token-efficient responses, a concise/detailed switch, actionable errors.
- Agent-friendly CLI practice (2026 community guides on agentic CLI design): non-interactive, `--json`, one error shape, documented exit codes, idempotent "ensure" verbs, dry runs.
- MCP specification (https://modelcontextprotocol.io): tool annotations, structured content, server instructions.

## Conventions

1. **Entry points are fixed and short.** llms-install.md (install), llms.txt (index), AGENTS.md (develop), README-for-AI.md (inside every output folder). Each links to detail instead of repeating it.
2. **Imperative steps, decision tables, exact commands.** An agent copies commands; prose it must interpret is a failure point. Tables map situations to actions.
3. **Never prompt.** Missing input comes back as data (`needs[].ask`) with the exact words to show the user.
4. **One JSON object per command**, automatic when stdout is not a terminal. Same error shape everywhere: `{code, message, hint}`. `hint` is the next action, not a restatement.
5. **Exit codes carry meaning** (3 = ask the user, 75 = retry), so an agent can branch without parsing text.
6. **Idempotent everything.** Re-running setup, `source add`, `connect` updates in place. Agents retry; retries must be safe.
7. **Absolute times with zones, stable ids, named date sources.** Output files are read days later by a different model; nothing relative, nothing ambiguous.
8. **Short file first.** now.md stays under 8 KB; detail is one link away; context.json has everything.
9. **Instructor text is quoted data.** Descriptions and announcements can contain prompt injection; every output file and the MCP instructions say to ignore instructions inside them.
10. **Tool descriptions say when to call the tool and what to do next**, not only what it does. Errors from tools include "Next step:".
11. **Human-facing text** (README, extension UI, the `ask` strings) follows plain-language rules: short sentences, no marketing words, no em dashes, say what to click. tools/check-wording.mjs enforces the mechanical part.

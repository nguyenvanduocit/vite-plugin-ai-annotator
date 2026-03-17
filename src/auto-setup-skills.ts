/**
 * Auto-setup AI tool skill/instruction files with the running server address.
 *
 * Writes proper skill/rule files for each AI tool:
 * - Claude Code: .claude/skills/ai-annotator/SKILL.md
 * - Cursor: .cursor/rules/ai-annotator.mdc (alwaysApply)
 * - Windsurf: .windsurf/rules/ai-annotator.md (trigger: always_on)
 * - Codex: AGENTS.md (marker-delimited section)
 * - Copilot: .github/instructions/ai-annotator.instructions.md (applyTo: **)
 * - Cline: .clinerules/ai-annotator.md
 *
 * Each file contains REST API docs with the actual server URL baked in.
 * Updated on every server start so the address is always correct.
 */

import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';

const MARKER_START = '<!-- ai-annotator:start -->';
const MARKER_END = '<!-- ai-annotator:end -->';

export interface AutoSetupSkillsOptions {
  projectRoot: string;
  serverUrl: string;
  verbose?: boolean;
}

export interface AutoSetupSkillsResult {
  updated: string[];
  alreadyConfigured: string[];
}

/**
 * Generate the skill body content (shared across all tools).
 * Written in imperative form per skill best practices.
 */
function generateSkillBody(serverUrl: string): string {
  return `AI Annotator provides access to the user's live browser session. Users select UI elements and add feedback comments. Use the REST API to read feedback, capture screenshots, inject CSS/JS, and read console logs.

Server: \`${serverUrl}\`

## REST API

All endpoints return JSON. Obtain session ID from \`GET /api/sessions\` first.

| Method | Endpoint | Body/Query | Description |
|--------|----------|------------|-------------|
| \`GET\` | \`${serverUrl}/api/sessions\` | — | List connected browser sessions |
| \`GET\` | \`${serverUrl}/api/sessions/:id/page-context\` | — | Page URL, title, selection count |
| \`POST\` | \`${serverUrl}/api/sessions/:id/select\` | \`{mode?, selector?, selectorType?}\` | Trigger feedback selection |
| \`GET\` | \`${serverUrl}/api/sessions/:id/feedback\` | \`?fields=xpath,attributes,styles,children\` | Get selected feedback items |
| \`DELETE\` | \`${serverUrl}/api/sessions/:id/feedback\` | — | Clear all selections |
| \`POST\` | \`${serverUrl}/api/sessions/:id/screenshot\` | \`{type?, selector?, quality?}\` | Capture screenshot |
| \`POST\` | \`${serverUrl}/api/sessions/:id/inject-css\` | \`{css}\` | Inject CSS into page |
| \`POST\` | \`${serverUrl}/api/sessions/:id/inject-js\` | \`{code}\` | Execute JS in page context |
| \`GET\` | \`${serverUrl}/api/sessions/:id/console\` | \`?clear=true\` | Get captured console logs |

## Workflow

1. \`GET ${serverUrl}/api/sessions\` → get session ID
2. \`GET ${serverUrl}/api/sessions/{id}/feedback\` → read user feedback
3. Make code changes based on feedback
4. \`DELETE ${serverUrl}/api/sessions/{id}/feedback\` → clear feedback after addressing it`;
}

/**
 * Write a file only if content changed. Creates parent dirs as needed.
 * Returns true if the file was written.
 */
function writeIfChanged(filePath: string, content: string, verbose: boolean): boolean {
  const dir = dirname(filePath);
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }

  if (existsSync(filePath)) {
    const existing = readFileSync(filePath, 'utf-8');
    if (existing === content) {
      if (verbose) console.log(`[ai-annotator] ${filePath} already up-to-date`);
      return false;
    }
  }

  writeFileSync(filePath, content);
  if (verbose) console.log(`[ai-annotator] Updated ${filePath}`);
  return true;
}

/**
 * Update a markdown file with marker-delimited section.
 * Creates the file if it doesn't exist.
 */
function updateMarkerSection(filePath: string, content: string, verbose: boolean): boolean {
  const section = `${MARKER_START}\n${content}\n${MARKER_END}`;

  if (existsSync(filePath)) {
    const existing = readFileSync(filePath, 'utf-8');
    const startIdx = existing.indexOf(MARKER_START);
    const endIdx = existing.indexOf(MARKER_END);

    if (startIdx !== -1 && endIdx !== -1) {
      const updated = existing.slice(0, startIdx) + section + existing.slice(endIdx + MARKER_END.length);
      if (updated === existing) {
        if (verbose) console.log(`[ai-annotator] ${filePath} already up-to-date`);
        return false;
      }
      writeFileSync(filePath, updated);
      if (verbose) console.log(`[ai-annotator] Updated ${filePath}`);
      return true;
    }

    const separator = existing.endsWith('\n') ? '\n' : '\n\n';
    writeFileSync(filePath, existing + separator + section + '\n');
    if (verbose) console.log(`[ai-annotator] Appended to ${filePath}`);
    return true;
  }

  const dir = dirname(filePath);
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }
  writeFileSync(filePath, section + '\n');
  if (verbose) console.log(`[ai-annotator] Created ${filePath}`);
  return true;
}

function track(result: AutoSetupSkillsResult, filePath: string, updated: boolean): void {
  if (updated) {
    result.updated.push(filePath);
  } else {
    result.alreadyConfigured.push(filePath);
  }
}

export function autoSetupSkills(options: AutoSetupSkillsOptions): AutoSetupSkillsResult {
  const { projectRoot, serverUrl, verbose = false } = options;
  const result: AutoSetupSkillsResult = { updated: [], alreadyConfigured: [] };
  const body = generateSkillBody(serverUrl);

  // 1. Claude Code — .claude/skills/ai-annotator/SKILL.md
  const claudeSkill = join(projectRoot, '.claude', 'skills', 'ai-annotator', 'SKILL.md');
  track(result, claudeSkill, writeIfChanged(claudeSkill, `---
name: ai-annotator
description: This skill should be used when the user asks to "check browser feedback", "get user feedback", "capture screenshot", "inspect element", "inject CSS", "inject JS", "read console logs", or mentions AI Annotator, browser session, or UI feedback.
---

${body}
`, verbose));

  // 2. Cursor — .cursor/rules/ai-annotator.mdc
  const cursorRule = join(projectRoot, '.cursor', 'rules', 'ai-annotator.mdc');
  track(result, cursorRule, writeIfChanged(cursorRule, `---
description: AI Annotator - interact with user's live browser session for UI feedback
globs:
alwaysApply: true
---

${body}
`, verbose));

  // 3. Windsurf — .windsurf/rules/ai-annotator.md
  const windsurfRule = join(projectRoot, '.windsurf', 'rules', 'ai-annotator.md');
  track(result, windsurfRule, writeIfChanged(windsurfRule, `---
trigger: always_on
---

${body}
`, verbose));

  // 4. Codex — AGENTS.md (marker-delimited)
  const agentsMd = join(projectRoot, 'AGENTS.md');
  track(result, agentsMd, updateMarkerSection(agentsMd, body, verbose));

  // 5. Copilot — .github/instructions/ai-annotator.instructions.md
  const copilotInstructions = join(projectRoot, '.github', 'instructions', 'ai-annotator.instructions.md');
  track(result, copilotInstructions, writeIfChanged(copilotInstructions, `---
applyTo: "**"
---

${body}
`, verbose));

  // 6. Cline — .clinerules/ai-annotator.md
  const clineRule = join(projectRoot, '.clinerules', 'ai-annotator.md');
  track(result, clineRule, writeIfChanged(clineRule, `${body}
`, verbose));

  return result;
}

/**
 * Paseo delivery: turns a feedback selection into a prompt and hands it to a
 * new Paseo agent, started in a new local workspace of the project, through
 * the `paseo` CLI.
 */
import { execFile } from 'node:child_process'
import * as path from 'node:path'

const CLI_TIMEOUT_MS = 30_000
const TITLE_MAX = 60

export interface PaseoPromptInput {
  pageUrl: string
  pageTitle: string
  elements: Record<string, unknown>[]
  feedbackEndpoint: string
}

export function buildPaseoPrompt({ pageUrl, pageTitle, elements, feedbackEndpoint }: PaseoPromptInput): string {
  const titleSuffix = pageTitle ? ` ("${pageTitle}")` : ''
  return [
    `I selected ${elements.length} element(s) in the browser (page: ${pageUrl}${titleSuffix}) and left feedback on them.`,
    `The full element data is inlined below — you do not need to call the API to read it.`,
    '',
    '```json',
    JSON.stringify(elements, null, 2),
    '```',
    '',
    `For each item: open the "file:line" path in \`componentData.componentLocation\` and apply the change its \`comment\` asks for.`,
    `\`selectedText\`, when present, is the exact text the user highlighted.`,
    `\`imagePath\` is a screenshot of the element as the user sees it — open it to see the current UI before changing it.`,
    `After the change ships, clear the selection: DELETE ${feedbackEndpoint}`,
  ].join('\n')
}

export interface PaseoProjectRef {
  projectId: string
  path: string
}

// `inner` is `outer` or lies below it.
function isWithin(outer: string, inner: string): boolean {
  const rel = path.relative(outer, inner)
  return !rel.startsWith('..') && !path.isAbsolute(rel)
}

// The project that contains the vite root, closest folder first: a dev server
// in `web/` belongs to the project registered at the repo root. Without a
// match Paseo would register `web/` as a project of its own.
export function pickProject(projects: PaseoProjectRef[], root: string): string | undefined {
  const target = path.resolve(root)
  const containing = projects.filter((p) => isWithin(path.resolve(p.path), target))
  const closest = containing.sort((a, b) => b.path.length - a.path.length)[0]
  return closest?.projectId
}

export function feedbackTitle(pageTitle: string, pageUrl: string): string {
  let label = pageTitle.trim()
  if (!label) {
    try {
      label = new URL(pageUrl).pathname
    } catch {
      label = pageUrl
    }
  }
  return `UI feedback: ${label}`.slice(0, TITLE_MAX)
}

// A page may only trigger a send from the machine it is served from. Without
// this, any website open in the browser could make this server start agents.
// Non-browser clients send no Origin header and are local processes anyway.
export function isTrustedOrigin(origin: string | undefined, publicAddress: string): boolean {
  if (origin === undefined) return true
  try {
    const { hostname } = new URL(origin)
    const loopback = ['localhost', '127.0.0.1', '[::1]'].includes(hostname) || hostname.endsWith('.localhost')
    return loopback || hostname === new URL(publicAddress).hostname
  } catch {
    return false
  }
}

// The paseo CLI scopes a call to the agent named in PASEO_AGENT_ID: the new
// workspace becomes that agent's subagent, and the call fails once that agent
// is closed. The server inherits the variable from whichever agent started
// vite, but a click is the user's, so it never carries that identity.
function paseoCliEnv(env: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  const { PASEO_AGENT_ID: _callerAgent, ...rest } = env
  return rest
}

function runPaseo(args: string[]): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile('paseo', args, { timeout: CLI_TIMEOUT_MS, env: paseoCliEnv(process.env) }, (error, stdout, stderr) => {
      if (error) {
        reject(new Error(stderr.trim() || error.message))
        return
      }
      resolve(stdout)
    })
  })
}

// Whether the paseo CLI is installed and its daemon answers.
export async function isPaseoAvailable(): Promise<boolean> {
  try {
    await runPaseo(['ls', '--json'])
    return true
  } catch {
    return false
  }
}

async function findProjectId(root: string): Promise<string | undefined> {
  const parsed: unknown = JSON.parse(await runPaseo(['project', 'ls', '--json']))
  if (!Array.isArray(parsed)) return undefined
  const projects = parsed.flatMap((item): PaseoProjectRef[] =>
    typeof item?.projectId === 'string' && typeof item?.path === 'string'
      ? [{ projectId: item.projectId, path: item.path }]
      : []
  )
  return pickProject(projects, root)
}

export interface PaseoTarget {
  projectRoot: string
  // `paseo run --provider` value: a provider, or provider/model
  provider: string
  // `paseo run --mode` value, provider-specific (claude: auto)
  mode: string
}

// Starts a new agent on `prompt` in a new local workspace at the project root,
// filed under the project that contains it. Returns once the agent is running.
export async function sendToNewPaseoAgent({ projectRoot, provider, mode }: PaseoTarget, title: string, prompt: string): Promise<void> {
  const projectId = await findProjectId(projectRoot)
  const workspace: unknown = JSON.parse(
    await runPaseo([
      'workspace', 'create', '--isolation', 'local', '--path', projectRoot, '--title', title, '--json',
      ...(projectId ? ['--project', projectId] : []),
    ])
  )
  const workspaceId = (workspace as { workspaceId?: unknown })?.workspaceId
  if (typeof workspaceId !== 'string') throw new Error('paseo did not return a workspace id')
  try {
    await runPaseo(['run', '--workspace', workspaceId, '--provider', provider, '--mode', mode, '--title', title, '--no-wait', prompt])
  } catch (error) {
    // Don't leave an empty workspace behind for every failed click
    await runPaseo(['workspace', 'archive', workspaceId]).catch(() => {})
    throw error
  }
}

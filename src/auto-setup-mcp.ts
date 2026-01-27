import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';

const MCP_SERVER_NAME = 'ai-annotator';

interface McpServerConfig {
  command: string;
  args: string[];
}

interface McpConfig {
  mcpServers: Record<string, McpServerConfig>;
}

type PackageManager = 'bunx' | 'pnpm dlx' | 'npx';

function detectPackageManager(projectRoot: string): PackageManager {
  if (existsSync(join(projectRoot, 'bun.lockb')) || existsSync(join(projectRoot, 'bun.lock'))) {
    return 'bunx';
  }
  if (existsSync(join(projectRoot, 'pnpm-lock.yaml'))) {
    return 'pnpm dlx';
  }
  return 'npx';
}

function buildMcpServerConfig(packageManager: PackageManager, serverUrl: string): McpServerConfig {
  const baseArgs = ['vite-plugin-ai-annotator', 'mcp', '-s', serverUrl];

  if (packageManager === 'pnpm dlx') {
    return {
      command: 'pnpm',
      args: ['dlx', ...baseArgs],
    };
  }

  return {
    command: packageManager,
    args: baseArgs,
  };
}

function readJsonFile(filePath: string): McpConfig | null {
  try {
    const content = readFileSync(filePath, 'utf-8');
    return JSON.parse(content);
  } catch {
    return null;
  }
}

function writeJsonFile(filePath: string, data: McpConfig): void {
  const dir = dirname(filePath);
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }
  writeFileSync(filePath, JSON.stringify(data, null, 2) + '\n');
}

function setupConfigFile(
  filePath: string,
  serverConfig: McpServerConfig,
  verbose: boolean
): boolean {
  const existingConfig = readJsonFile(filePath);

  if (existingConfig) {
    // Check if already configured with same settings
    const existing = existingConfig.mcpServers?.[MCP_SERVER_NAME];
    if (existing &&
        existing.command === serverConfig.command &&
        JSON.stringify(existing.args) === JSON.stringify(serverConfig.args)) {
      if (verbose) {
        console.log(`[ai-annotator] ${filePath} already configured`);
      }
      return false;
    }

    // Merge with existing config
    existingConfig.mcpServers = existingConfig.mcpServers || {};
    existingConfig.mcpServers[MCP_SERVER_NAME] = serverConfig;
    writeJsonFile(filePath, existingConfig);
    if (verbose) {
      console.log(`[ai-annotator] Updated ${filePath}`);
    }
    return true;
  }

  // Create new config file
  const newConfig: McpConfig = {
    mcpServers: {
      [MCP_SERVER_NAME]: serverConfig,
    },
  };
  writeJsonFile(filePath, newConfig);
  if (verbose) {
    console.log(`[ai-annotator] Created ${filePath}`);
  }
  return true;
}

export interface AutoSetupMcpOptions {
  projectRoot: string;
  serverUrl: string;
  verbose?: boolean;
}

export function autoSetupMcp(options: AutoSetupMcpOptions): void {
  const { projectRoot, serverUrl, verbose = false } = options;

  const packageManager = detectPackageManager(projectRoot);
  const serverConfig = buildMcpServerConfig(packageManager, serverUrl);

  if (verbose) {
    console.log(`[ai-annotator] Detected package manager: ${packageManager}`);
  }

  // Config files to check (only project-local ones)
  const configFiles = [
    join(projectRoot, '.mcp.json'),
    join(projectRoot, '.cursor', 'mcp.json'),
    join(projectRoot, '.vscode', 'mcp.json'),
  ];

  let setupCount = 0;

  for (const configFile of configFiles) {
    // For .cursor and .vscode, only setup if the parent directory exists
    // This indicates the user is using that editor
    const parentDir = dirname(configFile);
    const isNestedConfig = parentDir !== projectRoot;

    if (isNestedConfig && !existsSync(parentDir)) {
      continue;
    }

    // Setup the config file
    if (setupConfigFile(configFile, serverConfig, verbose)) {
      setupCount++;
    }
  }

  // Always create .mcp.json if nothing was set up (Claude Code standard)
  if (setupCount === 0) {
    const defaultConfig = join(projectRoot, '.mcp.json');
    if (!existsSync(defaultConfig)) {
      setupConfigFile(defaultConfig, serverConfig, verbose);
    }
  }
}

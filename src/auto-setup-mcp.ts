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

/**
 * Detect existing MCP config files in the project
 */
function detectExistingConfigs(projectRoot: string): string[] {
  const potentialConfigs = [
    join(projectRoot, '.mcp.json'),
    join(projectRoot, '.cursor', 'mcp.json'),
    join(projectRoot, '.vscode', 'mcp.json'),
  ];

  return potentialConfigs.filter(existsSync);
}

export interface AutoSetupResult {
  updated: string[];
  alreadyConfigured: string[];
}

export function autoSetupMcp(options: AutoSetupMcpOptions): AutoSetupResult {
  const { projectRoot, serverUrl, verbose = false } = options;
  const result: AutoSetupResult = {
    updated: [],
    alreadyConfigured: [],
  };

  const packageManager = detectPackageManager(projectRoot);
  const serverConfig = buildMcpServerConfig(packageManager, serverUrl);

  if (verbose) {
    console.log(`[ai-annotator] Detected package manager: ${packageManager}`);
  }

  // Detect existing MCP config files
  const existingConfigs = detectExistingConfigs(projectRoot);

  if (existingConfigs.length === 0) {
    // Create default .mcp.json when no configs found
    const defaultConfigPath = join(projectRoot, '.mcp.json');
    const wasUpdated = setupConfigFile(defaultConfigPath, serverConfig, verbose);
    if (wasUpdated) {
      result.updated.push(defaultConfigPath);
    }
    return result;
  }

  // Update all detected config files
  if (verbose) {
    console.log(`[ai-annotator] Found ${existingConfigs.length} MCP config file(s)`);
  }

  for (const configFile of existingConfigs) {
    const wasUpdated = setupConfigFile(configFile, serverConfig, verbose);
    if (wasUpdated) {
      result.updated.push(configFile);
    } else {
      result.alreadyConfigured.push(configFile);
    }
  }

  return result;
}

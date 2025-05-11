import path from 'path';
import fs from 'node:fs';
import { app } from 'electron';
import { IMCPConfig, IMCPServer } from 'types/mcp';
import { isUndefined, keyBy, omitBy } from 'lodash';
import * as logging from './logging';

const CONNECT_TIMEOUT = 60 * 1000 * 5; // 5 minutes

export const DEFAULT_INHERITED_ENV_VARS =
  process.platform === 'win32'
    ? [
        'APPDATA',
        'HOMEDRIVE',
        'HOMEPATH',
        'LOCALAPPDATA',
        'PATH',
        'PROCESSOR_ARCHITECTURE',
        'SYSTEMDRIVE',
        'SYSTEMROOT',
        'TEMP',
        'USERNAME',
        'USERPROFILE',
      ]
    : /* list inspired by the default env inheritance of sudo */
      ['HOME', 'LOGNAME', 'PATH', 'SHELL', 'TERM', 'USER'];
/**
 * Returns a default environment object including only environment variables deemed safe to inherit.
 */
export function getDefaultEnvironment() {
  const env: Record<string, string> = {};
  DEFAULT_INHERITED_ENV_VARS.forEach((key) => {
    const value = process.env[key];
    if (value === undefined) {
      return;
    }
    if (value.startsWith('()')) {
      // Skip functions, which are a security risk.
      return;
    }
    env[key] = value;
  });
  return env;
}

export default class ModuleContext {
  private clients: { [key: string]: any } = {};

  private Client: any;

  private StdioTransport: any;

  private SSETransport: any;

  private StreamableHTTPTransport: any;

  private cfgPath: string;

  constructor() {
    this.cfgPath = path.join(app.getPath('userData'), 'mcp.json');
  }

  public async init() {
    this.Client = await ModuleContext.importClient();
    this.StdioTransport = await ModuleContext.importStdioTransport();
    this.SSETransport = await ModuleContext.importSSETransport();
    this.StreamableHTTPTransport =
      await ModuleContext.importStreamableHTTPTransport();
  }

  private static async importClient() {
    const { Client } = await import(
      '@modelcontextprotocol/sdk/client/index.js'
    );
    return Client;
  }

  private static async importStdioTransport() {
    const { StdioClientTransport } = await import(
      '@modelcontextprotocol/sdk/client/stdio.js'
    );
    return StdioClientTransport;
  }

  private static async importSSETransport() {
    const { SSEClientTransport } = await import(
      '@modelcontextprotocol/sdk/client/sse.js'
    );
    return SSEClientTransport;
  }

  private static async importStreamableHTTPTransport() {
    const { StreamableHTTPClientTransport } = await import(
      '@modelcontextprotocol/sdk/client/streamableHttp.js'
    );
    return StreamableHTTPClientTransport;
  }

  private static getMCPServer(server: IMCPServer, config: IMCPConfig) {
    let mcpSvr = config.mcpServers[server.key];
    mcpSvr = {
      ...mcpSvr,
      ...omitBy({ ...server, isActive: true }, isUndefined),
    } as IMCPServer;
    logging.debug('MCP Server:', mcpSvr);
    return mcpSvr;
  }

  private async updateConfigAfterActivation(
    server: IMCPServer,
    config: IMCPConfig,
  ) {
    config.mcpServers[server.key] = server;
    await this.putConfig(config);
  }

  private async updateConfigAfterDeactivation(key: string, config: IMCPConfig) {
    config.mcpServers[key] = { ...config.mcpServers[key], isActive: false };
    await this.putConfig(config);
  }

  public async getConfig(): Promise<IMCPConfig> {
    const defaultConfig = { mcpServers: {} };
    try {
      if (!fs.existsSync(this.cfgPath)) {
        fs.writeFileSync(this.cfgPath, JSON.stringify(defaultConfig, null, 2));
      }
      const config = JSON.parse(fs.readFileSync(this.cfgPath, 'utf-8'));
      // migration to new config format
      if (config.servers) {
        if (Array.isArray(config.servers) && !config.mcpServers) {
          config.mcpServers = keyBy(config.servers, 'key');
        }
        delete config.servers;
        await this.putConfig(config);
      }
      if (!config.mcpServers) {
        config.mcpServers = {};
      }
      // Set key for each server if not already set
      (Object.entries(config.mcpServers) as [string, IMCPServer][]).forEach(
        ([key, server]) => {
          server.key = key;
        },
      );
      return config;
    } catch (err: any) {
      logging.captureException(err);
      return defaultConfig;
    }
  }

  public async putConfig(config: any) {
    try {
      Object.keys(config.mcpServers).forEach((key) => {
        delete config.mcpServers[key].key;
        delete config.mcpServers[key].homepage;
      });
      fs.writeFileSync(this.cfgPath, JSON.stringify(config, null, 2));
      return true;
    } catch (err: any) {
      logging.captureException(err);
      return false;
    }
  }

  public async load() {
    const { mcpServers } = await this.getConfig();
    await Promise.all(
      Object.keys(mcpServers).map(async (key: string) => {
        const server = mcpServers[key];
        if (server.isActive) {
          logging.debug('Activating server:', key);
          const { error } = await this.activate(server);
          if (error) {
            logging.error('Failed to activate server:', key, error);
          }
        }
      }),
    );
  }

  public async addServer(server: IMCPServer) {
    const config = await this.getConfig();
    if (!config.mcpServers[server.key]) {
      config.mcpServers[server.key] = server;
      await this.putConfig(config);
      return true;
    }
    return false;
  }

  public async updateServer(server: IMCPServer) {
    const config = await this.getConfig();
    if (config.mcpServers[server.key]) {
      config.mcpServers[server.key] = server;
      await this.putConfig(config);
      return true;
    }
    return false;
  }

  public async activate(server: IMCPServer): Promise<{ error: any }> {
    try {
      const client = new this.Client({
        name: server.key,
        version: '1.0.0',
      });
      const config = await this.getConfig();
      const mcpSvr = ModuleContext.getMCPServer(server, config) as IMCPServer;
      if (mcpSvr.url) {
        const options = {} as {
          requestInit: { headers: Record<string, string> };
        };
        if (mcpSvr.headers) {
          options.requestInit = { headers: mcpSvr.headers };
        }
        const isSSE = mcpSvr.url.endsWith('sse');
        const PrimaryTransport = isSSE
          ? this.SSETransport
          : this.StreamableHTTPTransport;
        const SecondaryTransport = isSSE
          ? this.StreamableHTTPTransport
          : this.SSETransport;
        try {
          const transport = new PrimaryTransport(new URL(mcpSvr.url));
          await client.connect(transport, { timeout: CONNECT_TIMEOUT });
        } catch (error) {
          logging.captureException(error as Error);
          console.log(
            'Streamable HTTP connection failed, falling back to SSE transport',
          );
          const transport = new SecondaryTransport(new URL(mcpSvr.url));
          await client.connect(transport, { timeout: CONNECT_TIMEOUT });
        }
      } else {
        const { command, args, env } = mcpSvr;
        let cmd: string = command as string;
        if (command === 'npx') {
          cmd = process.platform === 'win32' ? `${command}.cmd` : command;
        }
        const mergedEnv = {
          ...getDefaultEnvironment(),
          ...env,
          PATH: process.env.PATH,
        };
        const transport = new this.StdioTransport({
          command: cmd,
          args,
          stderr: process.platform === 'win32' ? 'pipe' : 'inherit',
          env: mergedEnv,
        });
        await client.connect(transport, { timeout: CONNECT_TIMEOUT });
      }
      this.clients[server.key] = client;
      await this.updateConfigAfterActivation(mcpSvr, config);
      return { error: null };
    } catch (error: any) {
      logging.captureException(error);
      this.deactivate(server.key);
      return { error };
    }
  }

  public async deactivate(key: string) {
    try {
      if (this.clients[key]) {
        await this.clients[key].close();
        delete this.clients[key];
        logging.debug('Deactivating server:', key);
      }
      await this.updateConfigAfterDeactivation(key, await this.getConfig());
      return { error: null };
    } catch (error: any) {
      logging.captureException(error);
      return { error };
    }
  }

  public async close() {
    await Promise.all(
      Object.keys(this.clients).map(async (key) => {
        logging.info(`Closing MCP Client ${key}`);
        await this.clients[key].close();
        delete this.clients[key];
      }),
    );
  }

  public async listTools(key?: string) {
    let allTools: any = [];
    if (key) {
      if (!this.clients[key]) {
        throw new Error(`MCP Client ${key} not found`);
      }
      const { tools } = await this.clients[key].listTools();
      allTools = tools.map((tool: any) => {
        tool.name = `${key}--${tool.name}`;
        return tool;
      });
    } else {
      await Promise.all(
        Object.keys(this.clients).map(async (clientName: string) => {
          const { tools } = await this.clients[clientName].listTools();
          allTools = allTools.concat(
            tools.map((tool: any) => {
              tool.name = `${clientName}--${tool.name}`;
              return tool;
            }),
          );
        }),
      );
    }
    // logging.debug('All Tools:', JSON.stringify(allTools, null, 2));
    return allTools;
  }

  public async callTool({
    client,
    name,
    args,
  }: {
    client: string;
    name: string;
    args: any;
  }) {
    if (!this.clients[client]) {
      throw new Error(`MCP Client ${client} not found`);
    }
    logging.debug('Calling:', client, name, args);
    const result = await this.clients[client].callTool(
      {
        name,
        arguments: args,
      },
      undefined,
      { timeout: 60 * 1000 * 5 },
    );
    return result;
  }

  public getClient(name: string) {
    return this.clients[name];
  }

  public getClientNames() {
    return Object.keys(this.clients);
  }
}

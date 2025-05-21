import path from 'path';
import fs from 'node:fs';
import { app } from 'electron';
import { IMCPConfig, IMCPServer } from 'types/mcp';
import { isUndefined, keyBy, omitBy } from 'lodash';
import { purifyServer } from 'utils/mcp';
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

  private updateConfigAfterActivation(server: IMCPServer, config: IMCPConfig) {
    config.mcpServers[server.key] = server;
    this.putConfig(config);
  }

  private updateConfigAfterDeactivation(key: string, config: IMCPConfig) {
    config.mcpServers[key] = { ...config.mcpServers[key], isActive: false };
    this.putConfig(config);
  }

  public isServerExist(key: string): boolean {
    const defaultConfig = { mcpServers: {} };
    try {
      if (!fs.existsSync(this.cfgPath)) {
        fs.writeFileSync(this.cfgPath, JSON.stringify(defaultConfig, null, 2));
      }
      const config = JSON.parse(fs.readFileSync(this.cfgPath, 'utf-8'));
      return !!config.mcpServers[key];
    } catch (err: any) {
      logging.captureException(err);
      return false;
    }
  }

  public getConfig(): IMCPConfig {
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
        this.putConfig(config);
      }
      if (!config.mcpServers) {
        config.mcpServers = {};
      }
      // Set key for each server if not already set
      (Object.entries(config.mcpServers) as [string, IMCPServer][]).forEach(
        ([key, server]) => {
          server.key = key;
          if (server.url) {
            server.type = 'remote';
          } else {
            server.type = 'local';
          }
        },
      );
      return config;
    } catch (err: any) {
      logging.captureException(err);
      return defaultConfig;
    }
  }

  public putConfig(config: any) {
    try {
      const newConfig = { ...config };
      Object.keys(newConfig.mcpServers).forEach((key: string) => {
        const svr = newConfig.mcpServers[key];
        newConfig.mcpServers[key] = purifyServer(svr);
      });
      fs.writeFileSync(this.cfgPath, JSON.stringify(newConfig, null, 2));
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

  public addServer(server: IMCPServer) {
    const config = this.getConfig();
    if (!config.mcpServers[server.key]) {
      config.mcpServers[server.key] = server;
      this.putConfig(config);
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
      const config = this.getConfig();
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
          const transport = new PrimaryTransport(new URL(mcpSvr.url), options);
          await client.connect(transport, { timeout: CONNECT_TIMEOUT });
        } catch (error) {
          logging.captureException(error as Error);
          console.log(
            'Streamable HTTP connection failed, falling back to SSE transport',
          );
          const transport = new SecondaryTransport(
            new URL(mcpSvr.url),
            options,
          );
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
      this.updateConfigAfterActivation(mcpSvr, config);
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
      this.updateConfigAfterDeactivation(key, this.getConfig());
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

  /**
   * Checks if a client is connected and attempts to reconnect if it's not.
   * @param clientKey The key of the client to check
   * @returns An object indicating success or containing an error
   */
  private async checkAndReconnect(
    clientKey: string,
  ): Promise<{ success: boolean; error?: any }> {
    if (!this.clients[clientKey]) {
      logging.error(`MCP Client ${clientKey} not found`);
      return {
        success: false,
        error: {
          message: `MCP Client ${clientKey} not found`,
          code: 'client_not_found',
        },
      };
    }

    try {
      // Check if client is connected by making a simple ping request
      // If client is disconnected, this will throw an error
      await this.clients[clientKey].ping();
      logging.info(`Client ${clientKey} is connected and responsive.`);
      return { success: true };
    } catch (pingError: any) {
      logging.info(
        `Client ${clientKey} appears disconnected. Attempting to reconnect...`,
      );

      try {
        // Get server config to reconnect
        const config = this.getConfig();
        const server = config.mcpServers[clientKey];

        if (!server) {
          logging.error(`Server configuration for ${clientKey} not found`);
          return {
            success: false,
            error: {
              message: `Server configuration for ${clientKey} not found`,
              code: 'server_config_not_found',
            },
          };
        }

        // Close existing client instance if it exists
        if (this.clients[clientKey]) {
          try {
            await this.clients[clientKey].close();
          } catch (closeErr: any) {
            logging.error(
              `Error closing client ${clientKey}: ${closeErr.message}`,
            );
            // Continue with reconnection attempt even if close fails
          }
        }

        // Attempt to reactivate the server
        const activationResult = await this.activate(server);
        if (activationResult.error) {
          logging.error(
            `Failed to reconnect client ${clientKey}: ${activationResult.error.message}`,
          );
          return {
            success: false,
            error: {
              message: `Failed to reconnect client ${clientKey}: ${activationResult.error.message}`,
              code: 'reconnect_failed',
            },
          };
        }

        logging.info(`Successfully reconnected client ${clientKey}`);
        return { success: true };
      } catch (reconnectError: any) {
        logging.captureException(reconnectError);
        return {
          success: false,
          error: {
            message: `Error reconnecting client ${clientKey}: ${reconnectError.message}`,
            code: 'reconnect_error',
          },
        };
      }
    }
  }

  public async listTools(key?: string) {
    let allTools: any = [];
    if (key) {
      if (!this.clients[key]) {
        logging.error(`MCP Client ${key} not found`);
        return {
          tools: [],
          error: {
            message: `MCP Client ${key} not found`,
            code: 'client_not_found',
          },
        };
      }

      try {
        // First check if client is connected and try to reconnect if needed
        const connectionStatus = await this.checkAndReconnect(key);
        if (!connectionStatus.success) {
          return {
            tools: [],
            error: connectionStatus.error,
          };
        }

        const response = await this.clients[key].listTools();
        // Check if response has tools property and it's an array
        if (!response || !response.tools || !Array.isArray(response.tools)) {
          return {
            tools: [],
            error: {
              message: `Invalid response from client ${key}: missing or invalid tools array`,
              code: 'invalid_response',
            },
          };
        }

        allTools = response.tools.map((tool: any) => {
          tool.name = `${key}--${tool.name}`;
          return tool;
        });
        return { tools: allTools, error: null };
      } catch (error: any) {
        logging.captureException(error);
        return {
          tools: [],
          error: {
            message: `Error listing tools for client ${key}: ${error.message}`,
            code: 'list_tools_error',
          },
        };
      }
    } else {
      const failedClients: any[] = [];

      // Get tools from all clients, but don't fail if one client fails
      const clientPromises = Object.keys(this.clients).map(
        async (clientName: string) => {
          logging.info(clientName);
          try {
            // Try to reconnect if client is disconnected
            const connectionStatus = await this.checkAndReconnect(clientName);
            if (!connectionStatus.success) {
              failedClients.push({
                client: clientName,
                error: connectionStatus.error.message,
              });
              return [];
            }

            const response = await this.clients[clientName].listTools();
            // Check if response has tools property and it's an array
            if (
              !response ||
              !response.tools ||
              !Array.isArray(response.tools)
            ) {
              failedClients.push({
                client: clientName,
                error: 'Invalid response: missing or invalid tools array',
              });
              return [];
            }

            return response.tools.map((tool: any) => {
              tool.name = `${clientName}--${tool.name}`;
              return tool;
            });
          } catch (error: any) {
            logging.captureException(error);
            failedClients.push({
              client: clientName,
              error: error.message,
            });
            return [];
          }
        },
      );

      const results = await Promise.all(clientPromises);
      results.forEach((tools) => {
        allTools = allTools.concat(tools);
      });

      return {
        tools: allTools,
        error:
          failedClients.length > 0
            ? {
                message: `Failed to list tools from some clients`,
                failedClients,
                code: 'partial_failure',
              }
            : null,
      };
    }
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
      logging.error(`MCP Client ${client} not found`);
      return {
        isError: true,
        content: [
          {
            error: `MCP Client ${client} not found`,
            code: 'client_not_found',
          },
        ],
      };
    }

    // First check if client is connected and try to reconnect if needed
    const connectionStatus = await this.checkAndReconnect(client);
    if (!connectionStatus.success) {
      return {
        isError: true,
        content: [
          {
            error: connectionStatus.error.message,
            code: connectionStatus.error.code,
            toolName: name,
            clientName: client,
          },
        ],
      };
    }

    const mcpClient = this.clients[client];
    logging.debug('Calling:', client, name, args);

    try {
      const result = await mcpClient.callTool(
        {
          name,
          arguments: args,
        },
        undefined,
        { timeout: CONNECT_TIMEOUT },
      );
      return {
        isError: false,
        ...result,
      };
    } catch (error: any) {
      logging.captureException(error);
      return {
        isError: true,
        content: [
          {
            error: `Error calling tool ${name}: ${error.message}`,
            code: 'tool_call_error',
            toolName: name,
            clientName: client,
          },
        ],
      };
    }
  }

  public getClient(name: string) {
    return this.clients[name];
  }

  public getClientNames() {
    return Object.keys(this.clients);
  }
}

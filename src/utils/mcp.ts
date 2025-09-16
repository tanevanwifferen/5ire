/**
 * ['--db-path',<dbPath>] => dbPath
 */

import { flatten } from 'lodash';
import {
  MCPArgParameter,
  MCPArgType,
  MCPEnvType,
  IMCPServerParameter,
  IMCPServer,
} from 'types/mcp';

/**
 * Extracts parameter definitions from an array of parameter strings using a specific pattern.
 * Parses strings with the format {{name@type::description}} to create parameter objects.
 * 
 * @param params - Array of parameter strings to parse
 * @returns Array of parsed parameter objects with name, type, and description
 */
export function getParameters(params: string[]): IMCPServerParameter[] {
  const result: IMCPServerParameter[] = [];
  if (!params) {
    return result;
  }
  const pattern =
    /\{\{(?<name>[^@]+)@(?<type>[^:]+)(::(?<description>[^}]*))?\}\}/;
  params.forEach((param: string) => {
    const match = param.match(pattern);
    if (match && match.groups) {
      result.push({
        name: match.groups.name,
        type: match.groups.type as MCPEnvType | MCPArgType,
        description: match.groups.description || '',
      });
    }
  });
  return result;
}

/**
 * Replaces parameter placeholders in argument strings with actual values.
 * Handles both single values and arrays, flattening the result.
 * 
 * @param args - Array of argument strings that may contain placeholders
 * @param params - Object mapping parameter names to their values
 * @returns Flattened array of arguments with placeholders replaced
 */
export function fillArgs(args: string[], params: MCPArgParameter): string[] {
  const pattern =
    /\{\{(?<name>[^@]+)@(?<type>[^:]+)(::(?<description>[^}]*))?\}\}/;
  const $args: (string | string[])[] = [...args];
  for (let index = 0; index < args.length; index++) {
    const arg = args[index];
    const match = arg.match(pattern);
    if (match && match.groups) {
      const paramValue = params[match.groups.name];
      if (Array.isArray(paramValue)) {
        $args[index] = paramValue;
      } else {
        $args[index] = arg.replace(match[0], paramValue);
      }
    }
  }
  return flatten($args);
}

/**
 * Replaces parameter placeholders in environment variables or headers with actual values.
 * Processes all placeholders in each value string using global regex matching.
 * 
 * @param envOrHeaders - Object containing environment variables or headers with potential placeholders
 * @param params - Object mapping parameter names to their replacement values
 * @returns New object with all placeholders replaced by actual values
 */
export function FillEnvOrHeaders(
  envOrHeaders: Record<string, string> | undefined,
  params: { [key: string]: string },
): Record<string, string> {
  if (!envOrHeaders) return {};
  const pattern =
    /\{\{(?<name>[^@]+)@(?<type>[^:]+)(::(?<description>[^}]*))?\}\}/g;
  const $envOrHeaders = { ...envOrHeaders };
  const keys = Object.keys(envOrHeaders);
  for (const key of keys) {
    const item = envOrHeaders[key];
    let result = item;
    let match;
    while ((match = pattern.exec(item)) !== null) {
      if (match.groups) {
        const placeholder = match[0];
        const paramValue = params[match.groups.name];
        if (paramValue !== undefined) {
          result = result.replace(placeholder, paramValue);
        }
      }
    }

    $envOrHeaders[key] = result;
  }
  return $envOrHeaders;
}

/**
 * Creates a clean server object by removing internal fields and conditionally including optional properties.
 * Excludes 'type' and 'key' fields while preserving all other server configuration.
 * 
 * @param server - The MCP server object to purify
 * @returns Server object without internal fields, with optional properties included only if they have values
 */
export function purifyServer(server: IMCPServer): Omit<IMCPServer, 'type' | 'key' > {
  return {
    name: server.name,
    description: server.description,
    url: server.url,
    command: server.command,
    ...(server.args?.length ? { args: server.args } : {}),
    ...(Object.keys(server.headers || {}).length
      ? { headers: server.headers }
      : {}),
    ...(Object.keys(server.env || {}).length ? { env: server.env } : {}),
    isActive: server.isActive || false,
    approvalPolicy: server.approvalPolicy,
  };
}

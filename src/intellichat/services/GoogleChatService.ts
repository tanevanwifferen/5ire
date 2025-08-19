import Debug from 'debug';
import { filetypemime } from 'magic-bytes.js';
import {
  IChatContext,
  IChatRequestMessage,
  IChatRequestPayload,
  IAnthropicTool,
  IGeminiChatRequestMessagePart,
  IGoogleTool,
  IMCPTool,
  IOpenAITool,
} from 'intellichat/types';
import { isBlank } from 'utils/validators';
import Google from 'providers/Google';
import {
  addStringTypeToEnumProperty,
  getBase64,
  removeAdditionalProperties,
  splitByImg,
  stripHtmlTags,
  transformPropertiesType,
  urlJoin,
} from 'utils/util';
import BaseReader from 'intellichat/readers/BaseReader';
import GoogleReader from 'intellichat/readers/GoogleReader';
import {
  ContentBlockConverter as MCPContentBlockConverter,
  FinalContentBlock,
} from 'intellichat/mcp/ContentBlockConverter';
import { ITool } from 'intellichat/readers/IChatReader';
import NextChatService from './NextChatService';
import INextChatService from './INextCharService';

const debug = Debug('5ire:intellichat:GoogleChatService');

export default class GoogleChatService
  extends NextChatService
  implements INextChatService
{
  constructor(name: string, context: IChatContext) {
    super({
      name,
      context,
      provider: Google,
    });
  }

  // eslint-disable-next-line class-methods-use-this
  protected getReaderType(): new (
    reader: ReadableStreamDefaultReader<Uint8Array>,
  ) => BaseReader {
    return GoogleReader;
  }

  // eslint-disable-next-line class-methods-use-this
  protected async makeToolMessages(
    tool: ITool,
    toolResult: any,
  ): Promise<IChatRequestMessage[]> {
    const parts = [];

    if (typeof toolResult === 'string') {
      parts.push({
        functionResponse: {
          name: tool.name,
          content: toolResult,
        },
      });
    } else {
      const content = Array.isArray(toolResult.content)
        ? toolResult.content
        : [];

      const convertedBlocks: FinalContentBlock[] = [];

      // eslint-disable-next-line no-restricted-syntax
      for (const block of content) {
        // eslint-disable-next-line no-await-in-loop
        convertedBlocks.push(await MCPContentBlockConverter.convert(block));
      }

      if (convertedBlocks.every((item) => item.type === 'text')) {
        parts.push({
          functionResponse: {
            name: tool.name,
            content: convertedBlocks.map((item) => item.text).join('\n\n\n'),
          },
        });
      } else {
        parts.push({
          functionResponse: {
            name: tool.name,
            content: `NOTE: This tool output is only a placeholder. See the following parts of this message for the actual tool result. Please use that for processing.`,
          },
        });

        // eslint-disable-next-line no-restricted-syntax
        for (const item of convertedBlocks) {
          switch (item.type) {
            case 'text':
              parts.push({
                text: item.text,
              });
              break;
            case 'audio': {
              parts.push({
                inline_data: {
                  mimeType: item.source.mimeType,
                  data: item.source.data,
                },
              });
              break;
            }
            case 'image':
              if (item.source.type === 'url') {
                parts.push({
                  fileData: {
                    fileUri: item.source.url,
                    mimeType: item.source.mimeType,
                  },
                });
              } else {
                parts.push({
                  inline_data: {
                    mimeType: item.source.mimeType,
                    data: item.source.data,
                  },
                });
              }
              break;
            default:
              break;
          }
        }
      }
    }

    return [
      {
        role: 'model',
        parts: [
          {
            functionCall: {
              name: tool.name,
              args: tool.args,
            },
          },
        ],
      },
      {
        role: 'user',
        parts: parts as any,
      },
    ];
  }

  // eslint-disable-next-line class-methods-use-this
  protected makeTool(
    tool: IMCPTool,
  ): IOpenAITool | IAnthropicTool | IGoogleTool {
    if (Object.keys(tool.inputSchema.properties).length === 0) {
      return {
        name: tool.name,
        description: tool.description,
      };
    }
    const properties: any = {};
    // eslint-disable-next-line no-restricted-syntax, guard-for-in
    for (const key in tool.inputSchema.properties) {
      let prop = tool.inputSchema.properties[key];
      /**
       * cause gemini-pro-vision not support additionalProperties
       */
      if (prop) {
        prop = removeAdditionalProperties(prop);
        prop = addStringTypeToEnumProperty(prop);
      }
      properties[key] = {
        type: prop.type,
        description: prop.description,
        items: prop.items,
      };
    }

    return {
      name: tool.name,
      description: tool.description,
      parameters: {
        type: tool.inputSchema.type,
        properties,
        required: tool.inputSchema.required,
      },
    };
  }

  protected async convertPromptContent(
    content: string,
  ): Promise<IGeminiChatRequestMessagePart[]> {
    if (this.context.getModel().capabilities?.vision?.enabled) {
      const items = splitByImg(content, false);
      const result: IGeminiChatRequestMessagePart[] = [];
      // eslint-disable-next-line no-restricted-syntax
      for (const item of items) {
        if (item.type === 'image') {
          if (item.dataType === 'URL') {
            result.push({
              inline_data: {
                mimeType: item.mimeType,
                // eslint-disable-next-line no-await-in-loop
                data: await getBase64(item.data),
              },
            });
          } else {
            result.push({
              inline_data: {
                mimeType: item.mimeType as string,
                data: item.data.split('base64,')[1], // remove data:image/png;base64,
              },
            });
          }
        } else if (item.type === 'text') {
          result.push({
            text: item.data,
          });
        } else {
          throw new Error('Unknown message type');
        }
      }
      return result;
    }
    return Promise.resolve([{ text: stripHtmlTags(content) }]);
  }

  /**
   *
   * 由于  gemini-pro-vision  不支持多轮对话，因此如果提示词包含图片，则不包含历史信息。
   */
  protected async makeMessages(
    messages: IChatRequestMessage[],
    msgId?: string,
  ): Promise<IChatRequestMessage[]> {
    const result: IChatRequestMessage[] = [];
    const systemMessage = this.context.getSystemMessage();
    if (!isBlank(systemMessage)) {
      result.push({
        role: 'user',
        parts: [{ text: systemMessage as string }],
      });
    }
    // eslint-disable-next-line no-restricted-syntax
    for (const msg of this.context.getCtxMessages(msgId)) {
      if (msg.structuredPrompts) {
        const strucuredPrompts = JSON.parse(msg.structuredPrompts) as {
          role: string;
          content: FinalContentBlock[];
        }[];

        // eslint-disable-next-line no-restricted-syntax
        for (const prompt of strucuredPrompts) {
          const parts = [] as IGeminiChatRequestMessagePart[];

          // eslint-disable-next-line no-restricted-syntax
          for (const block of prompt.content) {
            if (block.type === 'text') {
              parts.push({
                text: block.text,
              });
            } else if (block.type === 'image') {
              const { source } = block;

              if (source.type === 'base64') {
                parts.push({
                  inline_data: {
                    mimeType: source.mimeType,
                    data: source.data,
                  },
                });
              } else {
                // eslint-disable-next-line no-await-in-loop
                const data = await getBase64(source.url);
                const binary = new Uint8Array(
                  atob(data)
                    .split('')
                    .map((c) => c.charCodeAt(0)),
                );
                const mimeType = filetypemime(binary)[0] || 'audio/mpeg';

                parts.push({
                  inline_data: {
                    data,
                    mimeType,
                  },
                });
              }
            } else {
              parts.push({
                inline_data: {
                  mimeType: block.source.mimeType,
                  data: block.source.data,
                },
              });
            }
          }
        }
      } else {
        result.push({
          role: 'user',
          parts: [{ text: msg.prompt }],
        });
      }
      // result.push({
      //   role: 'user',
      //   parts: [{ text: msg.prompt }],
      // });
      result.push({
        role: 'model',
        parts: [
          {
            text: msg.reply,
          },
        ],
      });
    }
    // eslint-disable-next-line no-restricted-syntax
    for (const msg of messages) {
      if (typeof msg.content === 'string') {
        result.push({
          role: msg.role,
          // eslint-disable-next-line no-await-in-loop
          parts: await this.convertPromptContent(msg.content),
        });
      } else {
        result.push({
          role: msg.role,
          parts: msg.parts,
        });
      }
    }
    return result;
  }

  protected async makePayload(
    messages: IChatRequestMessage[],
    msgId?: string,
  ): Promise<IChatRequestPayload> {
    const payload: IChatRequestPayload = {
      contents: await this.makeMessages(messages, msgId),
      generationConfig: {
        temperature: this.context.getTemperature(),
      },
    };
    if (this.isToolsEnabled()) {
      const tools = await window.electron.mcp.listTools();
      if (tools) {
        // eslint-disable-next-line no-underscore-dangle
        const _tools = tools.tools
          .filter((tool: any) => !this.usedToolNames.includes(tool.name))
          .map((tool: any) => {
            return this.makeTool(tool);
          });
        if (_tools.length > 0) {
          payload.tools = [
            {
              function_declarations: [transformPropertiesType(_tools)],
            },
          ];
          payload.tool_config = { function_calling_config: { mode: 'AUTO' } };
        }
      }
    }
    const maxOutputTokens = this.context.getMaxTokens();
    if (payload.generationConfig && maxOutputTokens) {
      payload.generationConfig.maxOutputTokens = maxOutputTokens;
    }
    debug('payload', payload);
    return payload;
  }

  protected async makeRequest(
    messages: IChatRequestMessage[],
    msgId?: string,
  ): Promise<Response> {
    const payload = await this.makePayload(messages, msgId);
    const isStream = this.context.isStream();
    debug(
      `About to make a request,stream:${isStream},  payload: ${JSON.stringify(
        payload,
      )}\r\n`,
    );
    const provider = this.context.getProvider();
    const url = urlJoin(
      `/v1beta/models/${this.getModelName()}:${
        isStream ? 'streamGenerateContent' : 'generateContent'
      }?key=${provider.apiKey.trim()}`,
      provider.apiBase.trim(),
    );
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(payload),
      signal: this.abortController.signal,
    });
    return response;
  }
}

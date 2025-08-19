import Debug from 'debug';
import {
  IChatContext,
  IChatRequestMessage,
  IChatRequestPayload,
  IChatMessage,
  IChatRequestMessageContent,
  IAnthropicTool,
  IMCPTool,
  IOpenAITool,
} from 'intellichat/types';
import { isBlank } from 'utils/validators';
import {
  getBase64,
  removeAdditionalProperties,
  splitByImg,
  stripHtmlTags,
  urlJoin,
} from 'utils/util';
import AnthropicReader from 'intellichat/readers/AnthropicReader';
import {
  ContentBlockConverter as MCPContentBlockConverter,
  FinalContentBlock,
} from 'intellichat/mcp/ContentBlockConverter';
import { ITool } from 'intellichat/readers/IChatReader';
import INextChatService from './INextCharService';
import NextChatService from './NextChatService';
import Anthropic from '../../providers/Anthropic';
// eslint-disable-next-line import/order
// import { isPlainObject, omit } from 'lodash';

const debug = Debug('5ire:intellichat:AnthropicChatService');

export default class AnthropicChatService
  extends NextChatService
  implements INextChatService
{
  constructor(name: string, context: IChatContext) {
    super({
      name,
      context,
      provider: Anthropic,
    });
  }

  // eslint-disable-next-line class-methods-use-this
  protected async makeToolMessages(
    tool: ITool,
    toolResult: any,
    content?: string,
  ): Promise<IChatRequestMessage[]> {
    /**
     * Note：not supported tool's inputs
     * 1.mimeType
     */
    // if (isPlainObject(toolResult.content)) {
    //   delete toolResult.content.mimeType;
    // } else if (Array.isArray(toolResult.content)) {
    //   toolResult.content = toolResult.content.map((item: any) => {
    //     return omit(item, ['mimeType']);
    //   });
    // }

    const parts = [];

    if (typeof toolResult === 'string') {
      parts.push({
        type: 'tool_result',
        tool_use_id: tool.id,
        content: toolResult,
      });
    } else {
      const contentParts = Array.isArray(toolResult.content)
        ? toolResult.content
        : [];

      const convertedBlocks: FinalContentBlock[] = [];

      // eslint-disable-next-line no-restricted-syntax
      for (const block of contentParts) {
        // eslint-disable-next-line no-await-in-loop
        convertedBlocks.push(await MCPContentBlockConverter.convert(block));
      }

      if (convertedBlocks.every((item) => item.type === 'text')) {
        parts.push({
          type: 'tool_result',
          tool_use_id: tool.id,
          content: convertedBlocks.map((item) => item.text).join('\n\n\n'),
        });
      } else {
        parts.push({
          type: 'tool_result',
          tool_use_id: tool.id,
          content: `NOTE: This tool output is only a placeholder. See the following parts of this message for the actual tool result. Please use that for processing.`,
        });

        // eslint-disable-next-line no-restricted-syntax
        for (const item of convertedBlocks) {
          parts.push(
            MCPContentBlockConverter.contentBlockToLegacyMessageContent(item),
          );
        }
      }
    }

    const result = [
      {
        role: 'assistant',
        content: [
          {
            type: 'tool_use',
            id: tool.id,
            name: tool.name,
            input: tool.args ?? {},
          },
        ],
      },
      {
        role: 'user',
        content: parts,
      },
    ] as IChatRequestMessage[];
    if (content) {
      (result[0].content as any[]).unshift({
        type: 'text',
        text: content,
      });
    }
    return result;
  }

  // eslint-disable-next-line class-methods-use-this
  protected makeTool(tool: IMCPTool): IOpenAITool | IAnthropicTool {
    return {
      name: tool.name,
      description: tool.description,
      input_schema: {
        type: tool.inputSchema.type,
        properties:
          removeAdditionalProperties(tool.inputSchema.properties) || {},
        required: tool.inputSchema.required || [],
      },
    };
  }

  // eslint-disable-next-line class-methods-use-this
  protected getReaderType() {
    return AnthropicReader;
  }

  protected async convertPromptContent(
    content: string,
  ): Promise<string | IChatRequestMessageContent[]> {
    if (this.context.getModel().capabilities.vision?.enabled) {
      const items = splitByImg(content);
      const promises = items.map(async (item) => {
        if (item.type === 'image') {
          let data = '';
          if (item.dataType === 'URL') {
            data = await getBase64(item.data);
          } else {
            [, data] = item.data.split(','); // remove data:image/png;base64,
          }
          return {
            type: 'image',
            source: {
              type: 'base64',
              media_type: item.mimeType as string,
              data,
            },
          };
        }
        if (item.type === 'text') {
          return {
            type: 'text',
            text: item.data,
          };
        }
        throw new Error('Unknown message type');
      });

      const result = (await Promise.all(
        promises,
      )) as IChatRequestMessageContent[];
      return result;
    }
    return stripHtmlTags(content);
  }

  protected async makeMessages(
    messages: IChatRequestMessage[],
    msgId?: string,
  ): Promise<IChatRequestMessage[]> {
    const result = this.context
      .getCtxMessages(msgId)
      .reduce((acc: IChatRequestMessage[], msg: IChatMessage) => {
        const msgs: IChatRequestMessage[] = [];

        if (msg.structuredPrompts) {
          let strucuredPrompts: {
            role: string;
            content: FinalContentBlock[];
          }[];

          try {
            strucuredPrompts = JSON.parse(msg.structuredPrompts);
          } catch (e) {
            throw new Error('Failed to parse structuredPrompts');
          }

          strucuredPrompts.forEach((message) => {
            msgs.push({
              role: message.role as 'user',
              content: message.content.map((block) => {
                return MCPContentBlockConverter.contentBlockToLegacyMessageContent(
                  block,
                );
              }),
            });
          });
        } else {
          msgs.push({
            role: 'user',
            content: msg.prompt,
          });
        }

        msgs.push({
          role: 'assistant',
          content: msg.reply,
        });

        return [...acc, ...msgs] as IChatRequestMessage[];
      }, []);

    const processedMessages = (await Promise.all(
      messages.map(async (msg) => {
        if (msg.role === 'tool') {
          return {
            content: JSON.stringify(msg.content),
            type: 'tool_result',
            tool_use_id: msg.tool_call_id,
          };
        }
        if (msg.role === 'assistant' && msg.tool_calls) {
          return msg;
        }
        const { content } = msg;
        if (typeof content === 'string') {
          return {
            role: msg.role,
            content: await this.convertPromptContent(content),
          };
        }

        if (Array.isArray(content)) {
          return {
            role: msg.role,
            content: content.map((item) => {
              if (item.type === 'text') {
                return {
                  type: 'text',
                  text: item.text,
                };
              }

              if (item.type === 'image_url') {
                const url = item.image_url?.url || '';

                return {
                  type: 'image',
                  source: {
                    type: 'url',
                    url,
                  },
                };
              }

              // Unsupport audio
              if (item.type === 'audio') {
                debug(
                  'Warning: Audio content type not supported, converting to empty text',
                );

                return {
                  type: 'text',
                  text: '',
                };
              }

              debug(
                `Warning: Unknown content type '${item.type}', converting to empty text`,
              );
              return {
                type: 'text',
                text: '',
              };
            }),
          };
        }

        return {
          role: msg.role,
          content: '',
        };
      }),
    )) as IChatRequestMessage[];

    return [...result, ...processedMessages];
  }

  protected async makePayload(
    messages: IChatRequestMessage[],
    msgId?: string,
  ): Promise<IChatRequestPayload> {
    const payload: IChatRequestPayload = {
      model: this.getModelName(),
      messages: await this.makeMessages(messages, msgId),
      temperature: this.context.getTemperature(),
      stream: true,
    };
    const systemMessage = this.context.getSystemMessage();
    if (!isBlank(systemMessage)) {
      payload.system = systemMessage as string;
    }
    if (this.context.getMaxTokens()) {
      payload.max_tokens = this.context.getMaxTokens();
    }
    if (this.isToolsEnabled()) {
      const tools = await window.electron.mcp.listTools();
      if (tools) {
        const unusedTools = tools.tools
          .filter((tool: any) => !this.usedToolNames.includes(tool.name))
          .map((tool: any) => {
            return this.makeTool(tool);
          });
        if (unusedTools.length > 0) {
          payload.tools = unusedTools;
          payload.tool_choice = {
            type: 'auto',
            disable_parallel_tool_use: true,
          };
        }
      }
    }
    if (this.context.getMaxTokens()) {
      payload.max_tokens = this.context.getMaxTokens();
    }
    return payload;
  }

  protected async makeRequest(
    messages: IChatRequestMessage[],
    msgId?: string,
  ): Promise<Response> {
    const payload = await this.makePayload(messages, msgId);
    debug('About to make a request, payload:\r\n', payload);
    const provider = this.context.getProvider();
    const url = urlJoin('/messages', provider.apiBase.trim());
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'anthropic-version': '2023-06-01',
        'x-api-key': provider.apiKey.trim(),
      },
      body: JSON.stringify(payload),
      signal: this.abortController.signal,
    });
    return response;
  }
}

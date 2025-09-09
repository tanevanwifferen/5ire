import Debug from 'debug';
import { IChatResponseMessage } from 'intellichat/types';
import BaseReader from './BaseReader';
import IChatReader, { ITool } from './IChatReader';

const debug = Debug('5ire:intellichat:OpenAIReader');

/**
 * OpenAI-specific implementation of a chat response reader.
 * Handles parsing of OpenAI streaming chat responses, including content, reasoning,
 * and tool calls according to OpenAI's response format.
 */
export default class OpenAIReader extends BaseReader implements IChatReader {
  /**
   * Parse a raw chunk from OpenAI's streaming response into a structured message.
   * Handles OpenAI's specific response format with choices array and delta objects.
   * @param {string} chunk - The raw JSON chunk string from OpenAI's streaming response
   * @returns {IChatResponseMessage} Parsed chat response message with content, reasoning, and tool calls
   * @throws {Error} When the response contains an error object
   */
  protected parseReply(chunk: string): IChatResponseMessage {
    const data = JSON.parse(chunk);
    if (data.error) {
      throw new Error(data.error.message || data.error);
    }
    if (data.choices.length === 0) {
      return {
        content: '',
        reasoning: '',
        isEnd: false,
        toolCalls: [],
      };
    }
    const choice = data.choices[0];
    return {
      content: choice.delta.content || '',
      reasoning: choice.delta.reasoning_content || '',
      isEnd: false,
      toolCalls: choice.delta.tool_calls,
    };
  }

  /**
   * Extract tool information from an OpenAI response message.
   * Returns the first tool call if available, formatted as an ITool object.
   * @param {IChatResponseMessage} respMsg - The response message to parse tools from
   * @returns {ITool | null} The first tool call with id and name, or null if no tool calls exist
   */
  protected parseTools(respMsg: IChatResponseMessage): ITool | null {
    if (respMsg.toolCalls && respMsg.toolCalls.length > 0) {
      return {
        id: respMsg.toolCalls[0].id,
        name: respMsg.toolCalls[0].function.name,
      };
    }
    return null;
  }

  /**
   * Extract tool arguments from an OpenAI response message.
   * Parses the function arguments from the first tool call in the response.
   * @param {IChatResponseMessage} respMsg - The response message containing tool calls
   * @returns {{index: number, args: string} | null} Object with argument index and args string, or null if no tool calls or if response is ended
   */
  protected parseToolArgs(respMsg: IChatResponseMessage): {
    index: number;
    args: string;
  } | null {
    try {
      if (respMsg.isEnd || !respMsg.toolCalls) {
        return null;
      }
      const toolCalls = respMsg.toolCalls[0];
      return {
        index: toolCalls.index || 0,
        args: toolCalls.function?.arguments || '',
      };
    } catch (err) {
      console.error('parseToolArgs', err);
    }
    return null;
  }
}

import { IChatContext, IChatRequestMessage } from 'intellichat/types';
import { urlJoin } from 'utils/util';
import OpenAIChatService from './OpenAIChatService';
import Doubao from '../../providers/Doubao';
import INextChatService from './INextCharService';

export default class DoubaoChatService
  extends OpenAIChatService
  implements INextChatService
{
  constructor(name: string, chatContext: IChatContext) {
    super(name, chatContext);
    this.provider = Doubao;
  }

  /**
   * Override makeMessages to filter message content based on model capabilities.
   *
   * The Volcengine API will throw errors if the model receives unsupported content types.
   * For example, a non-multimodal model will fail when receiving image or image_url content.
   *
   * Therefore:
   * 1. First, check whether the current model has vision capability enabled.
   * 2. Iterate through each message and filter its content array:
   *    - Keep items of type 'text'.
   *    - Keep 'image' or 'image_url' items only if vision is enabled.
   *    - Filter out other types (e.g., audio) because context.capabilities
   *      currently does not provide a way to check for audio support.
   *
   * This ensures that all content sent to the model is within its supported types,
   * preventing API errors.
   */
  protected override async makeMessages(
    messages: IChatRequestMessage[],
    msgId?: string,
  ): Promise<IChatRequestMessage[]> {
    const result = await super.makeMessages(messages, msgId);

    const isVisionEnabled = Boolean(
      this.context.getModel().capabilities.vision?.enabled,
    );

    const sanitized = result.map((message) => {
      let { content } = message;

      if (Array.isArray(content)) {
        content = content.filter((item) => {
          if (item.type === 'text') {
            return true;
          }

          if (item.type === 'image' || item.type === 'image_url') {
            return isVisionEnabled;
          }

          return false;
        });
      }

      return { ...message, content };
    });

    return sanitized.filter(
      (m) => !(Array.isArray(m.content) && m.content.length === 0),
    );
  }

  protected async makeRequest(
    messages: IChatRequestMessage[],
    msgId?: string,
  ): Promise<Response> {
    const provider = this.context.getProvider();
    const model = this.context.getModel();
    const modelId = model.extras?.modelId || model.name;
    const payload = await this.makePayload(messages, msgId);
    payload.model = modelId;
    payload.stream = true;
    const url = urlJoin('/chat/completions', provider.apiBase.trim());
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${provider.apiKey.trim()}`,
      },
      body: JSON.stringify(payload),
      signal: this.abortController.signal,
    });
    return response;
  }
}

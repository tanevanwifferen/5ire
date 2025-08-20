// import Debug from 'debug';
import { IChatContext, IChatRequestMessage } from 'intellichat/types';
import Moonshot from 'providers/Moonshot';
import OpenAIChatService from './OpenAIChatService';
import INextChatService from './INextCharService';

// const debug = Debug('5ire:intellichat:MoonshotChatService');

export default class MoonshotChatService
  extends OpenAIChatService
  implements INextChatService
{
  constructor(name: string, context: IChatContext) {
    super(name, context);
    this.provider = Moonshot;
  }

  /**
   * Override makeMessages to filter message content based on model capabilities.
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
}

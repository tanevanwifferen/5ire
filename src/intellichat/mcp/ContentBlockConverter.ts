import { filetypemime } from 'magic-bytes.js';
import type { ContentBlock } from '@modelcontextprotocol/sdk/types.js';
import { UnsupportedError } from 'intellichat/mcp/UnsupportedError';
import type { IChatRequestMessageContent } from 'intellichat/types';

type TextBlock = Extract<ContentBlock, { type: 'text' }>;
type AudioBlock = Extract<ContentBlock, { type: 'audio' }>;
type ImageBlock = Extract<ContentBlock, { type: 'image' }>;
type ResourceBlock = Extract<ContentBlock, { type: 'resource' }>;
type ResourceLinkBlock = Extract<ContentBlock, { type: 'resource_link' }>;

export type FinalTextBlock = {
  type: 'text';
  text: string;
  origin?:
    | {
        type: 'document';
        content: string;
        mimetype: string;
        uri: string;
        blob?: string;
      }
    | {
        type: 'resource_link';
        name: string;
        uri: string;
        title?: string;
        description?: string;
      };
};

export type FinalAudioBlock = {
  type: 'audio';
  source: {
    type: 'base64';
    data: string;
    mimeType: 'audio/mpeg' | 'audio/wav';
  };
};

export type FinalImageBlock = {
  type: 'image';
  source:
    | {
        type: 'base64';
        data: string;
        mimeType: 'image/jpeg' | 'image/png' | 'image/gif' | 'image/webp';
      }
    | {
        type: 'url';
        url: string;
      };
};

export type FinalContentBlock =
  | FinalAudioBlock
  | FinalImageBlock
  | FinalTextBlock;

const SUPPORTED_IMAGE_MIMETYPES = [
  'image/jpeg',
  'image/png',
  'image/gif',
  'image/webp',
] as const;

const SUPPORTED_AUDIO_MIMETYPES = ['audio/mpeg', 'audio/wav'] as const;

const SUPPORTED_DOCUMENT_RESOURCE_MIMETYPES = {
  pdf: 'application/pdf',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
};

export class ContentBlockConverter {
  // Singleton pattern
  private constructor() {
    this.convert = this.convert.bind(this);
  }

  /**
   * Detects the MIME type of a base64-encoded blob.
   *
   * @param blob Base64-encoded blob
   * @returns Detected MIME type or undefined if it cannot be detected
   */
  private detectBase64MimeType(blob: string) {
    return filetypemime(
      new Uint8Array(
        atob(blob)
          .split('')
          .map((c) => c.charCodeAt(0)),
      ),
    )[0] as string | undefined;
  }

  private convertTextBlock(block: TextBlock) {
    return {
      type: 'text',
      text: block.text,
    } satisfies FinalTextBlock;
  }

  private convertAudioBlock(block: AudioBlock) {
    const { data, mimeType } = block;

    // TODO: Use FFmpeg to convert other unsupported formats
    if (!SUPPORTED_AUDIO_MIMETYPES.includes(mimeType as any)) {
      throw new UnsupportedError('Unsupported audio mimetype');
    }

    return {
      type: 'audio',
      source: {
        type: 'base64',
        data,
        mimeType: mimeType as any,
      },
    } satisfies FinalAudioBlock;
  }

  private convertImageBlock(block: ImageBlock) {
    const { data, mimeType } = block;

    // TODO: Use FFmpeg to convert other unsupported formats
    if (!SUPPORTED_IMAGE_MIMETYPES.includes(mimeType as any)) {
      throw new UnsupportedError('Unsupported image mimetype');
    }

    return {
      type: 'image',
      source: {
        type: 'base64',
        data,
        mimeType: mimeType as any,
      },
    } satisfies FinalImageBlock;
  }

  private async convertResourceBlock(block: ResourceBlock) {
    const { resource } = block;

    if ('text' in resource && typeof resource.text === 'string') {
      const { mimeType, uri, text } = resource;

      const finalMimeType = mimeType || 'text/plain';

      return {
        type: 'text',
        text: [
          `[Document Start]`,
          `URI: ${uri}`,
          `MimeType: ${finalMimeType}`,
          `Content:`,
          `"""`,
          `${text}`,
          `"""`,
          `[Document End]`,
        ].join('\n'),
      } satisfies FinalTextBlock;
    }

    if ('blob' in resource && typeof resource.blob === 'string') {
      let { mimeType } = resource;

      if (!mimeType) {
        mimeType = this.detectBase64MimeType(resource.blob);
      }

      if (!mimeType) {
        throw new UnsupportedError('Unknown resource mimetype');
      }

      if (mimeType.startsWith('image/')) {
        return this.convertImageBlock({
          type: 'image',
          data: resource.blob,
          mimeType,
        });
      }

      if (mimeType.startsWith('audio/')) {
        return this.convertAudioBlock({
          type: 'audio',
          data: resource.blob,
          mimeType,
        });
      }

      if (mimeType.startsWith('text/')) {
        const bytes = Uint8Array.from(
          atob(resource.blob)
            .split('')
            .map((c) => c.charCodeAt(0)),
        );

        return {
          type: 'text',
          text: [
            `[Document Start]`,
            `URI: ${resource.uri}`,
            `MimeType: ${mimeType}`,
            `Content:`,
            `"""`,
            `${new TextDecoder('utf-8').decode(bytes)}`, // Base64-encoded text to UTF-8 text.
            `"""`,
            `[Document End]`,
          ].join('\n'),
        } satisfies FinalTextBlock;
      }

      if (
        Object.values(SUPPORTED_DOCUMENT_RESOURCE_MIMETYPES).includes(mimeType)
      ) {
        let fileType: string = '';

        Object.entries(SUPPORTED_DOCUMENT_RESOURCE_MIMETYPES).forEach(
          ([key, value]) => {
            if (value === mimeType) {
              fileType = key;
            }
          },
        );

        const text = await window.electron.document.loadFromBuffer(
          Uint8Array.from(
            atob(resource.blob)
              .split('')
              .map((c) => c.charCodeAt(0)),
          ),
          fileType,
        );

        return {
          type: 'text',
          text: [
            `[Document Start]`,
            `URI: ${resource.uri}`,
            `MimeType: ${mimeType}`,
            `Content:`,
            `"""`,
            `${text}`,
            `"""`,
            `[Document End]`,
          ].join('\n'),
        } satisfies FinalTextBlock;
      }
    }

    throw new UnsupportedError('Unsupported resource type');
  }

  private convertResourceLinkBlock(block: ResourceLinkBlock) {
    return {
      type: 'text',
      text: [
        `[Resource Start]`,
        `Name: ${block.name}`,
        `Title: ${block.title}`,
        `Description: ${block.description}`,
        `URI: ${block.uri}`,
        `[Resource End]`,
      ].join('\n'),
    } satisfies FinalTextBlock;
  }

  public async convert(block: ContentBlock): Promise<FinalContentBlock> {
    switch (block.type) {
      case 'text': {
        return this.convertTextBlock(block);
      }
      case 'audio': {
        return this.convertAudioBlock(block);
      }
      case 'image': {
        return this.convertImageBlock(block);
      }
      case 'resource': {
        return this.convertResourceBlock(block);
      }
      case 'resource_link': {
        return this.convertResourceLinkBlock(block);
      }
      default: {
        throw new UnsupportedError('Unknown content block type.');
      }
    }
  }

  // eslint-disable-next-line no-use-before-define
  static #instance: ContentBlockConverter | null = null;

  /**
   * Convert the content block returned by MCP to a format that can be used by the large model.
   *
   * @param block - The content block returned by MCP.
   * @returns A promise that resolves to the converted content block.
   */
  static async convert(block: ContentBlock) {
    if (!ContentBlockConverter.#instance) {
      ContentBlockConverter.#instance = new ContentBlockConverter();
    }

    return ContentBlockConverter.#instance.convert(block);
  }

  /**
   * @deprecated This method is temporary and will be removed in a future version.
   *
   * This function converts a `FinalContentBlock` into an `IChatRequestMessageContent`.
   * It was introduced to maintain compatibility with earlier code that used `IChatRequestMessageContent`
   * to represent a portion of a message. This part of the code is likely to be refactored
   * in subsequent versions.
   *
   * @param part The content block to convert.
   * @returns The legacy message content object.
   */
  static contentBlockToLegacyMessageContent(
    part: FinalContentBlock,
  ): IChatRequestMessageContent {
    if (part.type === 'text') {
      return {
        type: 'text',
        text: part.text,
      };
    }

    if (part.type === 'image') {
      if (part.source.type === 'base64') {
        return {
          type: 'image_url',
          image_url: {
            url: `data:${part.source.mimeType};base64,${part.source.data}`,
          },
        };
      }

      return {
        type: 'image_url',
        image_url: {
          url: part.source.url,
        },
      };
    }

    return {
      type: 'audio',
      source: {
        type: 'base64',
        data: part.source.data,
        media_type: part.source.mimeType,
      },
    };
  }
}

export default ContentBlockConverter;

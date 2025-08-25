import Parser from '@postlight/parser';
import type { ContentPart, Loader } from './DocumentLoader';

export class TextLoader implements Loader {
  load = async (
    buffer: Uint8Array,
    mimeType: string,
  ): Promise<ContentPart[]> => {
    if (mimeType.startsWith('text/html')) {
      try {
        return await Parser.parse('https://5ire.app', {
          html: Buffer.from(buffer),
          contentType: 'markdown',
        }).then((result) => {
          return [
            {
              type: 'text',
              text: `# ${result.title || ''}\n\n${result.content || ''}`,
            },
          ];
        });
      } catch {
        // noop
      }
    }

    return [
      {
        type: 'text',
        text: Buffer.from(buffer).toString('utf8'),
      },
    ];
  };

  getSupportedMimeTypes = () => {
    const result = [] as string[];

    Object.values(this.getSupportedFileExtensions()).forEach((mimeType) => {
      if (mimeType.startsWith('text/')) {
        return;
      }

      result.push(mimeType);
    });

    return [/text\/.*/, ...new Set(result)];
  };

  getSupportedFileExtensions = () => {
    return {
      txt: 'text/plain',
      md: 'text/markdown',
      csv: 'text/csv',
      json: 'application/json',
      yaml: 'application/x-yaml',
      yml: 'application/x-yaml',
      xml: 'application/xml',
      html: 'text/html',
      htm: 'text/html',
      log: 'text/plain',
      tsv: 'text/tab-separated-values',
      ini: 'text/plain',
      conf: 'text/plain',
      bat: 'application/x-bat',
      sh: 'application/x-sh',
      py: 'text/x-python',
      java: 'text/x-java-source',
      c: 'text/x-c',
      cpp: 'text/x-c++src',
      css: 'text/css',
      js: 'application/javascript',
      ts: 'application/typescript',
      jsonl: 'application/json',
    };
  };
}

export default TextLoader;

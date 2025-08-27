import parsePDF from 'pdf-parse';

import type { ContentPart, Loader } from './DocumentLoader';

export class PDFLoader implements Loader {
  load = async (buffer: Uint8Array): Promise<ContentPart[]> => {
    try {
      const result = await parsePDF(Buffer.from(buffer));

      return [
        {
          type: 'text',
          text: result.text || '',
        },
      ];
    } catch (error) {
      throw new Error(
        `Failed to parse PDF: ${
          error instanceof Error ? error.message : 'Unknown error'
        }`,
      );
    }
  };

  getSupportedMimeTypes = () => {
    return Object.values(this.getSupportedFileExtensions());
  };

  getSupportedFileExtensions = () => {
    return {
      pdf: 'application/pdf',
    };
  };
}

export default PDFLoader;

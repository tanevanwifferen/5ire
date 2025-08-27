import officeParser from 'officeparser';

import type { ContentPart, Loader } from './DocumentLoader';

export class OfficeLoader implements Loader {
  load = async (buffer: Uint8Array): Promise<ContentPart[]> => {
    try {
      const result = await officeParser.parseOfficeAsync(Buffer.from(buffer));

      return [
        {
          type: 'text',
          text: result || '',
        },
      ];
    } catch (error) {
      throw new Error(
        `Failed to parse Office document: ${error instanceof Error ? error.message : 'Unknown error'}`,
      );
    }
  };

  getSupportedMimeTypes = () => {
    return Object.values(this.getSupportedFileExtensions());
  };

  getSupportedFileExtensions = () => {
    return {
      docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
      xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      odt: 'application/vnd.oasis.opendocument.text',
      odp: 'application/vnd.oasis.opendocument.presentation',
      ods: 'application/vnd.oasis.opendocument.spreadsheet',
    };
  };
}

export default OfficeLoader;

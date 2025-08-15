import type { Stats } from 'node:fs';
import { stat, open } from 'node:fs/promises';
import { Readable } from 'node:stream';
import { fileURLToPath } from 'node:url';
import { basename } from 'node:path';

import type { URILoader, URIResource } from './DocumentLoader';

export class FileURILoader implements URILoader {
  load = async (url: URL): Promise<URIResource> => {
    const path = fileURLToPath(url);

    let stats: Stats;

    try {
      stats = await stat(path);

      if (!stats.isFile()) {
        throw new Error(`Not a file: ${path}`);
      }
    } catch (error) {
      if (
        error &&
        typeof error === 'object' &&
        'code' in error &&
        error.code === 'ENOENT'
      ) {
        throw new Error('File not found');
      }

      throw error;
    }

    const handle = await open(path);
    const stream = handle.createReadStream({ encoding: 'binary' });

    return {
      stream: Readable.toWeb(stream) as ReadableStream<Uint8Array>,
      size: stats.size,
      fileName: basename(path),
    };
  };

  getSupportedProtocols = () => {
    return ['file'];
  };
}

export default FileURILoader;

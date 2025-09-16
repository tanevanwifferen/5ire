/* eslint-disable no-console */
import Database, { Statement } from 'better-sqlite3';
import { app, ipcMain } from 'electron';
import path from 'path';
import * as logging from './logging';
import { isOneDimensionalArray } from '../utils/util';

/** Database file path in the user data directory */
const dbPath = path.join(app.getPath('userData'), '5ire.db');

/** SQLite database instance */
const database = new Database(dbPath);

/**
 * Creates the folders table if it doesn't exist
 * Stores folder configurations with AI model settings and knowledge collection references
 */
function createTableFolders() {
  database
    .prepare(
      `
  CREATE TABLE IF NOT EXISTS "folders" (
    "id" text(31) NOT NULL,
    "name" text,
    "provider" text,
    "model" text,
    "systemMessage" text,
    "temperature" real,
    "maxTokens" integer,
    "knowledgeCollectionIds" text,
    "stream" integer(1) DEFAULT 1,
    "maxCtxMessages" integer DEFAULT 10,
    "createdAt" integer,
    PRIMARY KEY ("id")
  )`,
    )
    .run();
}

/**
 * Creates the chats table if it doesn't exist
 * Stores chat sessions with their configuration and metadata
 */
function createTableChats() {
  database
    .prepare(
      `
  CREATE TABLE IF NOT EXISTS "chats" (
    "id" text(31) NOT NULL,
    "folderId" text(31),
    "name" text,
    "summary" text,
    "provider" text,
    "model" text,
    "systemMessage" text,
    "temperature" real,
    "maxTokens" integer,
    "stream" integer(1) DEFAULT 1,
    "context" text,
    "maxCtxMessages" integer DEFAULT 10,
    "prompt" TEXT,
    "input" TEXT,
    "createdAt" integer,
    PRIMARY KEY ("id")
  )`,
    )
    .run();
}

/**
 * Creates the messages table if it doesn't exist
 * Stores individual messages within chats with token usage and citations
 */
function createTableMessages() {
  database
    .prepare(
      `CREATE TABLE IF NOT EXISTS "messages" (
      "id" text(31) NOT NULL,
      "prompt" TEXT COLLATE NOCASE,
      "reply" TEXT COLLATE NOCASE,
      "reasoning" TEXT,
      "inputTokens" integer,
      "outputTokens" integer,
      "chatId" text(31),
      "temperature" real,
      "model" text,
      "memo" text,
      "createdAt" integer,
      "isActive" integer(1),
      "citedFiles"	TEXT,
      "citedChunks"	TEXT,
      "maxTokens" INTEGER,
      PRIMARY KEY ("id"),
      CONSTRAINT "fk_messages_chats" FOREIGN KEY ("chatId") REFERENCES "chats" ("id") ON DELETE CASCADE ON UPDATE CASCADE
    )`,
    )
    .run();
}

/**
 * Creates the bookmarks table if it doesn't exist
 * Stores bookmarked messages for quick access
 */
function createTableBookmarks() {
  database
    .prepare(
      `CREATE TABLE IF NOT EXISTS "bookmarks" (
    "id" text(31) NOT NULL,
    "msgId" text NOT NULL,
    "prompt" TEXT,
    "reply" TEXT,
    "reasoning" TEXT,
    "temperature" real,
    "model" text,
    "memo" text,
    "favorite" integer(1) DEFAULT 0,
    "citedFiles"	TEXT,
    "citedChunks"	TEXT,
    "createdAt" integer,
    PRIMARY KEY ("id"),
    CONSTRAINT "uix_msg_id" UNIQUE ("msgId" COLLATE BINARY ASC)
  )`,
    )
    .run();
}

/**
 * Creates the prompts table if it doesn't exist
 * Stores reusable prompt templates with variables and model configurations
 */
function createTablePrompts() {
  database
    .prepare(
      `CREATE TABLE IF NOT EXISTS "prompts" (
    "id" text(31) NOT NULL,
    "name" text,
    "systemMessage" TEXT,
    "userMessage" text,
    "systemVariables" text,
    "userVariables" text,
    "models" text,
    "temperature" real,
    "maxTokens" integer,
    "createdAt" integer,
    "updatedAt" integer,
    "pinedAt" integer DEFAULT NULL,
    PRIMARY KEY ("id")
  )`,
    )
    .run();
}

/**
 * Creates the usages table if it doesn't exist
 * Tracks token usage and costs for different AI providers and models
 */
function createTableUsages() {
  database
    .prepare(
      `CREATE TABLE IF NOT EXISTS "usages" (
    "id" text(31),
    "provider" text,
    "model" text,
    "InputTokens" integer,
    "outputTokens" integer,
    "inputPrice" number,
    "outputPrice" NUMBER,
    "createdAt" integer,
    PRIMARY KEY ("id")
  )`,
    )
    .run();
}

/**
 * Creates the knowledge_collections table if it doesn't exist
 * Stores collections of knowledge files for RAG functionality
 */
function createTableKnowledgeCollections() {
  database
    .prepare(
      `CREATE TABLE IF NOT EXISTS "knowledge_collections" (
     "id" text(31) NOT NULL,
     "name" varchar NOT NULL,
     "memo" text,
     "pinedAt" integer,
     "favorite" integer(1),
     "createdAt" integer NOT NULL,
     "updatedAt" integer NOT NULL,
     PRIMARY KEY (id));`,
    )
    .run();
}

/**
 * Creates the knowledge_files table if it doesn't exist
 * Stores individual files within knowledge collections
 */
function createTableKnowledgeFiles() {
  database
    .prepare(
      `CREATE TABLE IF NOT EXISTS "knowledge_files" (
    "id" text(31) NOT NULL,
    "collectionId" text(31) NOT NULL,
    "name" varchar NOT NULL,
    "size" integer,
    "numOfChunks" integer,
    "createdAt" integer NOT NULL,
    "updatedAt" integer NOT NULL,
    PRIMARY KEY (id),
    FOREIGN KEY (collectionId)
        REFERENCES knowledge_collections(id)
        ON DELETE CASCADE
    );`,
    )
    .run();
}

/**
 * Creates the chat_knowledge_rels table if it doesn't exist
 * Links chats to knowledge collections for context retrieval
 */
function createTableChatKnowledgeRels() {
  database
    .prepare(
      `CREATE TABLE IF NOT EXISTS "chat_knowledge_rels" (
	"id" text NOT NULL,
	"chatId" text NOT NULL,
	"collectionId" text NOT NULL,
	FOREIGN KEY("chatId") REFERENCES "chats"("id") ON DELETE CASCADE,
	FOREIGN KEY("collectionId") REFERENCES "knowledge_collections"("id") ON DELETE CASCADE,
	PRIMARY KEY (id)
)`,
    )
    .run();
}

/**
 * Adds missing columns to the chats table for backward compatibility
 * Checks for and adds prompt, input, folderId, provider, and name columns if they don't exist
 */
function alertTableChats() {
  const columns = database.prepare(`PRAGMA table_info(chats)`).all();
  const hasPromptColumn = columns.some(
    (column: any) => column.name === 'prompt',
  );
  if (!hasPromptColumn) {
    database.prepare(`ALTER TABLE chats ADD COLUMN prompt TEXT`).run();
    logging.debug('Added [prompt] column to [chats] table');
  } else {
    logging.debug('[prompt】 column already exists in [chats] table');
  }
  const hasInputColumn = columns.some((column: any) => column.name === 'input');
  if (!hasInputColumn) {
    database.prepare(`ALTER TABLE chats ADD COLUMN input TEXT`).run();
    logging.debug('Added [input] column to [chats] table');
  } else {
    logging.debug('[input] column already exists in [chats] table');
  }
  const hasFolderIdColumn = columns.some(
    (column: any) => column.name === 'folderId',
  );
  if (!hasFolderIdColumn) {
    database.prepare(`ALTER TABLE chats ADD COLUMN folderId TEXT`).run();
    logging.debug('Added [folderId] column to [chats] table');
  } else {
    logging.debug('[folderId] column already exists in [chats] table');
  }
  const hasProviderColumn = columns.some(
    (column: any) => column.name === 'provider',
  );
  if (!hasProviderColumn) {
    database.prepare(`ALTER TABLE chats ADD COLUMN provider TEXT`).run();
    logging.debug('Added [provider] column to [chats] table');
  } else {
    logging.debug('[provider column already exists in [chats] table');
  }
  const hasNameColumn = columns.some((column: any) => column.name === 'name');
  if (!hasNameColumn) {
    database.prepare(`ALTER TABLE chats ADD COLUMN name TEXT`).run();
    logging.debug('Added [name] column to [chats] table');
  } else {
    logging.debug('[name] column already exists in [chats] table');
  }
}

/**
 * Adds missing columns to the messages table for backward compatibility
 * Checks for and adds reasoning and structuredPrompts columns if they don't exist
 */
function alertTableMessages() {
  const columns = database.prepare(`PRAGMA table_info(messages)`).all();
  const hasReasoningColumn = columns.some(
    (column: any) => column.name === 'reasoning',
  );
  if (!hasReasoningColumn) {
    database.prepare(`ALTER TABLE messages ADD COLUMN reasoning TEXT`).run();
    logging.debug('Added [reasoning] column to  [messages] table');
  } else {
    logging.debug('[reasoning] column already exists in [Messages] table');
  }

  // 2025-08-07
  // Add 'structuredPrompts' column to 'messages' table.
  const hasStructuredPromptsColumn = columns.some(
    (column: any) => column.name === 'structuredPrompts',
  );
  if (!hasStructuredPromptsColumn) {
    database
      .prepare(`ALTER TABLE messages ADD COLUMN structuredPrompts TEXT`)
      .run();
    logging.debug('Added [structuredPrompts] column to [messages] table');
  } else {
    logging.debug(
      '[structuredPrompts] column already exists in [messages] table',
    );
  }
}

/**
 * Adds missing columns to the bookmarks table for backward compatibility
 * Checks for and adds reasoning column if it doesn't exist
 */
function alertTableBookmarks() {
  const columns = database.prepare(`PRAGMA table_info(bookmarks)`).all();
  const hasReasoningColumn = columns.some(
    (column: any) => column.name === 'reasoning',
  );
  if (!hasReasoningColumn) {
    database.prepare(`ALTER TABLE bookmarks ADD COLUMN reasoning TEXT`).run();
    logging.debug('Added [reasoning] column to [bookmarks] table');
  } else {
    logging.debug('[reasoning] column already exists in [bookmarks] table');
  }
}

/**
 * Adds missing columns to the folders table for backward compatibility
 * Checks for and adds provider column if it doesn't exist
 */
function alertTableFolders() {
  const columns = database.prepare(`PRAGMA table_info(folders)`).all();
  const hasProviderColumn = columns.some(
    (column: any) => column.name === 'provider',
  );
  if (!hasProviderColumn) {
    database.prepare(`ALTER TABLE folders ADD COLUMN provider TEXT`).run();
    logging.debug('Added [provider] column to [folders] table');
  } else {
    logging.debug('[provider] column already exists in [folders] table');
  }
}

/**
 * Database initialization transaction that creates all tables and applies schema updates
 * Runs all table creation and alteration functions in a single transaction
 */
const initDatabase = database.transaction(() => {
  logging.debug('Init database...');

  database.pragma('foreign_keys = ON');
  createTableFolders();
  createTableChats();
  createTableMessages();
  createTableBookmarks();
  createTablePrompts();
  createTableUsages();
  createTableKnowledgeCollections();
  createTableKnowledgeFiles();
  createTableChatKnowledgeRels();
  // v0.9.6
  alertTableChats();
  // v.0.9.7
  alertTableMessages();
  alertTableBookmarks();
  // v1.0.0
  alertTableFolders();

  logging.info('Database initialized.');
});

database.pragma('journal_mode = WAL'); // performance reason
initDatabase();

/**
 * IPC handler for executing SELECT queries and returning all matching rows
 * @param {Object} data - Contains sql query string and params array
 * @returns {Array} Array of matching rows or empty array on error
 */
ipcMain.handle('db-all', (event, data) => {
  const { sql, params } = data;
  logging.debug('db-all', sql, params);
  try {
    return database.prepare(sql).all(params);
  } catch (err: any) {
    logging.captureException(err);
    return [];
  }
});

/**
 * IPC handler for executing INSERT, UPDATE, or DELETE queries
 * @param {Object} data - Contains sql query string and params array
 * @returns {boolean} True if successful, false on error
 */
ipcMain.handle('db-run', (_, data) => {
  const { sql, params } = data;
  logging.debug('db-run', sql, params);
  try {
    database.prepare(sql).run(params);
    return true;
  } catch (err: any) {
    logging.captureException(err);
    return false;
  }
});

/**
 * IPC handler for executing multiple database operations in a single transaction
 * @param {Array} data - Array of objects containing sql and params for each operation
 * @returns {Promise<boolean>} Promise resolving to true if successful, false on error
 */
ipcMain.handle('db-transaction', (_, data: any[]) => {
  logging.debug('db-transaction', JSON.stringify(data, null, 2));
  const tasks: { statement: Statement; params: any[] }[] = [];
  data.forEach(({ sql, params }) => {
    tasks.push({
      statement: database.prepare(sql),
      params,
    });
  });
  return new Promise((resolve) => {
    try {
      database.transaction(() => {
        tasks.forEach(({ statement, params }) => {
          if (isOneDimensionalArray(params)) {
            statement.run(params);
          } else {
            params.forEach((param: any) => {
              statement.run(param);
            });
          }
        });
      })();
      resolve(true);
    } catch (err: any) {
      logging.captureException(err);
      resolve(false);
    }
  });
});

/**
 * IPC handler for executing SELECT queries and returning the first matching row
 * @param {Object} data - Contains sql query string and id parameter
 * @returns {Object|null} First matching row or null if not found or on error
 */
ipcMain.handle('db-get', (_, data) => {
  const { sql, id } = data;
  logging.debug('db-get', sql, id);
  try {
    return database.prepare(sql).get(id);
  } catch (err: any) {
    logging.captureException(err);
    return null;
  }
});

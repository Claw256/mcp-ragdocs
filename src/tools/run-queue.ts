import { BaseTool } from './base-tool.js';
import { ToolDefinition, McpToolResponse } from '../types.js';
import { ErrorCode, McpError } from '@modelcontextprotocol/sdk/types.js';
import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';
import { ApiClient } from '../api-client.js';
import { AddDocumentationHandler } from '../handlers/add-documentation.js';
import { Server } from '@modelcontextprotocol/sdk/server/index.js';

// Get current directory in ES modules
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const QUEUE_FILE = path.join(__dirname, '..', '..', 'queue.txt');

export class RunQueueTool extends BaseTool {
  private apiClient: ApiClient;
  private addDocHandler: AddDocumentationHandler;

  constructor(apiClient: ApiClient) {
    super();
    this.apiClient = apiClient;
    // Create a temporary server instance just for the handler
    const tempServer = new Server(
      { name: 'temp', version: '0.0.0' },
      { capabilities: { tools: {} } }
    );
    this.addDocHandler = new AddDocumentationHandler(tempServer, apiClient);
  }

  get definition(): ToolDefinition {
    return {
      name: 'run_queue',
      description: 'Process URLs from the queue one at a time until complete',
      inputSchema: {
        type: 'object',
        properties: {},
        required: [],
      },
    };
  }

  async execute(_args: any): Promise<McpToolResponse> {
    try {
      // Check if queue file exists
      try {
        await fs.access(QUEUE_FILE);
      } catch {
        return {
          content: [
            {
              type: 'text',
              text: 'Queue is empty (queue file does not exist)',
            },
          ],
        };
      }

      // Read current queue
      const content = await fs.readFile(QUEUE_FILE, 'utf-8');
      const urls = content.split('\n').filter(url => url.trim() !== '');

      if (urls.length === 0) {
        return {
          content: [
            {
              type: 'text',
              text: 'Queue is empty',
            },
          ],
        };
      }

      const currentUrl = urls[0]; // Get first URL
      
      try {
        // Process the URL using the handler
        await this.addDocHandler.handle({ url: currentUrl });
        return {
          content: [
            {
              type: 'text',
              text: `Successfully processed URL: ${currentUrl}`,
            },
          ],
        };
      } catch (error) {
        return {
          content: [
            {
              type: 'text',
              text: `Failed to process URL ${currentUrl}: ${error}`,
            },
          ],
          isError: true,
        };
      }
    } catch (error) {
      return {
        content: [
          {
            type: 'text',
            text: `Failed to process queue: ${error}`,
          },
        ],
        isError: true,
      };
    }
  }
}

import { QdrantClient } from '@qdrant/js-client-rest';
import OpenAI from 'openai';
import { chromium } from 'playwright';
import { McpError, ErrorCode } from '@modelcontextprotocol/sdk/types.js';

// Environment variables for configuration
const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
const QDRANT_URL = process.env.QDRANT_URL;
const QDRANT_API_KEY = process.env.QDRANT_API_KEY;

if (!QDRANT_URL) {
  throw new Error('QDRANT_URL environment variable is required for cloud storage');
}

if (!QDRANT_API_KEY) {
  throw new Error('QDRANT_API_KEY environment variable is required for cloud storage');
}

export class ApiClient {
  qdrantClient: QdrantClient;
  openaiClient?: OpenAI;
  browser: any;

  constructor() {
    // Initialize Qdrant client with cloud configuration
    this.qdrantClient = new QdrantClient({
      url: QDRANT_URL,
      apiKey: QDRANT_API_KEY,
    });

    // Initialize OpenAI client if API key is provided
    if (OPENAI_API_KEY) {
      this.openaiClient = new OpenAI({
        apiKey: OPENAI_API_KEY,
      });
    }
  }

  async initBrowser() {
    if (!this.browser) {
      this.browser = await chromium.launch();
    }
  }

  async cleanup() {
    if (this.browser) {
      await this.browser.close();
    }
  }

  async getEmbeddings(text: string): Promise<number[]> {
    if (!this.openaiClient) {
      throw new McpError(
        ErrorCode.InvalidRequest,
        'OpenAI API key not configured'
      );
    }

    const maxRetries = 3;
    let retries = 0;
    let lastError: any;

    while (retries < maxRetries) {
      try {
        const response = await Promise.race([
          this.openaiClient.embeddings.create({
            model: 'text-embedding-ada-002',
            input: text,
          }),
          new Promise((_, reject) =>
            setTimeout(() => reject(new Error('OpenAI embeddings request timed out')), 30000)
          ),
        ]);
        if (response instanceof Error) {
          throw response;
        }
        
        // Type check and assertion to ensure response is not an error
        if (
          response &&
          typeof response === 'object' &&
          'data' in response &&
          response.data &&
          Array.isArray(response.data) &&
          response.data.length > 0 &&
          'embedding' in response.data[0] &&
          Array.isArray(response.data[0].embedding)
        ) {
          return (response as any).data[0].embedding;
        } else {
          throw new Error('Invalid response from OpenAI embeddings API');
        }
      } catch (error) {
        lastError = error;
        retries++;
        await new Promise(resolve => setTimeout(resolve, 1000)); // Wait 1 second before retrying
      }
    }

    throw new McpError(
      ErrorCode.InternalError,
      `Failed to generate embeddings after ${maxRetries} retries: ${lastError}`
    );
  }

  async initCollection(COLLECTION_NAME: string) {
    try {
      const collections = await this.qdrantClient.getCollections();
      const exists = collections.collections.some(c => c.name === COLLECTION_NAME);

      if (!exists) {
        await this.qdrantClient.createCollection(COLLECTION_NAME, {
          vectors: {
            size: 1536, // OpenAI ada-002 embedding size
            distance: 'Cosine',
          },
          // Add optimized settings for cloud deployment
          optimizers_config: {
            default_segment_number: 2,
            memmap_threshold: 20000,
          },
          replication_factor: 2,
        });
      }
    } catch (error) {
      if (error instanceof Error) {
        if (error.message.includes('unauthorized')) {
          throw new McpError(
            ErrorCode.InvalidRequest,
            'Failed to authenticate with Qdrant cloud. Please check your API key.'
          );
        } else if (error.message.includes('ECONNREFUSED') || error.message.includes('ETIMEDOUT')) {
          throw new McpError(
            ErrorCode.InternalError,
            'Failed to connect to Qdrant cloud. Please check your QDRANT_URL.'
          );
        }
      }
      throw new McpError(
        ErrorCode.InternalError,
        `Failed to initialize Qdrant cloud collection: ${error}`
      );
    }
  }
}
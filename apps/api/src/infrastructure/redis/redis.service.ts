import {
    Injectable,
    Logger,
    OnModuleDestroy,
    OnModuleInit,
} from '@nestjs/common';
import { createClient, type RedisClientType } from 'redis';

@Injectable()
export class RedisService implements OnModuleInit, OnModuleDestroy {
    private readonly logger = new Logger(RedisService.name);
    private readonly client: RedisClientType;

    constructor() {
        const redisUrl = process.env.REDIS_URL;

        if (!redisUrl) {
            throw new Error('REDIS_URL environment variable is not defined');
        }

        this.client = createClient({
            url: redisUrl,
            socket: {
                reconnectStrategy: (retries) => {
                    const maxRetries = 3;

                    if (retries >= maxRetries) {
                        return new Error(
                            `Redis connection failed after ${maxRetries} retries`,
                        );
                    }

                    return Math.min(100 * 2 ** retries, 1000);
                },
            },
        });

        this.client.on('error', (error) => {
            this.logger.error(`Redis client error: ${error.message}`);
        });
    }

    async onModuleInit(): Promise<void> {
        try {
            await this.client.connect();
            await this.client.ping();

            this.logger.log('Redis connection established');
        } catch (error) {
            this.logger.error('Failed to establish Redis connection');
            throw error;
        }
    }

    async onModuleDestroy(): Promise<void> {
        if (this.client.isOpen) {
            await this.client.close();
        }
    }

    getClient(): RedisClientType {
        return this.client;
    }
}
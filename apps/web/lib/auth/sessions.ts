import 'server-only';
import { authConfig } from './config';
import { NestAuthenticationBackend } from './backend';
import { sessionRedis } from './redis';
import { RedisSessionStore } from './session-store';
import { WebSessions } from './session-service';

export function webSessions(): WebSessions {
    const config = authConfig();
    return new WebSessions(
        new RedisSessionStore(sessionRedis, config.prefix),
        new NestAuthenticationBackend(config.apiUrl),
        config.ttlSeconds,
    );
}

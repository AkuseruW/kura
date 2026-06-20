export function makeMailConfig(): string {
	return `import { defineConfig } from "kura/config";
import env from "#start/env";

/**
 * Mail configuration.
 *
 * Support level: starter. Connect a real transport before sending email.
 */
const mailConfig = defineConfig({
\tdefault: env.get("MAIL_MAILER", "log"),

\tmailers: {
\t\tlog: {
\t\t\tdriver: "log",
\t\t},
\t},
});

export default mailConfig;
`;
}

export function makeWelcomeMail(): string {
	return `export type WelcomeMailData = {
\treadonly name: string;
};

export class WelcomeMail {
\tconstructor(public readonly data: WelcomeMailData) {}

\tsubject(): string {
\t\treturn "Welcome to Kura";
\t}

\thtml(): string {
\t\treturn \`<p>Welcome, \${this.data.name}.</p>\`;
\t}
}
`;
}

export function makeStorageConfig(): string {
	return `import { defineConfig } from "kura/config";

/**
 * Storage configuration.
 *
 * Support level: starter. Review disks and public access before production.
 */
const storageConfig = defineConfig({
\tdefault: "local",

\tdisks: {
\t\tlocal: {
\t\t\tdriver: "local",
\t\t\troot: "storage/app",
\t\t},
\t},
});

export default storageConfig;
`;
}

export function makeStorageService(): string {
	return `import { join } from "node:path";

export class StorageService {
\tconstructor(private readonly root = "storage/app") {}

\tpath(key: string): string {
\t\treturn join(this.root, key);
\t}

\tfile(key: string): Bun.BunFile {
\t\treturn Bun.file(this.path(key));
\t}
}
`;
}

export function makeI18nConfig(): string {
	return `import { defineConfig } from "kura/config";

/**
 * i18n configuration.
 *
 * Support level: starter. Add locales and loaders as your app grows.
 */
const i18nConfig = defineConfig({
\tdefaultLocale: "en",
\tfallbackLocale: "en",
\tloaders: {
\t\tmessages: "resources/lang/{locale}/messages.ts",
\t},
});

export default i18nConfig;
`;
}

export function makeEnglishMessages(): string {
	return `export const messages = {
\twelcome: "Welcome to Kura",
} as const;
`;
}

export function makeWebSocketsConfig(): string {
	return `import { defineConfig } from "kura/config";

/**
 * WebSocket configuration.
 *
 * Support level: starter. Wire upgrades and auth before production realtime.
 */
const websocketsConfig = defineConfig({
\tenabled: true,
\tpath: "/ws",
\theartbeatInterval: 30000,
});

export default websocketsConfig;
`;
}

export function makeWebSocketService(): string {
	return `export class WebSocketService {
\tprivate readonly clients = new Set<WebSocket>();

\tadd(client: WebSocket): void {
\t\tthis.clients.add(client);
\t}

\tremove(client: WebSocket): void {
\t\tthis.clients.delete(client);
\t}

\tbroadcast(message: string): void {
\t\tfor (const client of this.clients) {
\t\t\tclient.send(message);
\t\t}
\t}
}
`;
}

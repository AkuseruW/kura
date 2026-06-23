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
	return `import { mkdir, writeFile } from "node:fs/promises";
import { dirname, isAbsolute, relative, resolve, sep } from "node:path";
import type { UploadedFile } from "kura/http";

type StorageValue = string | Uint8Array | ArrayBuffer | Blob;

export class StorageService {
\tprivate readonly rootPath: string;

\tconstructor(root = "storage/app") {
\t\tthis.rootPath = resolve(root);
\t}

\tpath(key: string): string {
\t\tconst normalizedKey = key.trim();
\t\tif (!normalizedKey) {
\t\t\tthrow new Error("Storage key cannot be empty");
\t\t}

\t\tconst path = resolve(this.rootPath, normalizedKey);
\t\tconst relativePath = relative(this.rootPath, path);
\t\tif (
\t\t\trelativePath === ".." ||
\t\t\trelativePath.startsWith(".." + sep) ||
\t\t\tisAbsolute(relativePath)
\t\t) {
\t\t\tthrow new Error("Storage key escapes storage root");
\t\t}

\t\treturn path;
\t}

\tfile(key: string): Bun.BunFile {
\t\treturn Bun.file(this.path(key));
\t}

\tasync put(key: string, value: StorageValue): Promise<string> {
\t\tconst path = this.path(key);
\t\tawait mkdir(dirname(path), { recursive: true });
\t\tawait writeFile(path, await toWritableValue(value));
\t\treturn path;
\t}

\tasync putFile(key: string, file: UploadedFile | File): Promise<string> {
\t\tconst nativeFile = file instanceof File ? file : file.toFile();
\t\treturn this.put(key, nativeFile);
\t}
}

async function toWritableValue(value: StorageValue): Promise<string | Uint8Array> {
\tif (typeof value === "string" || value instanceof Uint8Array) {
\t\treturn value;
\t}

\tif (value instanceof ArrayBuffer) {
\t\treturn new Uint8Array(value);
\t}

\treturn new Uint8Array(await value.arrayBuffer());
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

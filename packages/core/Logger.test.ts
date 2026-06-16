import { describe, expect, test } from "bun:test";
import { type LogEntry, MemoryLogWriter, StructuredLogger } from "./Logger";

describe("StructuredLogger", () => {
	test("writes structured log entries with merged context", () => {
		const writer = new MemoryLogWriter();
		const logger = new StructuredLogger({
			context: { app: "kura" },
			now: () => new Date("2026-01-01T00:00:00.000Z"),
			writer,
		});

		logger.info("app booted", { state: "ready" });

		expect(only(writer.entries)).toEqual({
			level: "info",
			message: "app booted",
			timestamp: "2026-01-01T00:00:00.000Z",
			context: { app: "kura", state: "ready" },
		});
	});

	test("respects log levels", () => {
		const writer = new MemoryLogWriter();
		const logger = new StructuredLogger({ level: "warn", writer });

		logger.debug("debug skipped");
		logger.info("info skipped");
		logger.warn("warning emitted");
		logger.error("error emitted");

		expect(writer.entries.map((entry) => entry.level)).toEqual([
			"warn",
			"error",
		]);
	});

	test("creates child loggers with inherited context", () => {
		const writer = new MemoryLogWriter();
		const logger = new StructuredLogger({
			context: { app: "kura" },
			writer,
		}).child({ requestId: "req-1" });

		logger.info("request completed", { status: 200 });

		expect(only(writer.entries).context).toEqual({
			app: "kura",
			requestId: "req-1",
			status: 200,
		});
	});
});

function only(items: readonly LogEntry[]): LogEntry {
	if (items.length !== 1 || !items[0]) {
		throw new Error(`Expected one log entry, received ${items.length}`);
	}

	return items[0];
}

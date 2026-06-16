export type LogLevel = "debug" | "info" | "warn" | "error" | "silent";
export type LogContext = Record<string, unknown>;

export type LogEntry = {
	readonly level: Exclude<LogLevel, "silent">;
	readonly message: string;
	readonly timestamp: string;
	readonly context: LogContext;
};

export type LogWriter = {
	write(entry: LogEntry): void;
};

export type StructuredLoggerOptions = {
	readonly level?: LogLevel;
	readonly context?: LogContext;
	readonly writer?: LogWriter;
	readonly now?: () => Date;
};

const priorities: Record<LogLevel, number> = {
	debug: 10,
	info: 20,
	warn: 30,
	error: 40,
	silent: Number.POSITIVE_INFINITY,
};

export class StructuredLogger {
	private readonly level: LogLevel;
	private readonly context: LogContext;
	private readonly writer: LogWriter;
	private readonly now: () => Date;

	constructor(options: StructuredLoggerOptions = {}) {
		this.level = options.level ?? "info";
		this.context = options.context ?? {};
		this.writer = options.writer ?? new ConsoleLogWriter();
		this.now = options.now ?? (() => new Date());
	}

	child(context: LogContext): StructuredLogger {
		return new StructuredLogger({
			level: this.level,
			context: { ...this.context, ...context },
			writer: this.writer,
			now: this.now,
		});
	}

	debug(message: string, context: LogContext = {}): void {
		this.write("debug", message, context);
	}

	info(message: string, context: LogContext = {}): void {
		this.write("info", message, context);
	}

	warn(message: string, context: LogContext = {}): void {
		this.write("warn", message, context);
	}

	error(message: string, context: LogContext = {}): void {
		this.write("error", message, context);
	}

	private write(
		level: Exclude<LogLevel, "silent">,
		message: string,
		context: LogContext,
	): void {
		if (priorities[level] < priorities[this.level]) {
			return;
		}

		this.writer.write({
			level,
			message,
			timestamp: this.now().toISOString(),
			context: { ...this.context, ...context },
		});
	}
}

export class ConsoleLogWriter implements LogWriter {
	write(entry: LogEntry): void {
		console.log(JSON.stringify(entry));
	}
}

export class MemoryLogWriter implements LogWriter {
	readonly entries: LogEntry[] = [];

	write(entry: LogEntry): void {
		this.entries.push(entry);
	}
}

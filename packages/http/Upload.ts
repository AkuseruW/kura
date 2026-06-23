import { mkdir, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";

export type UploadedFileMoveOptions = {
	readonly name?: string;
	readonly overwrite?: boolean;
};

export type UploadedFileOptions = {
	readonly fieldName: string;
};

export class UploadedFile {
	readonly fieldName: string;
	readonly clientName: string;
	readonly type: string;
	readonly size: number;

	constructor(
		readonly file: File,
		options: UploadedFileOptions,
	) {
		this.fieldName = options.fieldName;
		this.clientName = file.name;
		this.type = file.type;
		this.size = file.size;
	}

	get extension(): string | null {
		const extensionStart = this.clientName.lastIndexOf(".");
		if (extensionStart < 0 || extensionStart === this.clientName.length - 1) {
			return null;
		}

		return this.clientName.slice(extensionStart + 1).toLowerCase();
	}

	get lastModified(): number {
		return this.file.lastModified;
	}

	arrayBuffer(): Promise<ArrayBuffer> {
		return this.file.arrayBuffer();
	}

	stream(): ReadableStream<Uint8Array> {
		return this.file.stream();
	}

	text(): Promise<string> {
		return this.file.text();
	}

	async moveTo(
		target: string,
		options: UploadedFileMoveOptions = {},
	): Promise<string> {
		const destination = options.name
			? join(target, safeFileName(options.name))
			: target;
		const overwrite = options.overwrite ?? false;

		await mkdir(dirname(destination), { recursive: true });
		await writeFile(
			destination,
			new Uint8Array(await this.file.arrayBuffer()),
			{
				flag: overwrite ? "w" : "wx",
			},
		);

		return destination;
	}

	toFile(): File {
		return this.file;
	}
}

export function uploadedFileFromEntry(
	fieldName: string,
	entry: unknown,
): UploadedFile | null {
	return entry instanceof File ? new UploadedFile(entry, { fieldName }) : null;
}

export function uploadedFilesFromEntries(
	fieldName: string,
	entries: readonly unknown[],
): UploadedFile[] {
	return entries
		.filter((entry): entry is File => entry instanceof File)
		.map((file) => new UploadedFile(file, { fieldName }));
}

function safeFileName(name: string): string {
	const basename = name.split(/[\\/]/).at(-1)?.trim() ?? "";
	if (!basename || basename === "." || basename === "..") {
		throw new Error("Uploaded file name cannot be empty");
	}

	return basename;
}

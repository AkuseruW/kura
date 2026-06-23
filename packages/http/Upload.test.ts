import { describe, expect, test } from "bun:test";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
	UploadedFile,
	uploadedFileFromEntry,
	uploadedFilesFromEntries,
} from "./Upload";

describe("UploadedFile", () => {
	test("wraps native file metadata and reads content", async () => {
		const nativeFile = new File(["kura"], "Avatar.PNG", {
			type: "image/png",
		});
		const uploadedFile = new UploadedFile(nativeFile, { fieldName: "avatar" });

		expect(uploadedFile.file).toBe(nativeFile);
		expect(uploadedFile.fieldName).toBe("avatar");
		expect(uploadedFile.clientName).toBe("Avatar.PNG");
		expect(uploadedFile.extension).toBe("png");
		expect(uploadedFile.type).toBe("image/png");
		expect(uploadedFile.size).toBe(4);
		expect(await uploadedFile.text()).toBe("kura");
	});

	test("moves files to a destination path", async () => {
		const root = await mkdtemp(join(tmpdir(), "kura-upload-"));
		try {
			const uploadedFile = new UploadedFile(new File(["kura"], "avatar.png"), {
				fieldName: "avatar",
			});
			const destination = join(root, "avatars", "avatar.png");

			await expect(uploadedFile.moveTo(destination)).resolves.toBe(destination);
			await expect(readFile(destination, "utf8")).resolves.toBe("kura");
			await expect(uploadedFile.moveTo(destination)).rejects.toThrow();
		} finally {
			await rm(root, { force: true, recursive: true });
		}
	});

	test("moves files to a directory with a safe output name", async () => {
		const root = await mkdtemp(join(tmpdir(), "kura-upload-"));
		try {
			const uploadedFile = new UploadedFile(new File(["kura"], "avatar.png"), {
				fieldName: "avatar",
			});
			const destination = await uploadedFile.moveTo(root, {
				name: "../safe.png",
			});

			expect(destination).toBe(join(root, "safe.png"));
			await expect(readFile(destination, "utf8")).resolves.toBe("kura");
		} finally {
			await rm(root, { force: true, recursive: true });
		}
	});

	test("creates wrappers from form data entries", () => {
		const first = new File(["one"], "one.txt");
		const second = new File(["two"], "two.txt");

		expect(uploadedFileFromEntry("file", first)?.clientName).toBe("one.txt");
		expect(uploadedFileFromEntry("file", "not-a-file")).toBeNull();
		expect(
			uploadedFilesFromEntries("file", [first, "not-a-file", second]).map(
				(file) => file.clientName,
			),
		).toEqual(["one.txt", "two.txt"]);
	});
});

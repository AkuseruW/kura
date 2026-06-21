import type { NewAppChoices, NewAppDirectory, NewAppFile } from "./Types";

export function makeDatabaseMetadataFiles(
	choices: NewAppChoices,
): readonly NewAppFile[] {
	if (!usesDatabaseFiles(choices)) {
		return [];
	}

	return [
		{
			path: "database/schema.ts",
			content: `export const schema = {};
`,
		},
		{
			path: "database/schema_rules.ts",
			content: `export const schemaRules = {};
`,
		},
	];
}

export function usesDatabaseFiles(choices: NewAppChoices): boolean {
	return choices.database !== "none" || choices.auth !== "none";
}

export function makeScaffoldDirectories(
	choices: NewAppChoices,
): readonly NewAppDirectory[] {
	const directories = new Set<string>();

	if (choices.cache === "file") {
		directories.add("tmp/cache");
	}

	if (choices.preset !== "api") {
		directories.add("public");
	}

	if (choices.modules.includes("storage")) {
		directories.add("storage/app");
	}

	return makeNewAppDirectories([...directories].sort());
}

export function makeNewAppDirectories(
	paths: readonly string[],
): readonly NewAppDirectory[] {
	return paths.map((path) => ({ kind: "directory" as const, path }));
}

export function apiControllerPath(choices: NewAppChoices): string {
	return sourcePath(
		choices,
		"api",
		"api_controller.ts",
		"app/controllers",
		"http",
	);
}

export function homeControllerPath(choices: NewAppChoices): string {
	return sourcePath(
		choices,
		"web",
		"home_controller.ts",
		"app/controllers",
		"http",
	);
}

export function authControllerPath(choices: NewAppChoices): string {
	return sourcePath(
		choices,
		"auth",
		"auth_controller.ts",
		"app/controllers",
		"http",
	);
}

export function authServicePath(choices: NewAppChoices): string {
	return sourcePath(
		choices,
		"auth",
		"auth_service.ts",
		"app/services",
		"application",
	);
}

export function authValidatorPath(choices: NewAppChoices): string {
	if (choices.architecture === "domain") {
		return "app/domains/auth/application/validators.ts";
	}

	if (choices.architecture === "modular") {
		return "app/modules/auth/validators.ts";
	}

	return "app/validators/auth.ts";
}

export function authValidatorImport(choices: NewAppChoices): string {
	if (choices.architecture === "domain") {
		return "#domains/auth/application/validators";
	}

	if (choices.architecture === "modular") {
		return "#modules/auth/validators";
	}

	return "#validators/auth";
}

export function authMiddlewarePath(choices: NewAppChoices): string {
	return sourcePath(
		choices,
		"auth",
		"auth_middleware.ts",
		"app/middleware",
		"http",
	);
}

export function userModelPath(choices: NewAppChoices): string {
	if (choices.architecture === "domain") {
		return "app/domains/auth/infrastructure/persistence/user_record.ts";
	}

	return sourcePath(choices, "auth", "user.ts", "app/models");
}

export function userDomainEntityPath(): string {
	return "app/domains/auth/domain/user.ts";
}

export function userRepositoryPath(): string {
	return "app/domains/auth/domain/user_repository.ts";
}

export function registerUserUseCasePath(): string {
	return "app/domains/auth/application/register_user.ts";
}

export function sqlUserRepositoryPath(): string {
	return "app/domains/auth/infrastructure/persistence/sql_user_repository.ts";
}

export function moduleSourcePath(
	choices: NewAppChoices,
	moduleName: "mail" | "storage" | "websockets",
	fileName: string,
): string {
	if (choices.architecture === "domain") {
		return `app/domains/${moduleName}/infrastructure/${fileName}`;
	}

	if (choices.architecture === "modular") {
		return `app/modules/${moduleName}/${fileName}`;
	}

	if (moduleName === "mail") {
		return `app/mails/${fileName}`;
	}

	return `app/services/${fileName}`;
}

export function sourcePath(
	choices: NewAppChoices,
	moduleName: string,
	fileName: string,
	standardDirectory: string,
	domainLayer = "domain",
): string {
	if (choices.architecture === "domain") {
		return `app/domains/${moduleName}/${domainLayer}/${fileName}`;
	}

	if (choices.architecture === "modular") {
		return `app/modules/${moduleName}/${fileName}`;
	}

	return `${standardDirectory}/${fileName}`;
}

export function moduleImport(
	choices: NewAppChoices,
	moduleName: string,
	fileNameWithoutExtension: string,
	standardAlias: string,
	domainLayer = "domain",
): string {
	if (choices.architecture === "domain") {
		return `#domains/${moduleName}/${domainLayer}/${fileNameWithoutExtension}`;
	}

	if (choices.architecture === "modular") {
		return `#modules/${moduleName}/${fileNameWithoutExtension}`;
	}

	return standardAlias;
}

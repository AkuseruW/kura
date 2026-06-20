export function escapeRegex(value: string): string {
	return value.replace(/[.+?^${}()|[\]\\]/g, "\\$&");
}

export function normalizePath(path: string): string {
	const trimmed = path.replace(/^\/+|\/+$/g, "");
	return trimmed ? `/${trimmed}` : "";
}

export function joinPaths(prefix: string, path: string): string {
	const normalizedPrefix = normalizePath(prefix);
	const normalizedPath = normalizePath(path);
	if (!normalizedPrefix && !normalizedPath) {
		return "/";
	}
	return `${normalizedPrefix}${normalizedPath}`;
}

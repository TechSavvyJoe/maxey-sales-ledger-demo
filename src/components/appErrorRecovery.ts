const staleModulePattern = /dynamically imported module|importing a module script failed|failed to fetch.*module|loading chunk \d+ failed|chunkloaderror/i;

export function isStaleModuleError(error: unknown): boolean {
  return error instanceof Error && staleModulePattern.test(`${error.name} ${error.message}`);
}

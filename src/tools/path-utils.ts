import path from "path";

/** Resolve a tool-supplied path relative to the current agent workspace. */
export function resolveToolPath(filePath: string, workingDir: string): string {
  return path.isAbsolute(filePath)
    ? path.normalize(filePath)
    : path.resolve(workingDir, filePath);
}

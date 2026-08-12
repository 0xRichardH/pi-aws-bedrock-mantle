/** Runtime configuration shared by model discovery and inference requests. */

export const PROJECT_ID_ENV = "BEDROCK_MANTLE_PROJECT_ID";

/** Return the configured Bedrock project ID, treating blank values as unset. */
export function projectId(): string | undefined {
  const value = process.env[PROJECT_ID_ENV]?.trim();
  return value || undefined;
}

/**
 * Return the project-scoping header expected by the selected Mantle API.
 * OpenAI-compatible endpoints use OpenAI-Project; native Anthropic endpoints
 * use anthropic-workspace-id.
 */
export function projectHeaders(path: string): Record<string, string> {
  const id = projectId();
  if (!id) return {};

  return path.startsWith("/anthropic/")
    ? { "anthropic-workspace-id": id }
    : { "openai-project": id };
}

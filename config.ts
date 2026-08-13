/** Runtime configuration shared by model discovery and inference requests. */

export const PROJECT_ID_ENV = "BEDROCK_MANTLE_PROJECT_ID";
export const REGION_ENV = "BEDROCK_MANTLE_REGION";

/**
 * Return the explicitly selected Mantle region. The extension-specific value
 * wins over the standard AWS region. A region is required because project
 * availability and SigV4 signing are region-specific.
 */
export type MantleRegion = "us-east-1" | "us-east-2";

export function configuredRegion(): MantleRegion {
  const mantleRegion = process.env[REGION_ENV]?.trim();
  const awsRegion = process.env.AWS_REGION?.trim();
  const value = mantleRegion || awsRegion;
  if (!value) {
    throw new Error(
      `[bedrock-mantle] Region is required; set AWS_REGION or ${REGION_ENV}.`
    );
  }
  if (value === "us-east-1" || value === "us-east-2") return value;

  const source = mantleRegion ? REGION_ENV : "AWS_REGION";
  throw new Error(
    `[bedrock-mantle] Invalid ${source}=${JSON.stringify(value)}; expected "us-east-1" or "us-east-2".`
  );
}

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

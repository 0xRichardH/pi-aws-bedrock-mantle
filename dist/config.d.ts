/** Runtime configuration shared by model discovery and inference requests. */
export declare const PROJECT_ID_ENV = "BEDROCK_MANTLE_PROJECT_ID";
/** Return the configured Bedrock project ID, treating blank values as unset. */
export declare function projectId(): string | undefined;
/**
 * Return the project-scoping header expected by the selected Mantle API.
 * OpenAI-compatible endpoints use OpenAI-Project; native Anthropic endpoints
 * use anthropic-workspace-id.
 */
export declare function projectHeaders(path: string): Record<string, string>;

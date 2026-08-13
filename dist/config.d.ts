/** Runtime configuration shared by model discovery and inference requests. */
export declare const PROJECT_ID_ENV = "BEDROCK_MANTLE_PROJECT_ID";
export declare const REGION_ENV = "BEDROCK_MANTLE_REGION";
/**
 * Return the explicitly selected Mantle region. The extension-specific value
 * wins over the standard AWS region. A region is required because project
 * availability and SigV4 signing are region-specific.
 */
export type MantleRegion = "us-east-1" | "us-east-2";
export declare function configuredRegion(): MantleRegion;
/** Return the configured Bedrock project ID, treating blank values as unset. */
export declare function projectId(): string | undefined;
/**
 * Return the project-scoping header expected by the selected Mantle API.
 * OpenAI-compatible endpoints use OpenAI-Project; native Anthropic endpoints
 * use anthropic-workspace-id.
 */
export declare function projectHeaders(path: string): Record<string, string>;

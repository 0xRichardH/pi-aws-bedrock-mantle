/**
 * Model spec registry and live discovery for bedrock-mantle.
 *
 * Queries the configured region and assigns each model its API type. Every
 * model baseUrl uses the same per-process signing proxy port:
 *
 *   - Anthropic models: `anthropic-messages` via `/anthropic`
 *   - GPT-5.x models: `openai-responses` via `/openai/v1`
 *   - Other OpenAI-compatible models: `openai-completions` via `/v1`
 */
/** Actual bound port for the configured region's signing proxy. */
export interface ProxyConfig {
    port: number;
}
export interface PiModelConfig {
    id: string;
    name: string;
    api?: string;
    baseUrl?: string;
    reasoning: boolean;
    input: ("text" | "image")[];
    cost: {
        input: number;
        output: number;
        cacheRead: number;
        cacheWrite: number;
    };
    contextWindow: number;
    maxTokens: number;
    headers?: Record<string, string>;
    thinkingLevelMap?: Partial<Record<string, string | null>>;
}
export declare function readCachedModels(config: ProxyConfig, options?: {
    maxAgeMs?: number;
}): PiModelConfig[] | null;
export declare function writeCachedModels(models: PiModelConfig[]): void;
export declare function fastModels(config: ProxyConfig): PiModelConfig[];
export declare function discoverModels(config: ProxyConfig): Promise<PiModelConfig[]>;
export declare function fetchModels(config: ProxyConfig): Promise<PiModelConfig[]>;
/**
 * Curated fallback list with a port placeholder. Use `fastModels`
 * to substitute the actual bound port before passing to pi.
 */
export declare const FALLBACK_MODELS_RAW: PiModelConfig[];
/**
 * @deprecated Use `fastModels(config)`.
 * Retained as the placeholder list for callers that don't have a port yet.
 */
export declare const FALLBACK_MODELS: PiModelConfig[];

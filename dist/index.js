/**
 * pi-bedrock-mantle
 *
 * Pi extension: all bedrock-mantle models — GPT-5.x, Anthropic Claude, DeepSeek,
 * Qwen3, Mistral, Kimi, and more — via SigV4 auth. No long-term API key needed.
 *
 * Each pi process binds its own ephemeral-port loopback proxy by default
 * (override with BEDROCK_MANTLE_PROXY_PORT if you need a stable URL).
 * BEDROCK_MANTLE_REGION, then AWS_REGION, selects the regional endpoint.
 *
 * Anthropic models use pi's anthropic-messages driver, GPT-5.x uses pi's
 * openai-responses driver, and GPT OSS / other OpenAI-compatible models use
 * openai-completions. Per-model baseUrl overrides route each model to the
 * right proxy automatically.
 */
import { discoverModels, fastModels, writeCachedModels, } from "./models.js";
import { createSigningProxy, PROXY_PORT, } from "./proxy.js";
import { log } from "./log.js";
import { configuredRegion, projectId } from "./config.js";
/** Bind the configured region's single signing proxy. */
async function startProxy() {
    const region = configuredRegion();
    const proxy = await createSigningProxy(region, PROXY_PORT);
    return { proxy, config: { port: proxy.port } };
}
function registerBedrockMantleProvider(pi, models, config) {
    pi.registerProvider("bedrock-mantle", {
        name: "Bedrock Mantle",
        baseUrl: `http://127.0.0.1:${config.port}/v1`,
        api: "openai-completions",
        // apiKey required by pi's schema; unused — SigV4 auth is handled by the proxies.
        apiKey: "sigv4-via-proxy",
        authHeader: false,
        models,
    });
}
export default async function bedrockMantleExtension(pi) {
    const profile = process.env.BEDROCK_MANTLE_AWS_PROFILE;
    // Bind the proxy first so cache-derived baseUrls reference its actual port.
    let setup;
    try {
        setup = await startProxy();
    }
    catch (err) {
        log.error("startup_failed", { error: err });
        return;
    }
    log.info("ready", {
        port: setup.proxy.port,
        profile: profile ?? "default-credential-chain",
        project_id: projectId() ?? "default",
        region: configuredRegion(),
    });
    // Register from the cache/fallback synchronously so the model list is
    // available immediately. Live discovery runs in the background.
    registerBedrockMantleProvider(pi, fastModels(setup.config), setup.config);
    void (async () => {
        try {
            const models = await discoverModels(setup.config);
            registerBedrockMantleProvider(pi, models, setup.config);
            try {
                writeCachedModels(models);
            }
            catch (err) {
                log.warn("cache_write_failed", { error: err });
            }
            log.info("discovery_refreshed", { models: models.length });
        }
        catch (err) {
            log.warn("discovery_failed", { error: err, fallback: "cached_or_curated" });
        }
    })();
}

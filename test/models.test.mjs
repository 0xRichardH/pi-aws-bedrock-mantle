import assert from "node:assert/strict";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { test } from "node:test";

import {
  FALLBACK_MODELS_RAW,
  fastModels,
  fetchModels,
  writeCachedModels,
} from "../.tmp-test/models.js";
import { setLogLevel } from "../.tmp-test/log.js";

// Test proxy port — fixed so URL assertions are stable; nothing actually binds in
// these unit tests since fetch is mocked or model construction is pure.
const TEST_PROXY = { port: 57891 };

function fallbackById(id) {
  // FALLBACK_MODELS_RAW carries placeholder baseUrls. For the routing-only
  // assertions in these tests, we apply TEST_PROXY to materialize URLs.
  const raw = FALLBACK_MODELS_RAW.find((candidate) => candidate.id === id);
  assert.ok(raw, `expected fallback model ${id}`);
  if (!raw.baseUrl) return raw;
  return {
    ...raw,
    baseUrl: raw.baseUrl
      .replace("{{PROXY_PORT}}", String(TEST_PROXY.port)),
  };
}

function withFakeAwsCredentials() {
  process.env.AWS_ACCESS_KEY_ID = "test-access-key";
  process.env.AWS_SECRET_ACCESS_KEY = "test-secret-key";
  process.env.AWS_SESSION_TOKEN = "test-session-token";
  process.env.BEDROCK_MANTLE_MODEL_CACHE = ".tmp-test/model-cache.json";
  rmSync(process.env.BEDROCK_MANTLE_MODEL_CACHE, { force: true });
  delete process.env.AWS_PROFILE;
  delete process.env.BEDROCK_MANTLE_AWS_PROFILE;
  delete process.env.BEDROCK_MANTLE_PROJECT_ID;
  process.env.AWS_REGION = "us-east-1";
  delete process.env.BEDROCK_MANTLE_REGION;
  // Reset port pins so the cache key is consistent across tests.
  delete process.env.BEDROCK_MANTLE_PROXY_PORT;
}

async function withMockedFetch(resolver, fn) {
  withFakeAwsCredentials();
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (url, init) => resolver(String(url), init);
  try {
    return await fn();
  } finally {
    globalThis.fetch = originalFetch;
  }
}

async function withMutedWarnings(fn) {
  const warn = console.warn;
  console.warn = () => {};
  // Our logger bypasses console.warn (writes directly to process.stderr) so
  // mute it explicitly too.
  setLogLevel("silent");
  try {
    return await fn();
  } finally {
    console.warn = warn;
    setLogLevel("info");
  }
}

test("GPT-5 models route through OpenAI Responses with image input and GPT-5 thinking map", () => {
  for (const id of [
    "openai.gpt-5.5",
    "openai.gpt-5.5-2026-04-23",
    "openai.gpt-5.4",
    "openai.gpt-5.6-luna",
    "openai.gpt-5.6-sol",
    "openai.gpt-5.6-terra",
  ]) {
    const model = fallbackById(id);
    assert.equal(model.api, "openai-responses");
    assert.match(model.baseUrl ?? "", /^http:\/\/127\.0\.0\.1:\d+\/openai\/v1$/);
    assert.deepEqual(model.input, ["text", "image"]);
    assert.equal(model.reasoning, true);
    assert.deepEqual(model.thinkingLevelMap, { off: null, xhigh: "xhigh" });
    assert.equal(model.contextWindow, id.includes("gpt-5.6-") ? 1000000 : 272000);
    assert.equal(model.maxTokens, 128000);
  }
});

test("GPT-6 Sol, Luna, and Astra use Responses with their published specs", () => {
  for (const id of ["openai.gpt-6-sol", "openai.gpt-6-luna", "openai.gpt-6-astra"]) {
    const model = fallbackById(id);
    assert.equal(model.api, "openai-responses");
    assert.equal(model.baseUrl, `http://127.0.0.1:${TEST_PROXY.port}/openai/v1`);
    assert.deepEqual(model.input, ["text", "image"]);
    assert.equal(model.reasoning, true);
    assert.deepEqual(model.thinkingLevelMap, { off: null, xhigh: "xhigh" });
    assert.equal(model.contextWindow, 1_050_000);
    assert.equal(model.maxTokens, 128_000);
  }
});

test("GPT OSS models route through OpenAI Chat Completions without image input", () => {
  for (const id of ["openai.gpt-oss-120b", "openai.gpt-oss-20b"]) {
    const model = fallbackById(id);
    assert.equal(model.api, "openai-completions");
    assert.match(model.baseUrl ?? "", /^http:\/\/127\.0\.0\.1:\d+\/v1$/);
    assert.deepEqual(model.input, ["text"]);
    assert.equal(model.reasoning, false);
    assert.equal(model.thinkingLevelMap, undefined);
  }
});

test("Anthropic models use Anthropic Messages with the required version header", () => {
  const model = fallbackById("anthropic.claude-opus-4-7");

  assert.equal(model.api, "anthropic-messages");
  assert.match(model.baseUrl ?? "", /^http:\/\/127\.0\.0\.1:\d+\/anthropic$/);
  assert.deepEqual(model.headers, { "anthropic-version": "2023-06-01" });
  assert.deepEqual(model.input, ["text", "image"]);
  assert.equal(model.contextWindow, 1_000_000);
});

test("AWS_REGION routes discovery and every model family through one region", async () => {
  const requestedUrls = [];
  await withMockedFetch((url) => {
    requestedUrls.push(url);
    return new Response(JSON.stringify({ data: [
      { id: "openai.gpt-5.5" },
      { id: "anthropic.claude-opus-4-7" },
    ] }), { status: 200, headers: { "content-type": "application/json" } });
  }, async () => {
    process.env.AWS_REGION = "us-east-1";
    const models = await fetchModels(TEST_PROXY);
    assert.deepEqual(requestedUrls, ["https://bedrock-mantle.us-east-1.api.aws/v1/models"]);
    assert.match(models.find((model) => model.id === "openai.gpt-5.5")?.baseUrl ?? "", new RegExp(`:${TEST_PROXY.port}/openai/v1$`));
    assert.match(models.find((model) => model.id === "anthropic.claude-opus-4-7")?.baseUrl ?? "", new RegExp(`:${TEST_PROXY.port}/anthropic$`));
  });
});

test("BEDROCK_MANTLE_REGION overrides AWS_REGION for discovery and routing", async () => {
  const requestedUrls = [];
  await withMockedFetch((url) => {
    requestedUrls.push(url);
    return new Response(JSON.stringify({ data: [{ id: "openai.gpt-5.5" }] }), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  }, async () => {
    process.env.AWS_REGION = "us-east-2";
    process.env.BEDROCK_MANTLE_REGION = "us-east-1";
    const models = await fetchModels(TEST_PROXY);
    assert.deepEqual(requestedUrls, ["https://bedrock-mantle.us-east-1.api.aws/v1/models"]);
    assert.match(models[0]?.baseUrl ?? "", new RegExp(`:${TEST_PROXY.port}/openai/v1$`));
  });
});

test("only the OpenAI GPT-5 and GPT-6 families use Responses routing", () => {
  assert.equal(fallbackById("openai.gpt-5.5").api, "openai-responses");
  assert.equal(fallbackById("openai.gpt-5.5-2026-04-23").api, "openai-responses");
  assert.equal(fallbackById("openai.gpt-6-astra").api, "openai-responses");
  assert.equal(fallbackById("openai.gpt-oss-120b").api, "openai-completions");
  assert.equal(fallbackById("qwen.qwen3-vl-235b-a22b-instruct").api, "openai-completions");
});

test("unknown model inference keeps vision and reasoning heuristics explicit", async () => {
  await withMockedFetch(() => {
    return new Response(JSON.stringify({ data: [
      { id: "qwen.future-vl-model" },
      { id: "moonshotai.future-thinking" },
      { id: "openai.gpt-5.6" },
      { id: "openai.gpt-6-future" },
    ] }), { status: 200, headers: { "content-type": "application/json" } });
  }, async () => {
    const models = await fetchModels(TEST_PROXY);
    assert.deepEqual(models.find((model) => model.id === "qwen.future-vl-model")?.input, ["text", "image"]);
    assert.equal(models.find((model) => model.id === "moonshotai.future-thinking")?.reasoning, true);
    assert.deepEqual(models.find((model) => model.id === "openai.gpt-5.6")?.thinkingLevelMap, { off: null, xhigh: "xhigh" });
    const future = models.find((model) => model.id === "openai.gpt-6-future");
    assert.equal(future?.api, "openai-responses");
    assert.equal(future?.reasoning, true);
    assert.deepEqual(future?.input, ["text", "image"]);
    assert.deepEqual(future?.thinkingLevelMap, { off: null, xhigh: "xhigh" });
  });
});

test("GPT-6 Astra is discovered and routed through us-west-2", async () => {
  await withMockedFetch((url) => {
    assert.equal(url, "https://bedrock-mantle.us-west-2.api.aws/v1/models");
    return new Response(JSON.stringify({ data: [{ id: "openai.gpt-6-astra" }] }), {
      status: 200, headers: { "content-type": "application/json" },
    });
  }, async () => {
    process.env.BEDROCK_MANTLE_REGION = "us-west-2";
    const models = await fetchModels(TEST_PROXY);
    assert.equal(models[0]?.id, "openai.gpt-6-astra");
    assert.equal(models[0]?.api, "openai-responses");
    assert.equal(models[0]?.baseUrl, `http://127.0.0.1:${TEST_PROXY.port}/openai/v1`);
    assert.equal(models[0]?.contextWindow, 1_050_000);
  });
});

test("model discovery sends and signs the configured project ID", async () => {
  process.env.BEDROCK_MANTLE_PROJECT_ID = "proj_stbnz3nemrsrofpgdzq6";
  const capturedHeaders = [];

  await withMockedFetch((_url, init) => {
    capturedHeaders.push(init?.headers);
    return new Response(JSON.stringify({ data: [{ id: "openai.gpt-oss-120b" }] }), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  }, async () => {
    // withMockedFetch resets env, so set project scoping inside its callback.
    process.env.BEDROCK_MANTLE_PROJECT_ID = "proj_stbnz3nemrsrofpgdzq6";
    await fetchModels(TEST_PROXY);
  });

  assert.equal(capturedHeaders.length, 1);
  for (const headers of capturedHeaders) {
    assert.equal(headers?.["openai-project"], "proj_stbnz3nemrsrofpgdzq6");
    assert.match(headers?.authorization ?? "", /SignedHeaders=.*openai-project/);
  }
  delete process.env.BEDROCK_MANTLE_PROJECT_ID;
});

test("fetchModels uses only the configured region", async () => {
  await withMockedFetch((url) => {
    assert.match(url, /bedrock-mantle\.us-east-2\.api\.aws\/v1\/models$/);
    return new Response(JSON.stringify({ data: [
      { id: "openai.gpt-5.5" },
      { id: "openai.gpt-oss-120b" },
    ] }), { status: 200, headers: { "content-type": "application/json" } });
  }, async () => {
    process.env.AWS_REGION = "us-east-2";
    const models = await fetchModels(TEST_PROXY);
    assert.deepEqual(models.map((model) => model.id).sort(), ["openai.gpt-5.5", "openai.gpt-oss-120b"]);
    assert.equal(models.find((model) => model.id === "openai.gpt-5.5")?.api, "openai-responses");
    assert.equal(models.find((model) => model.id === "openai.gpt-oss-120b")?.api, "openai-completions");
  });
});

test("fetchModels honors BEDROCK_MANTLE_AWS_PROFILE instead of AWS_PROFILE", async () => {
  mkdirSync(".tmp-test", { recursive: true });
  writeFileSync(".tmp-test/aws-credentials", [
    "[mantle-test]",
    "aws_access_key_id = profile-access-key",
    "aws_secret_access_key = profile-secret-key",
    "aws_session_token = profile-session-token",
    "",
  ].join("\n"));

  delete process.env.AWS_ACCESS_KEY_ID;
  delete process.env.AWS_SECRET_ACCESS_KEY;
  delete process.env.AWS_SESSION_TOKEN;
  process.env.AWS_SHARED_CREDENTIALS_FILE = ".tmp-test/aws-credentials";
  process.env.BEDROCK_MANTLE_AWS_PROFILE = "mantle-test";
  process.env.BEDROCK_MANTLE_MODEL_CACHE = ".tmp-test/model-cache-profile.json";
  rmSync(process.env.BEDROCK_MANTLE_MODEL_CACHE, { force: true });
  process.env.AWS_PROFILE = "missing-profile-that-should-be-ignored";

  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => new Response(JSON.stringify({ data: [{ id: "openai.gpt-oss-120b" }] }), {
    status: 200,
    headers: { "content-type": "application/json" },
  });

  try {
    const models = await fetchModels(TEST_PROXY);
    assert.deepEqual(models.map((model) => model.id), ["openai.gpt-oss-120b"]);
  } finally {
    globalThis.fetch = originalFetch;
    delete process.env.AWS_SHARED_CREDENTIALS_FILE;
    delete process.env.BEDROCK_MANTLE_AWS_PROFILE;
    delete process.env.BEDROCK_MANTLE_MODEL_CACHE;
    delete process.env.AWS_PROFILE;
  }
});

test("fetchModels falls back to curated models when all regional discovery fails", async () => {
  await withMockedFetch(() => new Response("nope", { status: 503 }), async () => {
    const models = await withMutedWarnings(() => fetchModels(TEST_PROXY));
    assert.deepEqual(
      models.map((model) => model.id).sort(),
      FALLBACK_MODELS_RAW.map((model) => model.id).sort(),
    );
  });
});

test("fastModels uses cached live discovery without performing network discovery", () => {
  withFakeAwsCredentials();
  const cached = [{
    ...FALLBACK_MODELS_RAW.find((model) => model.id === "openai.gpt-oss-20b"),
  }];
  assert.ok(cached[0]);
  writeCachedModels(cached);

  const models = fastModels(TEST_PROXY);
  assert.deepEqual(models.map((model) => model.id), ["openai.gpt-oss-20b"]);
  // Cached baseUrl should have been rehydrated with TEST_PROXY.port.
  assert.match(models[0].baseUrl ?? "", new RegExp(`:${TEST_PROXY.port}/`));
});

test("fastModels rejects caches written for a different region", () => {
  withFakeAwsCredentials();
  process.env.AWS_REGION = "us-east-1";
  const cached = [{
    ...FALLBACK_MODELS_RAW.find((model) => model.id === "openai.gpt-oss-20b"),
    baseUrl: `http://127.0.0.1:${TEST_PROXY.port}/v1`,
  }];
  writeCachedModels(cached);

  process.env.AWS_REGION = "us-east-2";
  const models = fastModels(TEST_PROXY);
  assert.deepEqual(
    models.map((model) => model.id).sort(),
    FALLBACK_MODELS_RAW.map((model) => model.id).sort(),
  );
});

test("fastModels rejects caches written under a different port pin", () => {
  withFakeAwsCredentials();
  // Write a cache that claims it was generated with a different pinned port.
  writeFileSync(process.env.BEDROCK_MANTLE_MODEL_CACHE, JSON.stringify({
    version: 4,
    generatedAt: Date.now(),
    projectId: null,
    region: "us-east-1",
    proxyPort: 99999,
    models: [FALLBACK_MODELS_RAW.find((model) => model.id === "openai.gpt-oss-20b")],
  }));

  // Default port pin is 0, so cache should be rejected and we should fall
  // back to the curated list.
  const models = fastModels(TEST_PROXY);
  assert.deepEqual(
    models.map((model) => model.id).sort(),
    FALLBACK_MODELS_RAW.map((model) => model.id).sort(),
  );
});

test("fastModels rejects caches with a stale schema version", () => {
  withFakeAwsCredentials();
  writeFileSync(process.env.BEDROCK_MANTLE_MODEL_CACHE, JSON.stringify({
    version: 1,
    generatedAt: Date.now(),
    proxyPort: 0,
    models: [FALLBACK_MODELS_RAW.find((model) => model.id === "openai.gpt-oss-20b")],
  }));

  const models = fastModels(TEST_PROXY);
  assert.deepEqual(
    models.map((model) => model.id).sort(),
    FALLBACK_MODELS_RAW.map((model) => model.id).sort(),
  );
});

test("writeCachedModels strips bound ports so the cache survives ephemeral restarts", () => {
  withFakeAwsCredentials();
  // Simulate live discovery output: real bound ports baked into baseUrls.
  const live = [{
    ...FALLBACK_MODELS_RAW.find((model) => model.id === "openai.gpt-oss-20b"),
    baseUrl: "http://127.0.0.1:54321/v1",
  }];
  writeCachedModels(live);

  // Re-read with a different port — should rehydrate to it, not 54321.
  const models = fastModels({ port: 11111 });
  assert.equal(models.length, 1);
  assert.equal(models[0].baseUrl, "http://127.0.0.1:11111/v1");
});

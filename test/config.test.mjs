import assert from "node:assert/strict";
import { afterEach, test } from "node:test";

import { configuredRegion } from "../.tmp-test/config.js";

const savedAwsRegion = process.env.AWS_REGION;
const savedMantleRegion = process.env.BEDROCK_MANTLE_REGION;

afterEach(() => {
  if (savedAwsRegion === undefined) delete process.env.AWS_REGION;
  else process.env.AWS_REGION = savedAwsRegion;
  if (savedMantleRegion === undefined) delete process.env.BEDROCK_MANTLE_REGION;
  else process.env.BEDROCK_MANTLE_REGION = savedMantleRegion;
});

test("configuredRegion defaults to AWS_REGION", () => {
  process.env.AWS_REGION = "us-east-1";
  delete process.env.BEDROCK_MANTLE_REGION;
  assert.equal(configuredRegion(), "us-east-1");
});

test("BEDROCK_MANTLE_REGION overrides AWS_REGION", () => {
  process.env.AWS_REGION = "us-east-2";
  process.env.BEDROCK_MANTLE_REGION = "us-east-1";
  assert.equal(configuredRegion(), "us-east-1");
});

test("blank BEDROCK_MANTLE_REGION falls back to AWS_REGION", () => {
  process.env.AWS_REGION = "us-east-2";
  process.env.BEDROCK_MANTLE_REGION = "   ";
  assert.equal(configuredRegion(), "us-east-2");
});

test("us-west-2 is supported for GPT-6 Astra", () => {
  process.env.AWS_REGION = "us-west-2";
  delete process.env.BEDROCK_MANTLE_REGION;
  assert.equal(configuredRegion(), "us-west-2");
});

test("a region is required", () => {
  delete process.env.AWS_REGION;
  delete process.env.BEDROCK_MANTLE_REGION;
  assert.throws(() => configuredRegion(), /Region is required; set AWS_REGION or BEDROCK_MANTLE_REGION/);
});

test("unsupported regions fail with a clear configuration error", () => {
  process.env.AWS_REGION = "eu-west-1";
  delete process.env.BEDROCK_MANTLE_REGION;
  assert.throws(() => configuredRegion(), /Invalid AWS_REGION=.*expected "us-east-1", "us-east-2", or "us-west-2"/);
});

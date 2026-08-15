import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("release workflow reacts to package version changes and creates all release artifacts", async () => {
  const workflow = await readFile(".github/workflows/publish.yml", "utf8");

  assert.match(workflow, /branches:\s*\n\s+-\s+main/);
  assert.match(workflow, /paths:\s*\n\s+-\s+package\.json/);
  assert.match(workflow, /npm run check/);
  assert.match(workflow, /npm test/);
  assert.match(workflow, /npm run build/);
  assert.match(workflow, /git tag -a "\$TAG"/);
  assert.match(workflow, /npm publish --access public --provenance/);
  assert.match(workflow, /gh release create "\$TAG"/);
  assert.match(workflow, /--generate-notes/);
  assert.match(workflow, /npmjs\.com\/package\/pi-aws-bedrock-mantle\/v\/\$\{VERSION\}/);
});

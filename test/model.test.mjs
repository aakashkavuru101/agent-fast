import assert from "node:assert/strict";
import { createServer } from "node:http";
import { after, before, describe, it } from "node:test";
import { ModelClient, toolDefinitions } from "../dist/model.js";

let server;
let endpoint;
let requests = [];

before(async () => {
  server = createServer((request, response) => {
    let body = "";
    request.on("data", (chunk) => body += chunk);
    request.on("end", () => {
      requests.push(JSON.parse(body));
      response.setHeader("content-type", "application/json");
      response.end(JSON.stringify({
        choices: [{
          message: {
            role: "assistant",
            content: null,
            tool_calls: [
              { id: "one", type: "function", function: { name: "get_state", arguments: "{}" } },
              { id: "two", type: "function", function: { name: "done", arguments: JSON.stringify({ answer: "done", result: { title: "Example Domain" } }) } },
            ],
          },
        }],
      }));
    });
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  endpoint = `http://127.0.0.1:${server.address().port}/v1/chat/completions`;
});

after(async () => {
  await new Promise((resolve) => server.close(resolve));
});

describe("model protocol", () => {
  it("publishes AI navigation, semantic, auth, and schema tools", () => {
    const schema = { type: "object", properties: { title: { type: "string" } }, required: ["title"] };
    const definitions = toolDefinitions(true, schema);
    const names = definitions.map((definition) => definition.function.name);
    for (const name of ["read", "tab_new", "tab_switch", "click_text", "fill_label", "auth_login", "done"]) {
      assert.ok(names.includes(name));
    }
    const done = definitions.find((definition) => definition.function.name === "done");
    assert.deepEqual(done.function.parameters.required, ["answer", "result"]);
    assert.equal(done.function.parameters.properties.result, schema);
  });

  it("enables parallel calls and parses multiple ordered tool calls", async () => {
    requests = [];
    const client = new ModelClient({ model: "test", endpoint, timeoutMs: 5000 });
    const result = await client.complete([], true);
    assert.equal(requests[0].parallel_tool_calls, true);
    assert.equal(result.calls.length, 2);
    assert.equal(result.calls[0].name, "get_state");
    assert.equal(result.calls[1].args.result.title, "Example Domain");
  });
});

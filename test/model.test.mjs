import assert from "node:assert/strict";
import { createServer } from "node:http";
import { after, before, describe, it } from "node:test";
import { ModelClient, toolDefinitions } from "../dist/model.js";

let server;
let endpoint;
let requests = [];
let anthropic;
let anthropicRequests = [];

before(async () => {
  server = createServer((request, response) => {
    let body = "";
    request.on("data", (chunk) => body += chunk);
    request.on("end", () => {
      requests.push(JSON.parse(body));
      response.setHeader("content-type", "application/json");
      // A text-only model turns a picture away.
      if (request.url.includes("text-only") && body.includes("image_url")) { response.statusCode = 400; response.end("{}"); return; }
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
  anthropic = createServer((request, response) => {
    let body = "";
    request.on("data", (chunk) => body += chunk);
    request.on("end", () => {
      anthropicRequests.push({ path: request.url, headers: request.headers, body: JSON.parse(body) });
      response.setHeader("content-type", "application/json");
      response.end(JSON.stringify({
        id: "msg", type: "message", role: "assistant", model: "claude-test", stop_reason: "tool_use", stop_details: null,
        content: [{ type: "text", text: "Looking." }, { type: "tool_use", id: "toolu_1", name: "get_state", input: {} }],
        usage: { input_tokens: 1, output_tokens: 1 },
      }));
    });
  });
  await new Promise((resolve) => anthropic.listen(0, "127.0.0.1", resolve));
});

after(async () => {
  await new Promise((resolve) => server.close(resolve));
  await new Promise((resolve) => anthropic.close(resolve));
});

const history = [
  { role: "system", content: "Be brief." },
  { role: "user", content: "Open the page." },
  { role: "assistant", content: null, tool_calls: [{ id: "c1", type: "function", function: { name: "screenshot", arguments: "{}" } }] },
  { role: "tool", tool_call_id: "c1", content: "{\"path\":\"shot.png\"}", images: ["aGk="] },
];

describe("model protocol", () => {
  it("publishes AI navigation, semantic, auth, and schema tools", () => {
    const schema = { type: "object", properties: { title: { type: "string" } }, required: ["title"] };
    const lean = toolDefinitions(true, schema).map((definition) => definition.function.name);
    assert.ok(lean.includes("click") && lean.includes("handoff") && !lean.includes("tab_new") && !lean.includes("console"), lean.join(","));
    const definitions = toolDefinitions(true, schema, true);
    const names = definitions.map((definition) => definition.function.name);
    for (const name of ["read", "tab_new", "tab_switch", "click_text", "fill_label", "auth_login", "hover", "drag", "type", "check", "dialog", "screenshot", "console", "network", "upload", "download", "done"]) {
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

  it("sends a tool result's image as the next user message on chat completions", async () => {
    requests = [];
    await new ModelClient({ model: "test", endpoint, timeoutMs: 5000 }).complete(history, true);
    const sent = requests[0].messages;
    assert.equal(sent.length, 5);
    assert.equal(sent[3].images, undefined);
    assert.deepEqual(sent[4], { role: "user", content: [{ type: "image_url", image_url: { url: "data:image/png;base64,aGk=" } }] });
  });

  it("resends without images when a text-only model rejects them", async () => {
    requests = [];
    const reply = await new ModelClient({ model: "test", endpoint: endpoint.replace("/v1/", "/text-only/v1/"), timeoutMs: 5000 }).complete(history, true);
    assert.equal(requests.length, 2);
    assert.equal(requests[1].messages.length, 4);
    assert.equal(reply.calls.length, 2);
  });

  it("keeps a claude model on a chat-completions URL off the Messages API", async () => {
    requests = [];
    await new ModelClient({ model: "claude-test", endpoint, timeoutMs: 5000 }).complete(history, true);
    assert.equal(requests.length, 1);
    assert.equal(requests[0].model, "claude-test");
  });

  it("speaks the Messages API for claude models, images inside the tool result", async () => {
    anthropicRequests = [];
    const client = new ModelClient({ model: "claude-test", endpoint: `http://127.0.0.1:${anthropic.address().port}`, apiKey: "k", timeoutMs: 5000 });
    const result = await client.complete(history, true);
    const [{ path, headers, body }] = anthropicRequests;
    assert.equal(path, "/v1/messages");
    assert.match(headers["x-api-key"] ?? headers.authorization, /k$/);
    assert.equal(body.system, "Be brief.");
    assert.equal(body.tools[0].input_schema.type, "object");
    assert.deepEqual(body.messages[1].content[0], { type: "tool_use", id: "c1", name: "screenshot", input: {} });
    assert.equal(body.messages[2].content[0].type, "tool_result");
    assert.equal(body.messages[2].content[0].content[1].source.data, "aGk=");
    assert.equal(result.content, "Looking.");
    assert.deepEqual(result.calls, [{ id: "toolu_1", name: "get_state", args: {} }]);
    assert.equal(result.blocks.length, 2);
  });
});

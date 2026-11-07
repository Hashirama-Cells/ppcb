// Runs ClaudeAgent through the real Anthropic SDK against a local fake API server,
// so the exact HTTP requests the app will send are checked without a real key.
import test from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import path from "node:path";
import Anthropic from "@anthropic-ai/sdk";
import { Store } from "../src/store.js";
import { ClaudeAgent } from "../src/agent.js";
import { LeadService } from "../src/leads.js";
import { loadBusiness, ROOT } from "../src/config.js";

const business = loadBusiness(path.join(ROOT, "config", "businesses", "summit-plumbing.json"));
const now = () => new Date("2026-11-09T16:30:00Z");

const message = (content, stop_reason) => ({
  id: `msg_${Math.random().toString(36).slice(2)}`,
  type: "message",
  role: "assistant",
  model: "claude-opus-5-5",
  content,
  stop_reason,
  stop_sequence: null,
  usage: { input_tokens: 10, output_tokens: 5 },
});

test("real SDK: request shape, tool loop and booking", async () => {
  const requests = [];
  const replies = [
    message([{ type: "tool_use", id: "toolu_1", name: "get_available_slots", input: {} }], "tool_use"),
    message([{ type: "tool_use", id: "toolu_2", name: "book_appointment", input: { slot: "2026-11-09 12:00", service: "Leak repair", notes: "under sink" } }], "tool_use"),
    message([{ type: "text", text: "You're booked for Monday at noon." }], "end_turn"),
  ];
  const server = http.createServer(async (req, res) => {
    let body = "";
    for await (const c of req) body += c;
    requests.push({ url: req.url, headers: req.headers, body: JSON.parse(body) });
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify(replies[requests.length - 1]));
  }).listen(0);
  try {
    const client = new Anthropic({ apiKey: "test-key", baseURL: `http://127.0.0.1:${server.address().port}`, maxRetries: 0 });
    const service = new LeadService({ store: new Store(null).forBusiness(business.id), business, agent: new ClaudeAgent({ client }), now, smsEnabled: false });
    const { lead, reply } = await service.intake({ name: "Kim", phone: "5550100011", service: "Leak repair" });

    assert.equal(reply, "You're booked for Monday at noon.");
    assert.equal(lead.status, "booked");
    assert.equal(requests.length, 3);

    const first = requests[0];
    assert.match(first.url, /^\/v1\/messages/);
    assert.ok(first.headers.authorization === "Bearer test-key" || first.headers["x-api-key"] === "test-key", "API key is sent");
    assert.match(first.headers["anthropic-beta"], /server-side-fallback-2026-07-01/);
    assert.equal(first.body.model, "claude-opus-5-5");
    assert.equal(first.body.fallbacks, "default");
    assert.deepEqual(first.body.output_config, { effort: "low" });
    assert.equal(first.body.betas, undefined, "betas must go in the header, not the body");
    assert.equal(first.body.thinking, undefined);
    assert.equal(first.body.tool_choice, undefined);
    assert.deepEqual(first.body.tools.map((t) => t.name), ["get_available_slots", "book_appointment", "update_lead_status"]);
    assert.ok(first.body.tools.every((t) => t.strict === true && t.input_schema.additionalProperties === false));
    assert.equal(first.body.system[0].cache_control.type, "ephemeral");
    assert.match(first.body.messages[0].content, /^\[Form submission\]/);

    // Second request carries the assistant turn and a tool_result for it.
    const second = requests[1].body.messages;
    assert.equal(second[1].role, "assistant");
    assert.equal(second[2].content[0].type, "tool_result");
    assert.equal(second[2].content[0].tool_use_id, "toolu_1");
    assert.match(second[2].content[0].content, /2026-11-09 12:00/);
    // History is saved on the lead so the next text continues the conversation.
    assert.equal(lead.apiMessages.length, 6);
  } finally {
    server.close();
  }
});

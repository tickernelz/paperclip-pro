import test from "node:test";
import assert from "node:assert/strict";
import { loadShared } from "./test-ext.mjs";

const { headers } = loadShared(["lib/headers.js"]).LB;

test("webRequest header arrays become a lowercase record", () => {
  const record = headers.normalize([
    { name: "Content-Type", value: "text/html" },
    { name: "Set-Cookie", value: "a=1" },
    { name: "set-cookie", value: "b=2" },
    { name: "Accept", value: "a" },
    { name: "accept", value: "b" },
    { name: "X-Binary", binaryValue: [104, 105] },
  ]);
  assert.deepEqual({ ...record }, { "content-type": "text/html", "set-cookie": "a=1\nb=2", accept: "a, b", "x-binary": "hi" });
});

test("CDP objects and Headers-like inputs are normalised", () => {
  assert.deepEqual({ ...headers.normalize({ Cookie: "sid=1", "X-List": ["a", "b"] }) }, { cookie: "sid=1", "x-list": "a, b" });
  const like = new Map([["Authorization", "Bearer t"]]);
  like.get = Map.prototype.get;
  assert.deepEqual({ ...headers.normalize(like) }, { authorization: "Bearer t" });
  assert.deepEqual({ ...headers.normalize(null) }, {});
});

test("cookie and authorization flags", () => {
  assert.equal(headers.hasCookie([{ name: "Cookie", value: "a=1" }]), true);
  assert.equal(headers.hasCookie([{ name: "Cookie", value: "" }]), false);
  assert.equal(headers.hasAuthorization({ "Proxy-Authorization": "Basic x" }), true);
  assert.equal(headers.hasAuthorization({}), false);
  const summary = headers.summarize([{ name: "Authorization", value: "Bearer t" }]);
  assert.deepEqual({ ...summary.requestHeaders }, { authorization: "Bearer t" });
  assert.equal(summary.hasAuthorization, true);
  assert.equal(summary.hasCookie, false);
});

"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { KeyStore, Settings } = require("../../src/main/store");

// A stand-in for Electron's safeStorage: "encrypts" by reversing and
// base64-encoding, so the test can check no key is ever written as is.
function fakeSafeStorage(available = true) {
  return {
    isAsyncEncryptionAvailable: async () => available,
    encryptStringAsync: async (s) => Buffer.from(`ENC:${Buffer.from([...s].reverse().join("")).toString("base64")}`),
    decryptStringAsync: async (b) => {
      const t = b.toString();
      if (!t.startsWith("ENC:")) throw new Error("bad");
      return { result: [...Buffer.from(t.slice(4), "base64").toString()].reverse().join(""), shouldReEncrypt: false };
    },
  };
}

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), "pilot-keys-"));

test("keys are saved encrypted, read back, hinted and removed", async () => {
  const dir = tmp();
  const store = new KeyStore(dir, fakeSafeStorage());
  await store.init();
  await store.set("profile:a", "sk-secret-abcd1234");
  const raw = fs.readFileSync(path.join(dir, "keys.bin"), "utf8");
  assert.ok(!raw.includes("sk-secret-abcd1234"), "never written in plain text");
  assert.equal((fs.statSync(path.join(dir, "keys.bin")).mode & 0o777), 0o600);
  const again = new KeyStore(dir, fakeSafeStorage());
  await again.init();
  assert.equal(again.get("profile:a"), "sk-secret-abcd1234");
  assert.equal(again.hint("profile:a"), "…1234");
  await again.set("media:image", "img-key-9999");
  await again.remove("profile:a");
  assert.equal(again.get("profile:a"), "");
  await again.remove("media:image");
  assert.ok(!fs.existsSync(path.join(dir, "keys.bin")), "the file goes when the last key goes");
});

test("without the Keychain, Pilot refuses to save a key", async () => {
  const dir = tmp();
  const store = new KeyStore(dir, fakeSafeStorage(false));
  await store.init();
  await assert.rejects(store.set("profile:a", "sk-x"), (e) => e.kind === "keychain");
  assert.equal(store.get("profile:a"), "");
  assert.ok(!fs.existsSync(path.join(dir, "keys.bin")));
});

test("a key with spaces is refused, and an unreadable file never crashes", async () => {
  const dir = tmp();
  fs.writeFileSync(path.join(dir, "keys.bin"), "garbage");
  const store = new KeyStore(dir, fakeSafeStorage());
  await store.init();
  assert.equal(store.get("x"), "");
  await assert.rejects(store.set("x", "two words"), (e) => e.kind === "key");
});

test("settings never hold keys; notes and memory can be listed and deleted", () => {
  const dir = tmp();
  const s = new Settings(dir);
  const id = s.upsertProfile({ provider: "openai", label: "Work", model: "m", key: "sk-should-not-be-here" });
  assert.equal(s.get("activeProfile"), id);
  s.addNote({ title: "T", text: "hello" });
  s.addMemory("ignored while memory is off");
  assert.equal(s.get("memory").length, 0, "memory is off by default");
  s.set("memoryOn", true);
  s.addMemory("likes short answers");
  const text = fs.readFileSync(path.join(dir, "settings.json"), "utf8");
  assert.ok(!text.includes("sk-should-not-be-here"));
  const again = new Settings(dir);
  assert.equal(again.get("notes")[0].text, "hello");
  again.removeNote(again.get("notes")[0].id);
  again.removeMemory(again.get("memory")[0].id);
  assert.equal(again.get("notes").length, 0);
  assert.equal(again.get("memory").length, 0);
  assert.equal(again.get("openAtLogin"), true, "starts at login by default");
});

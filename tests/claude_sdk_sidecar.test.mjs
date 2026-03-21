import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { createInterface } from "node:readline";
import { fileURLToPath } from "node:url";

const repoRoot = fileURLToPath(new URL("../", import.meta.url));
const sidecarPath = resolve(repoRoot, "src-tauri/resources/claude_sdk_sidecar.mjs");

let tempDirPath = "";
let mockSdkEntryPath = "";
const runningSidecars = new Set();

function delay(ms) {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

function createMockSdkModule() {
  return `
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

export function query() {
  let interrupted = false;
  const mode = process.env.CLAUDE_MONITOR_TEST_MODE ?? "success";
  return {
    async supportedModels() {
      return [
        {
          value: "claude-3-7-sonnet",
          displayName: "Claude 3.7 Sonnet",
          description: "Mock Claude model",
          supportedEffortLevels: ["low", "medium", "high"],
        },
      ];
    },
    async interrupt() {
      interrupted = true;
    },
    close() {},
    async *[Symbol.asyncIterator]() {
      if (mode === "stream-error") {
        await sleep(5);
        throw new Error("mock stream failure");
      }
      if (mode === "result-error") {
        await sleep(5);
        yield {
          type: "result",
          is_error: true,
          errors: ["mock result failure"],
        };
        return;
      }

      yield {
        type: "stream_event",
        event: {
          type: "content_block_delta",
          delta: {
            type: "text_delta",
            text: "Hello ",
          },
        },
      };

      if (mode === "interruptable") {
        while (!interrupted) {
          await sleep(5);
        }
        yield {
          type: "result",
          is_error: false,
          result: "interrupted",
        };
        return;
      }

      await sleep(5);
      yield {
        type: "assistant",
        message: {
          content: [{ type: "text", text: "Hello world" }],
        },
      };
      yield {
        type: "result",
        is_error: false,
        result: "done",
      };
    },
  };
}

export async function listSessions() {
  return [];
}

export async function getSessionInfo() {
  return null;
}

export async function getSessionMessages() {
  return [];
}

export async function renameSession() {}

export async function forkSession(sessionId) {
  return { sessionId: \`fork-\${sessionId}\` };
}

export async function tagSession() {}
`;
}

function startSidecar(mode) {
  const child = spawn(process.execPath, [sidecarPath], {
    cwd: repoRoot,
    env: {
      ...process.env,
      CLAUDE_MONITOR_SDK_ENTRY: mockSdkEntryPath,
      CLAUDE_MONITOR_TEST_MODE: mode,
      CLAUDE_MONITOR_CLIENT_VERSION: "test-suite",
    },
    stdio: ["pipe", "pipe", "pipe"],
  });
  const stdout = createInterface({
    input: child.stdout,
    crlfDelay: Infinity,
  });
  const messages = [];
  const waiters = [];
  let stderrBuffer = "";

  const settleWaiter = () => {
    for (let index = 0; index < waiters.length; index += 1) {
      const waiter = waiters[index];
      const messageIndex = messages.findIndex(waiter.match);
      if (messageIndex < 0) {
        continue;
      }
      const [message] = messages.splice(messageIndex, 1);
      clearTimeout(waiter.timer);
      waiters.splice(index, 1);
      waiter.resolve(message);
      return;
    }
  };

  stdout.on("line", (line) => {
    const message = JSON.parse(line);
    messages.push(message);
    settleWaiter();
  });

  child.stderr.on("data", (chunk) => {
    stderrBuffer += chunk.toString();
  });

  const api = {
    async send(message) {
      child.stdin.write(`${JSON.stringify(message)}\n`);
      await Promise.resolve();
    },
    nextMessage(match, timeoutMs = 4000) {
      const messageIndex = messages.findIndex(match);
      if (messageIndex >= 0) {
        const [message] = messages.splice(messageIndex, 1);
        return Promise.resolve(message);
      }
      return new Promise((resolve, reject) => {
        const timer = setTimeout(() => {
          const pendingIndex = waiters.findIndex((entry) => entry.timer === timer);
          if (pendingIndex >= 0) {
            waiters.splice(pendingIndex, 1);
          }
          reject(
            new Error(
              `等待 sidecar 消息超时。stderr=${stderrBuffer || "<empty>"} queued=${JSON.stringify(messages)}`,
            ),
          );
        }, timeoutMs);
        waiters.push({ match, resolve, timer });
      });
    },
    async stop() {
      runningSidecars.delete(api);
      stdout.close();
      child.stdin.end();
      const exit = once(child, "exit").catch(() => null);
      const result = await Promise.race([exit, delay(400)]);
      if (!result) {
        child.kill();
        await once(child, "exit").catch(() => null);
      }
    },
  };

  runningSidecars.add(api);
  return api;
}

async function initializeSidecar(sidecar) {
  await sidecar.send({
    id: "initialize-1",
    method: "initialize",
    params: {},
  });
  return sidecar.nextMessage((message) => message.id === "initialize-1");
}

async function createThread(sidecar) {
  await sidecar.send({
    id: "thread-start-1",
    method: "thread/start",
    params: {
      cwd: "/tmp/mock-workspace",
    },
  });
  const response = await sidecar.nextMessage((message) => message.id === "thread-start-1");
  const notification = await sidecar.nextMessage(
    (message) =>
      message.method === "thread/started" &&
      message.params?.thread?.id === response.result.thread.id,
  );
  return {
    response,
    notification,
    threadId: response.result.thread.id,
  };
}

beforeAll(() => {
  tempDirPath = mkdtempSync(join(tmpdir(), "codex-monitor-claude-sidecar-"));
  mockSdkEntryPath = join(tempDirPath, "mock-claude-sdk.mjs");
  writeFileSync(mockSdkEntryPath, createMockSdkModule(), "utf8");
});

afterEach(async () => {
  const sidecars = Array.from(runningSidecars);
  await Promise.all(sidecars.map((sidecar) => sidecar.stop()));
});

afterAll(() => {
  rmSync(tempDirPath, { recursive: true, force: true });
});

describe("Claude SDK sidecar protocol", () => {
  it("initializes and streams normalized turn events", async () => {
    const sidecar = startSidecar("success");

    await expect(initializeSidecar(sidecar)).resolves.toMatchObject({
      result: {
        provider: "claude",
        capabilities: {
          experimentalApi: true,
        },
      },
    });

    const { threadId } = await createThread(sidecar);
    await sidecar.send({
      id: "turn-start-1",
      method: "turn/start",
      params: {
        cwd: "/tmp/mock-workspace",
        threadId,
        input: [{ type: "text", text: "Hello Claude" }],
      },
    });

    const turnResponse = await sidecar.nextMessage((message) => message.id === "turn-start-1");
    const turnId = turnResponse.result.turn.id;

    await expect(
      sidecar.nextMessage(
        (message) =>
          message.method === "turn/started" &&
          message.params?.threadId === threadId &&
          message.params?.turn?.id === turnId,
      ),
    ).resolves.toBeTruthy();
    await expect(
      sidecar.nextMessage(
        (message) =>
          message.method === "thread/name/updated" &&
          message.params?.threadId === threadId &&
          message.params?.threadName === "Hello Claude",
      ),
    ).resolves.toBeTruthy();
    await expect(
      sidecar.nextMessage(
        (message) =>
          message.method === "item/completed" &&
          message.params?.threadId === threadId &&
          message.params?.item?.type === "userMessage",
      ),
    ).resolves.toBeTruthy();
    await expect(
      sidecar.nextMessage(
        (message) =>
          message.method === "item/agentMessage/delta" &&
          message.params?.threadId === threadId &&
          message.params?.delta === "Hello ",
      ),
    ).resolves.toBeTruthy();
    await expect(
      sidecar.nextMessage(
        (message) =>
          message.method === "item/completed" &&
          message.params?.threadId === threadId &&
          message.params?.item?.type === "agentMessage" &&
          message.params?.item?.text === "Hello world",
      ),
    ).resolves.toBeTruthy();
    await expect(
      sidecar.nextMessage(
        (message) =>
          message.method === "turn/completed" &&
          message.params?.threadId === threadId &&
          message.params?.turn?.id === turnId,
      ),
    ).resolves.toBeTruthy();
  });

  it("interrupts an active Claude turn through turn/interrupt", async () => {
    const sidecar = startSidecar("interruptable");

    await initializeSidecar(sidecar);
    const { threadId } = await createThread(sidecar);

    await sidecar.send({
      id: "turn-start-2",
      method: "turn/start",
      params: {
        cwd: "/tmp/mock-workspace",
        threadId,
        input: [{ type: "text", text: "Interrupt me" }],
      },
    });
    const turnResponse = await sidecar.nextMessage((message) => message.id === "turn-start-2");
    const turnId = turnResponse.result.turn.id;

    await sidecar.nextMessage(
      (message) =>
        message.method === "turn/started" &&
        message.params?.threadId === threadId &&
        message.params?.turn?.id === turnId,
    );

    await sidecar.send({
      id: "turn-interrupt-1",
      method: "turn/interrupt",
      params: {
        threadId,
        turnId,
      },
    });

    await expect(
      sidecar.nextMessage((message) => message.id === "turn-interrupt-1"),
    ).resolves.toMatchObject({
      result: {
        ok: true,
      },
    });
    await expect(
      sidecar.nextMessage(
        (message) =>
          message.method === "turn/completed" &&
          message.params?.threadId === threadId &&
          message.params?.turn?.id === turnId,
      ),
    ).resolves.toBeTruthy();
  });

  it("surfaces runtime failures as normalized error notifications", async () => {
    const sidecar = startSidecar("result-error");

    await initializeSidecar(sidecar);
    const { threadId } = await createThread(sidecar);

    await sidecar.send({
      id: "turn-start-3",
      method: "turn/start",
      params: {
        cwd: "/tmp/mock-workspace",
        threadId,
        input: [{ type: "text", text: "Fail please" }],
      },
    });

    const turnResponse = await sidecar.nextMessage((message) => message.id === "turn-start-3");
    const turnId = turnResponse.result.turn.id;

    await expect(
      sidecar.nextMessage(
        (message) =>
          message.method === "error" &&
          message.params?.threadId === threadId &&
          message.params?.turnId === turnId &&
          message.params?.error?.message === "mock result failure",
      ),
    ).resolves.toBeTruthy();
  });
});

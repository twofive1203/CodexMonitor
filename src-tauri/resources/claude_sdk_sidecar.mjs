import { randomUUID } from "node:crypto";
import { createInterface } from "node:readline";
import { once } from "node:events";
import { pathToFileURL } from "node:url";

/**
 * 读取并校验 sidecar 启动所需的环境变量。
 *
 * `process.env`：当前进程环境变量。
 */
function loadEnvConfig() {
  const sdkEntry = normalizeString(process.env.CLAUDE_MONITOR_SDK_ENTRY);
  if (!sdkEntry) {
    throw new Error("缺少 CLAUDE_MONITOR_SDK_ENTRY。");
  }
  return {
    sdkEntry,
    claudeBin: normalizeString(process.env.CLAUDE_MONITOR_PROVIDER_BIN),
    rawClaudeArgs: normalizeString(process.env.CLAUDE_MONITOR_PROVIDER_ARGS),
    defaultModel: normalizeString(process.env.CLAUDE_MONITOR_DEFAULT_MODEL),
    basePermissionMode:
      normalizePermissionMode(process.env.CLAUDE_MONITOR_PERMISSION_MODE) ?? "default",
    clientVersion: normalizeString(process.env.CLAUDE_MONITOR_CLIENT_VERSION) ?? "dev",
  };
}

/**
 * 统一输出非空字符串。
 *
 * `value`：原始输入值。
 */
function normalizeString(value) {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : null;
}

/**
 * 校验 Claude 权限模式字符串。
 *
 * `value`：待校验的原始权限模式。
 */
function normalizePermissionMode(value) {
  const normalized = normalizeString(value);
  if (
    normalized === "default" ||
    normalized === "acceptEdits" ||
    normalized === "bypassPermissions" ||
    normalized === "plan" ||
    normalized === "dontAsk"
  ) {
    return normalized;
  }
  return null;
}

/**
 * 校验 effort 字段。
 *
 * `value`：待校验的 effort。
 */
function normalizeEffort(value) {
  const normalized = normalizeString(value);
  if (
    normalized === "low" ||
    normalized === "medium" ||
    normalized === "high" ||
    normalized === "max"
  ) {
    return normalized;
  }
  return null;
}

/**
 * 统一从对象中读取字符串字段。
 *
 * `record`：目标对象。
 * `keys`：候选字段名列表。
 */
function readString(record, ...keys) {
  if (!record || typeof record !== "object" || Array.isArray(record)) {
    return null;
  }
  for (const key of keys) {
    const value = normalizeString(record[key]);
    if (value) {
      return value;
    }
  }
  return null;
}

/**
 * 把 CLI 风格的参数字符串转换成 SDK `extraArgs` 结构。
 *
 * `rawArgs`：原始参数字符串。
 */
function parseExtraArgs(rawArgs) {
  if (!rawArgs) {
    return undefined;
  }
  const tokens = tokenizeCommandLine(rawArgs);
  if (tokens.length === 0) {
    return undefined;
  }
  const extraArgs = {};
  for (let index = 0; index < tokens.length; index += 1) {
    const token = tokens[index];
    if (!token.startsWith("-")) {
      continue;
    }
    if (token.startsWith("--")) {
      const withoutPrefix = token.slice(2);
      if (!withoutPrefix) {
        continue;
      }
      const equalIndex = withoutPrefix.indexOf("=");
      if (equalIndex >= 0) {
        const key = withoutPrefix.slice(0, equalIndex).trim();
        const value = withoutPrefix.slice(equalIndex + 1).trim();
        if (key) {
          extraArgs[key] = value || null;
        }
        continue;
      }
      const next = tokens[index + 1];
      if (next && !next.startsWith("-")) {
        extraArgs[withoutPrefix] = next;
        index += 1;
      } else {
        extraArgs[withoutPrefix] = null;
      }
      continue;
    }
    const shortKey = token.slice(1).trim();
    if (!shortKey) {
      continue;
    }
    const next = tokens[index + 1];
    if (next && !next.startsWith("-")) {
      extraArgs[shortKey] = next;
      index += 1;
    } else {
      extraArgs[shortKey] = null;
    }
  }
  return Object.keys(extraArgs).length > 0 ? extraArgs : undefined;
}

/**
 * 简单命令行分词器，用于解析设置中的 CLI 参数。
 *
 * `input`：原始命令行字符串。
 */
function tokenizeCommandLine(input) {
  const tokens = [];
  let current = "";
  let quote = null;
  let escaped = false;
  for (const char of input) {
    if (escaped) {
      current += char;
      escaped = false;
      continue;
    }
    if (char === "\\") {
      escaped = true;
      continue;
    }
    if (quote) {
      if (char === quote) {
        quote = null;
      } else {
        current += char;
      }
      continue;
    }
    if (char === "\"" || char === "'") {
      quote = char;
      continue;
    }
    if (/\s/.test(char)) {
      if (current) {
        tokens.push(current);
        current = "";
      }
      continue;
    }
    current += char;
  }
  if (current) {
    tokens.push(current);
  }
  return tokens;
}

/**
 * 提取线程预览文本。
 *
 * `text`：原始消息文本。
 */
function buildThreadPreview(text) {
  const normalized = normalizeString(text);
  if (!normalized) {
    return "";
  }
  return normalized.length > 120 ? `${normalized.slice(0, 120)}...` : normalized;
}

/**
 * 从 turn/start 的输入数组中构造对 Claude 的提示文本。
 *
 * `input`：前端传入的 turn input 数组。
 */
function buildPromptFromInput(input) {
  const parts = [];
  const normalizedInput = Array.isArray(input) ? input : [];
  for (const entry of normalizedInput) {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
      continue;
    }
    const type = readString(entry, "type");
    if (type === "text") {
      const text = readString(entry, "text");
      if (text) {
        parts.push(text);
      }
      continue;
    }
    if (type === "mention") {
      const name = readString(entry, "name") ?? "app";
      const path = readString(entry, "path");
      parts.push(path ? `@${name} (${path})` : `@${name}`);
      continue;
    }
    if (type === "image" || type === "localImage") {
      const value = readString(entry, "url", "path");
      if (value) {
        parts.push(`[图片: ${value}]`);
      }
    }
  }
  const prompt = parts.join("\n").trim();
  return prompt || "[空消息]";
}

/**
 * 从输入数组中提取首条纯文本内容。
 *
 * `input`：前端传入的 turn input 数组。
 */
function extractPrimaryUserText(input) {
  const normalizedInput = Array.isArray(input) ? input : [];
  for (const entry of normalizedInput) {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
      continue;
    }
    if (readString(entry, "type") !== "text") {
      continue;
    }
    const text = readString(entry, "text");
    if (text) {
      return text;
    }
  }
  return buildPromptFromInput(input);
}

/**
 * 从 Claude assistant message 中提取文本。
 *
 * `message`：SDK assistant message 内的 message 对象。
 */
function extractAssistantText(message) {
  const content = Array.isArray(message?.content) ? message.content : [];
  return content
    .filter((entry) => entry && typeof entry === "object" && entry.type === "text")
    .map((entry) => normalizeString(entry.text) ?? "")
    .filter(Boolean)
    .join("\n")
    .trim();
}

/**
 * 统一序列化向 Rust 输出 JSON 行，避免并发写入互相打断。
 *
 * `value`：待输出的 JSON 对象。
 */
let outputChain = Promise.resolve();
function writeMessage(value) {
  outputChain = outputChain.then(async () => {
    const line = `${JSON.stringify(value)}\n`;
    if (!process.stdout.write(line)) {
      await once(process.stdout, "drain");
    }
  });
  return outputChain;
}

/**
 * 向 Rust 返回请求成功结果。
 *
 * `id`：原请求 ID。
 * `result`：返回结果。
 */
function writeResponse(id, result) {
  return writeMessage({ id, result });
}

/**
 * 向 Rust 返回请求错误。
 *
 * `id`：原请求 ID。
 * `message`：错误信息。
 */
function writeError(id, message) {
  return writeMessage({
    id,
    error: {
      message,
    },
  });
}

/**
 * 向前端桥接通知事件。
 *
 * `method`：事件方法名。
 * `params`：事件参数。
 */
function writeNotification(method, params) {
  return writeMessage({ method, params });
}

/**
 * 把 Claude session metadata 转换成前端可识别的 thread 摘要。
 *
 * `threadState`：内存中的线程状态。
 * `sessionInfo`：Claude SDK 返回的 session 元数据。
 */
function buildThreadSummary(threadState, sessionInfo) {
  const preview =
    normalizeString(sessionInfo?.customTitle) ??
    normalizeString(sessionInfo?.summary) ??
    normalizeString(sessionInfo?.firstPrompt) ??
    threadState.preview ??
    threadState.id;
  return {
    id: threadState.id,
    preview,
    updatedAt: sessionInfo?.lastModified ?? threadState.updatedAt,
    updated_at: sessionInfo?.lastModified ?? threadState.updatedAt,
    createdAt: sessionInfo?.createdAt ?? threadState.createdAt,
    created_at: sessionInfo?.createdAt ?? threadState.createdAt,
    cwd: sessionInfo?.cwd ?? threadState.cwd,
  };
}

/**
 * 把 Claude transcript 历史转换成前端 thread/resume 需要的 turns 结构。
 *
 * `threadState`：当前线程状态。
 * `sessionInfo`：Claude session 元数据。
 * `messages`：Claude transcript 消息。
 */
function buildThreadResumePayload(threadState, sessionInfo, messages) {
  const items = [];
  const sessionMessages = Array.isArray(messages) ? messages : [];
  for (const entry of sessionMessages) {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
      continue;
    }
    const messageType = readString(entry, "type");
    const uuid = readString(entry, "uuid") ?? randomUUID();
    const message = entry.message;
    if (!message || typeof message !== "object" || Array.isArray(message)) {
      continue;
    }
    if (messageType === "user") {
      const content = Array.isArray(message.content) ? message.content : [];
      items.push({
        id: uuid,
        type: "userMessage",
        content,
      });
      continue;
    }
    if (messageType === "assistant") {
      const text = extractAssistantText(message);
      if (text) {
        items.push({
          id: uuid,
          type: "agentMessage",
          text,
        });
      }
    }
  }
  const thread = buildThreadSummary(threadState, sessionInfo);
  return {
    ...thread,
    activeTurnId: threadState.activeTurn?.turnId ?? null,
    turns: [
      {
        id: `${threadState.id}-history`,
        status: threadState.activeTurn ? "in_progress" : "completed",
        items,
      },
    ],
  };
}

/**
 * 构造 `requestUserInput` 所需的问题数组。
 *
 * `request`：Claude SDK 的 elicitation 请求。
 */
function buildQuestionsFromElicitation(request) {
  if (request?.mode === "url" && request?.url) {
    return [
      {
        id: "confirmation",
        header: "Claude 授权",
        question: `${request.message}\n${request.url}\n完成授权后提交即可继续。`,
      },
    ];
  }

  const schema =
    request?.requestedSchema &&
    typeof request.requestedSchema === "object" &&
    !Array.isArray(request.requestedSchema)
      ? request.requestedSchema
      : null;
  const properties =
    schema &&
    typeof schema.properties === "object" &&
    schema.properties &&
    !Array.isArray(schema.properties)
      ? schema.properties
      : null;
  const required = new Set(Array.isArray(schema?.required) ? schema.required : []);
  if (!properties) {
    return [
      {
        id: "response",
        header: "Claude 补充信息",
        question: request?.message ?? "请补充所需信息。",
      },
    ];
  }

  return Object.entries(properties).map(([key, value]) => {
    const record = value && typeof value === "object" && !Array.isArray(value) ? value : {};
    const title = normalizeString(record.title) ?? key;
    const description =
      normalizeString(record.description) ??
      `${request?.message ?? "请补充所需信息。"}${required.has(key) ? "（必填）" : ""}`;
    const enumValues = Array.isArray(record.enum) ? record.enum : [];
    const options =
      enumValues.length > 0
        ? enumValues
            .map((entry) => normalizeString(String(entry)))
            .filter(Boolean)
            .map((entry) => ({
              label: entry,
              description: description || entry,
            }))
        : undefined;
    return {
      id: key,
      header: title,
      question: description,
      options,
    };
  });
}

/**
 * 把前端用户输入结果转换成 Claude SDK 需要的返回结构。
 *
 * `request`：原始 elicitation 请求。
 * `response`：宿主侧返回的数据。
 */
function buildElicitationResult(request, response) {
  const answers =
    response &&
    typeof response === "object" &&
    !Array.isArray(response) &&
    response.answers &&
    typeof response.answers === "object" &&
    !Array.isArray(response.answers)
      ? response.answers
      : {};

  if (request?.mode === "url") {
    return { action: "accept", content: {} };
  }

  const content = {};
  for (const [key, value] of Object.entries(answers)) {
    const answerList = Array.isArray(value?.answers)
      ? value.answers
          .map((entry) => normalizeString(String(entry)))
          .filter(Boolean)
      : [];
    if (answerList.length === 0) {
      continue;
    }
    content[key] = answerList.length === 1 ? answerList[0] : answerList;
  }
  return { action: "accept", content };
}

/**
 * 创建发往宿主侧的 server request，并等待用户响应。
 *
 * `state`：全局 sidecar 状态。
 * `method`：请求方法名。
 * `params`：请求参数。
 */
function requestHost(state, method, params) {
  const requestId = `host-${randomUUID()}`;
  return new Promise((resolve, reject) => {
    state.pendingHostRequests.set(String(requestId), { resolve, reject });
    void writeMessage({
      id: requestId,
      method,
      params,
    }).catch((error) => {
      state.pendingHostRequests.delete(String(requestId));
      reject(error);
    });
  });
}

/**
 * 处理 Claude 工具审批请求。
 *
 * `state`：sidecar 全局状态。
 * `threadState`：当前线程状态。
 * `turnState`：当前回合状态。
 * `toolName`：工具名称。
 * `toolInput`：工具入参。
 * `toolOptions`：SDK 侧补充信息。
 */
async function handlePermissionRequest(
  state,
  threadState,
  turnState,
  toolName,
  toolInput,
  toolOptions,
) {
  const requestPayload = {
    threadId: threadState.id,
    turnId: turnState.turnId,
    itemId: toolOptions.toolUseID ?? randomUUID(),
    toolName,
    title: toolOptions.title ?? `${toolName} 需要审批`,
    description: toolOptions.description ?? "",
    command:
      typeof toolInput?.command === "string"
        ? toolInput.command
        : typeof toolInput?.cmd === "string"
          ? toolInput.cmd
          : null,
    argv: Array.isArray(toolInput?.command)
      ? toolInput.command
      : Array.isArray(toolInput?.argv)
        ? toolInput.argv
        : Array.isArray(toolInput?.args)
          ? toolInput.args
          : null,
    input: toolInput ?? {},
    displayName: toolOptions.displayName ?? null,
  };
  const hostResponse = await requestHost(
    state,
    "item/permissions/requestApproval",
    requestPayload,
  );
  const decision =
    hostResponse &&
    typeof hostResponse === "object" &&
    !Array.isArray(hostResponse) &&
    normalizeString(hostResponse.decision);
  if (decision === "accept") {
    return { behavior: "allow" };
  }
  return {
    behavior: "deny",
    message: "用户拒绝了本次 Claude 工具调用。",
  };
}

/**
 * 处理 Claude 补充输入请求。
 *
 * `state`：sidecar 全局状态。
 * `threadState`：当前线程状态。
 * `turnState`：当前回合状态。
 * `request`：Claude SDK elicitation 请求。
 * `options`：SDK 调用选项。
 */
async function handleElicitationRequest(state, threadState, turnState, request, options) {
  const hostResponse = await requestHost(state, "item/tool/requestUserInput", {
    threadId: threadState.id,
    turnId: turnState.turnId,
    itemId: `elicitation-${randomUUID()}`,
    questions: buildQuestionsFromElicitation(request),
  });
  if (options?.signal?.aborted) {
    return { action: "cancel" };
  }
  return buildElicitationResult(request, hostResponse);
}

/**
 * 根据 turn/start 请求构造 Claude Query options。
 *
 * `envConfig`：sidecar 环境配置。
 * `threadState`：当前线程状态。
 * `params`：turn/start 参数。
 */
function buildQueryOptions(envConfig, threadState, params) {
  const requestedPermissionMode = normalizePermissionMode(
    params?.permissionMode ?? params?.permission_mode,
  );
  const approvalPolicy = readString(params, "approvalPolicy", "approval_policy");
  const permissionMode =
    requestedPermissionMode ??
    (approvalPolicy === "never" ? "bypassPermissions" : envConfig.basePermissionMode);
  return {
    cwd: readString(params, "cwd") ?? threadState.cwd,
    model: readString(params, "model") ?? envConfig.defaultModel ?? undefined,
    effort: normalizeEffort(params?.effort) ?? undefined,
    includePartialMessages: true,
    permissionMode,
    allowDangerouslySkipPermissions: permissionMode === "bypassPermissions",
    pathToClaudeCodeExecutable: envConfig.claudeBin ?? undefined,
    extraArgs: parseExtraArgs(envConfig.rawClaudeArgs),
    env: {
      ...process.env,
      CLAUDE_AGENT_SDK_CLIENT_APP: `codex-monitor/${envConfig.clientVersion}`,
    },
  };
}

/**
 * 按工作区目录聚合 Claude 历史线程。
 *
 * `sdk`：Claude SDK 导出对象。
 * `state`：全局 sidecar 状态。
 * `cwd`：目标工作区目录。
 */
async function listWorkspaceThreads(sdk, state, cwd) {
  const persisted = await sdk.listSessions({ dir: cwd });
  const persistedById = new Map();
  const result = [];

  for (const sessionInfo of persisted) {
    if (!sessionInfo?.sessionId || sessionInfo.tag === "archived") {
      continue;
    }
    const threadState = state.ensureThread(sessionInfo.sessionId, sessionInfo.cwd ?? cwd);
    threadState.preview =
      normalizeString(sessionInfo.customTitle) ??
      normalizeString(sessionInfo.summary) ??
      normalizeString(sessionInfo.firstPrompt) ??
      threadState.preview;
    threadState.createdAt = sessionInfo.createdAt ?? threadState.createdAt;
    threadState.updatedAt = sessionInfo.lastModified ?? threadState.updatedAt;
    threadState.hasTranscript = true;
    threadState.archived = false;
    persistedById.set(threadState.id, true);
    result.push(buildThreadSummary(threadState, sessionInfo));
  }

  for (const threadState of state.threads.values()) {
    if (threadState.cwd !== cwd || threadState.archived || persistedById.has(threadState.id)) {
      continue;
    }
    result.push(buildThreadSummary(threadState, null));
  }

  result.sort((left, right) => (right.updatedAt ?? 0) - (left.updatedAt ?? 0));
  return result;
}

/**
 * 创建 sidecar 全局状态容器。
 *
 * `sdk`：Claude SDK 导出对象。
 */
function createState(sdk) {
  return {
    sdk,
    threads: new Map(),
    activeTurns: new Map(),
    pendingHostRequests: new Map(),
    ensureThread(threadId, cwd) {
      const existing = this.threads.get(threadId);
      if (existing) {
        if (cwd) {
          existing.cwd = cwd;
        }
        return existing;
      }
      const now = Date.now();
      const next = {
        id: threadId,
        cwd,
        createdAt: now,
        updatedAt: now,
        preview: "",
        archived: false,
        hasTranscript: false,
        activeTurn: null,
      };
      this.threads.set(threadId, next);
      return next;
    },
  };
}

/**
 * 处理 `thread/start` 请求。
 *
 * `state`：sidecar 全局状态。
 * `request`：原始请求对象。
 */
async function handleThreadStart(state, request) {
  const cwd = readString(request.params, "cwd") ?? process.cwd();
  const threadId = randomUUID();
  const threadState = state.ensureThread(threadId, cwd);
  threadState.updatedAt = Date.now();
  const thread = buildThreadSummary(threadState, null);
  await writeResponse(request.id, { thread });
  await writeNotification("thread/started", {
    thread,
  });
}

/**
 * 处理 `thread/resume` 请求。
 *
 * `state`：sidecar 全局状态。
 * `request`：原始请求对象。
 */
async function handleThreadResume(state, request) {
  const threadId = readString(request.params, "threadId", "thread_id");
  if (!threadId) {
    await writeError(request.id, "缺少 threadId。");
    return;
  }
  const threadState = state.ensureThread(threadId, process.cwd());
  const sessionInfo = await state.sdk.getSessionInfo(threadId, { dir: threadState.cwd });
  if (sessionInfo) {
    threadState.cwd = sessionInfo.cwd ?? threadState.cwd;
    threadState.preview =
      normalizeString(sessionInfo.customTitle) ??
      normalizeString(sessionInfo.summary) ??
      normalizeString(sessionInfo.firstPrompt) ??
      threadState.preview;
    threadState.createdAt = sessionInfo.createdAt ?? threadState.createdAt;
    threadState.updatedAt = sessionInfo.lastModified ?? threadState.updatedAt;
    threadState.hasTranscript = true;
  }
  const messages = sessionInfo
    ? await state.sdk.getSessionMessages(threadId, { dir: threadState.cwd })
    : [];
  await writeResponse(request.id, {
    thread: buildThreadResumePayload(threadState, sessionInfo, messages),
  });
}

/**
 * 处理 `thread/list` 请求。
 *
 * `state`：sidecar 全局状态。
 * `request`：原始请求对象。
 */
async function handleThreadList(state, request) {
  const cwd = readString(request.params, "cwd") ?? process.cwd();
  const data = await listWorkspaceThreads(state.sdk, state, cwd);
  await writeResponse(request.id, {
    data,
    nextCursor: null,
  });
}

/**
 * 处理 `thread/archive` 请求。
 *
 * `state`：sidecar 全局状态。
 * `request`：原始请求对象。
 */
async function handleThreadArchive(state, request) {
  const threadId = readString(request.params, "threadId", "thread_id");
  if (!threadId) {
    await writeError(request.id, "缺少 threadId。");
    return;
  }
  const threadState = state.ensureThread(threadId, process.cwd());
  if (threadState.hasTranscript) {
    await state.sdk.tagSession(threadId, "archived", { dir: threadState.cwd });
  }
  threadState.archived = true;
  threadState.updatedAt = Date.now();
  await writeResponse(request.id, { ok: true });
  await writeNotification("thread/archived", {
    threadId,
  });
}

/**
 * 处理 `thread/name/set` 请求。
 *
 * `state`：sidecar 全局状态。
 * `request`：原始请求对象。
 */
async function handleThreadNameSet(state, request) {
  const threadId = readString(request.params, "threadId", "thread_id");
  const name = readString(request.params, "name");
  if (!threadId || !name) {
    await writeError(request.id, "缺少 threadId 或 name。");
    return;
  }
  const threadState = state.ensureThread(threadId, process.cwd());
  if (threadState.hasTranscript) {
    await state.sdk.renameSession(threadId, name, { dir: threadState.cwd });
  }
  threadState.preview = name;
  threadState.updatedAt = Date.now();
  await writeResponse(request.id, { ok: true });
  await writeNotification("thread/name/updated", {
    threadId,
    threadName: name,
  });
}

/**
 * 处理 `thread/fork` 请求。
 *
 * `state`：sidecar 全局状态。
 * `request`：原始请求对象。
 */
async function handleThreadFork(state, request) {
  const threadId = readString(request.params, "threadId", "thread_id");
  if (!threadId) {
    await writeError(request.id, "缺少 threadId。");
    return;
  }
  const threadState = state.ensureThread(threadId, process.cwd());
  let nextThreadId = randomUUID();
  if (threadState.hasTranscript) {
    const forkResult = await state.sdk.forkSession(threadId, { dir: threadState.cwd });
    nextThreadId = forkResult.sessionId;
  }
  const nextThreadState = state.ensureThread(nextThreadId, threadState.cwd);
  nextThreadState.preview = threadState.preview;
  nextThreadState.updatedAt = Date.now();
  const thread = buildThreadSummary(nextThreadState, null);
  await writeResponse(request.id, { thread });
  await writeNotification("thread/started", {
    thread,
  });
}

/**
 * 处理 `model/list` 请求。
 *
 * `state`：sidecar 全局状态。
 * `request`：原始请求对象。
 * `envConfig`：sidecar 环境配置。
 */
async function handleModelList(state, request, envConfig) {
  const session = state.sdk.query({
    prompt: "",
    options: {
      cwd: process.cwd(),
      includePartialMessages: false,
      permissionMode: envConfig.basePermissionMode,
      allowDangerouslySkipPermissions: envConfig.basePermissionMode === "bypassPermissions",
      pathToClaudeCodeExecutable: envConfig.claudeBin ?? undefined,
      extraArgs: parseExtraArgs(envConfig.rawClaudeArgs),
      env: {
        ...process.env,
        CLAUDE_AGENT_SDK_CLIENT_APP: `codex-monitor/${envConfig.clientVersion}`,
      },
    },
  });
  try {
    const models = await session.supportedModels();
    const data = Array.isArray(models)
      ? models.map((entry) => ({
          id: entry.value,
          model: entry.value,
          displayName: entry.displayName ?? entry.value,
          description: entry.description ?? "",
          supportedReasoningEfforts: Array.isArray(entry.supportedEffortLevels)
            ? entry.supportedEffortLevels.map((effort) => ({
                reasoningEffort: effort,
                description: effort,
              }))
            : [],
          defaultReasoningEffort: null,
          isDefault: false,
        }))
      : [];
    await writeResponse(request.id, { data });
  } finally {
    session.close();
  }
}

/**
 * 处理 `turn/start` 请求，并在后台持续向前端转发流式事件。
 *
 * `state`：sidecar 全局状态。
 * `request`：原始请求对象。
 * `envConfig`：sidecar 环境配置。
 */
async function handleTurnStart(state, request, envConfig) {
  const threadId = readString(request.params, "threadId", "thread_id");
  if (!threadId) {
    await writeError(request.id, "缺少 threadId。");
    return;
  }
  const input = Array.isArray(request.params?.input) ? request.params.input : [];
  const cwd = readString(request.params, "cwd") ?? process.cwd();
  const threadState = state.ensureThread(threadId, cwd);
  if (threadState.activeTurn) {
    await writeError(request.id, "当前线程仍有进行中的回合。");
    return;
  }

  const turnId = randomUUID();
  const assistantItemId = `assistant-${randomUUID()}`;
  const queryOptions = buildQueryOptions(envConfig, threadState, request.params);
  const prompt = buildPromptFromInput(input);
  const primaryUserText = extractPrimaryUserText(input);
  const nextPreview = buildThreadPreview(primaryUserText);
  const shouldEmitPreviewRename = nextPreview && nextPreview !== threadState.preview;

  const turnState = {
    turnId,
    assistantItemId,
    query: null,
    interrupted: false,
    finalText: "",
  };
  threadState.activeTurn = turnState;
  threadState.updatedAt = Date.now();
  if (nextPreview) {
    threadState.preview = nextPreview;
  }

  const canUseTool = (toolName, toolInput, toolOptions) =>
    handlePermissionRequest(state, threadState, turnState, toolName, toolInput, toolOptions);
  const onElicitation = (elicitationRequest, options) =>
    handleElicitationRequest(state, threadState, turnState, elicitationRequest, options);

  const query = state.sdk.query({
    prompt,
    options: {
      ...queryOptions,
      canUseTool,
      onElicitation,
      ...(threadState.hasTranscript ? { resume: threadId } : { sessionId: threadId }),
    },
  });
  turnState.query = query;
  state.activeTurns.set(threadId, turnState);

  await writeResponse(request.id, {
    turn: {
      id: turnId,
      threadId,
    },
  });

  await writeNotification("turn/started", {
    threadId,
    turn: {
      id: turnId,
      threadId,
    },
  });

  if (shouldEmitPreviewRename) {
    await writeNotification("thread/name/updated", {
      threadId,
      threadName: threadState.preview,
    });
  }

  await writeNotification("item/completed", {
    threadId,
    item: {
      id: `user-${randomUUID()}`,
      type: "userMessage",
      content: input,
    },
  });

  void (async () => {
    let emittedCompletion = false;
    try {
      for await (const message of query) {
        if (message?.type === "stream_event") {
          if (
            message.event?.type === "content_block_delta" &&
            message.event?.delta?.type === "text_delta" &&
            normalizeString(message.event.delta.text)
          ) {
            const delta = message.event.delta.text;
            turnState.finalText += delta;
            await writeNotification("item/agentMessage/delta", {
              threadId,
              itemId: assistantItemId,
              delta,
            });
          }
          continue;
        }

        if (message?.type === "assistant") {
          const assistantText = extractAssistantText(message.message);
          if (assistantText) {
            turnState.finalText = assistantText;
            emittedCompletion = true;
            await writeNotification("item/completed", {
              threadId,
              item: {
                id: assistantItemId,
                type: "agentMessage",
                text: assistantText,
              },
            });
          }
          continue;
        }

        if (message?.type === "result") {
          threadState.hasTranscript = true;
          threadState.updatedAt = Date.now();
          if (message.is_error) {
            if (!turnState.interrupted) {
              const errorMessage =
                Array.isArray(message.errors) && message.errors.length > 0
                  ? message.errors.join("; ")
                  : normalizeString(message.result) ?? "Claude 执行失败。";
              await writeNotification("error", {
                threadId,
                turnId,
                error: {
                  message: errorMessage,
                },
                willRetry: false,
              });
            } else {
              await writeNotification("turn/completed", {
                threadId,
                turn: {
                  id: turnId,
                  threadId,
                },
              });
            }
            return;
          }

          if (!emittedCompletion && turnState.finalText) {
            await writeNotification("item/completed", {
              threadId,
              item: {
                id: assistantItemId,
                type: "agentMessage",
                text: turnState.finalText,
              },
            });
          }

          await writeNotification("turn/completed", {
            threadId,
            turn: {
              id: turnId,
              threadId,
            },
          });
        }
      }
    } catch (error) {
      if (!turnState.interrupted) {
        await writeNotification("error", {
          threadId,
          turnId,
          error: {
            message: error instanceof Error ? error.message : String(error),
          },
          willRetry: false,
        });
      } else {
        await writeNotification("turn/completed", {
          threadId,
          turn: {
            id: turnId,
            threadId,
          },
        });
      }
    } finally {
      threadState.activeTurn = null;
      state.activeTurns.delete(threadId);
      query.close();
    }
  })();
}

/**
 * 处理 `turn/interrupt` 请求。
 *
 * `state`：sidecar 全局状态。
 * `request`：原始请求对象。
 */
async function handleTurnInterrupt(state, request) {
  const threadId = readString(request.params, "threadId", "thread_id");
  const turnId = readString(request.params, "turnId", "turn_id");
  if (!threadId || !turnId) {
    await writeError(request.id, "缺少 threadId 或 turnId。");
    return;
  }
  const turnState = state.activeTurns.get(threadId);
  if (!turnState || turnState.turnId !== turnId) {
    await writeError(request.id, "未找到匹配的活动回合。");
    return;
  }
  turnState.interrupted = true;
  await turnState.query.interrupt();
  await writeResponse(request.id, { ok: true });
}

/**
 * 处理来自 Rust 的 server request 响应。
 *
 * `state`：sidecar 全局状态。
 * `message`：原始响应对象。
 */
function handleHostResponse(state, message) {
  const pending = state.pendingHostRequests.get(String(message.id));
  if (!pending) {
    return false;
  }
  state.pendingHostRequests.delete(String(message.id));
  if (message.error) {
    const errorMessage =
      readString(message.error, "message") ??
      (typeof message.error === "string" ? message.error : "宿主返回了未知错误。");
    pending.reject(new Error(errorMessage));
  } else {
    pending.resolve(message.result ?? null);
  }
  return true;
}

/**
 * 统一分发 Rust 发来的请求。
 *
 * `state`：sidecar 全局状态。
 * `envConfig`：sidecar 环境配置。
 * `message`：原始消息。
 */
async function handleRequest(state, envConfig, message) {
  const method = readString(message, "method");
  if (!method) {
    return;
  }
  switch (method) {
    case "initialize":
      await writeResponse(message.id, {
        capabilities: {
          experimentalApi: true,
        },
        provider: "claude",
      });
      return;
    case "initialized":
      return;
    case "thread/start":
      await handleThreadStart(state, message);
      return;
    case "thread/resume":
      await handleThreadResume(state, message);
      return;
    case "thread/list":
      await handleThreadList(state, message);
      return;
    case "thread/fork":
      await handleThreadFork(state, message);
      return;
    case "thread/archive":
      await handleThreadArchive(state, message);
      return;
    case "thread/name/set":
      await handleThreadNameSet(state, message);
      return;
    case "thread/compact/start":
      await writeError(message.id, "Claude Provider 暂不支持 thread/compact/start。");
      return;
    case "turn/start":
      await handleTurnStart(state, message, envConfig);
      return;
    case "turn/interrupt":
      await handleTurnInterrupt(state, message);
      return;
    case "model/list":
      await handleModelList(state, message, envConfig);
      return;
    default:
      await writeError(message.id, `Claude sidecar 暂不支持方法：${method}`);
  }
}

/**
 * 启动 sidecar 主循环。
 *
 * `process.stdin`：Rust 侧标准输入。
 */
async function main() {
  const envConfig = loadEnvConfig();
  const sdkModule = await import(pathToFileURL(envConfig.sdkEntry).href);
  const state = createState({
    query: sdkModule.query,
    listSessions: sdkModule.listSessions,
    getSessionInfo: sdkModule.getSessionInfo,
    getSessionMessages: sdkModule.getSessionMessages,
    renameSession: sdkModule.renameSession,
    forkSession: sdkModule.forkSession,
    tagSession: sdkModule.tagSession,
  });

  const readline = createInterface({
    input: process.stdin,
    crlfDelay: Infinity,
  });

  for await (const line of readline) {
    const payload = normalizeString(line);
    if (!payload) {
      continue;
    }

    let message;
    try {
      message = JSON.parse(payload);
    } catch (error) {
      console.error(
        JSON.stringify({
          type: "parse_error",
          message: error instanceof Error ? error.message : String(error),
          raw: payload,
        }),
      );
      continue;
    }

    if (
      message &&
      typeof message === "object" &&
      !Array.isArray(message) &&
      "id" in message &&
      ("result" in message || "error" in message) &&
      !("method" in message)
    ) {
      handleHostResponse(state, message);
      continue;
    }

    try {
      await handleRequest(state, envConfig, message);
    } catch (error) {
      if (message && typeof message === "object" && !Array.isArray(message) && "id" in message) {
        await writeError(
          message.id,
          error instanceof Error ? error.message : String(error),
        );
      } else {
        console.error(error instanceof Error ? error.stack ?? error.message : String(error));
      }
    }
  }
}

await main();

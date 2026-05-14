import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
  type MouseEvent,
} from "react";
import ReactMarkdown, { type Components } from "react-markdown";
import remarkGfm from "remark-gfm";
import { openUrl } from "@tauri-apps/plugin-opener";
import {
  describeFileTarget,
  formatParsedFileLocation,
  isFileLinkUrl,
  parseFileLinkUrl,
  parseInlineFileTarget,
  remarkFileLinks,
  resolveMessageFileHref,
  toFileLink,
} from "../utils/messageFileLinks";
import type { ParsedFileLocation } from "../../../utils/fileLinks";

type MarkdownProps = {
  value: string;
  className?: string;
  codeBlock?: boolean;
  codeBlockStyle?: "default" | "message";
  codeBlockCopyUseModifier?: boolean;
  showFilePath?: boolean;
  workspacePath?: string | null;
  onOpenFileLink?: (path: ParsedFileLocation) => void;
  onOpenFileLinkMenu?: (event: React.MouseEvent, path: ParsedFileLocation) => void;
  onOpenThreadLink?: (threadId: string) => void;
};

type CodeBlockProps = {
  className?: string;
  value: string;
  copyUseModifier: boolean;
};

type MermaidBlockProps = {
  className?: string;
  value: string;
  copyUseModifier: boolean;
};

type MermaidRenderState =
  | { status: "loading" }
  | { status: "ready"; svg: string }
  | { status: "error"; message: string };

type MermaidApi = typeof import("mermaid").default;

type PreProps = {
  node?: {
    tagName?: string;
    children?: Array<{
      tagName?: string;
      properties?: { className?: string[] | string };
      children?: Array<{ value?: string }>;
    }>;
  };
  children?: ReactNode;
  copyUseModifier: boolean;
  linkDragGuard: LinkDragGuard;
};

type LinkBlockProps = {
  urls: string[];
};

type LinkDragGuard = ReturnType<typeof useLinkDragGuard>;

let mermaidInitialized = false;
let mermaidRenderId = 0;
const mermaidSvgCache = new Map<string, string>();
const mermaidSvgPendingCache = new Map<string, Promise<string>>();

function extractLanguageTag(className?: string) {
  if (!className) {
    return null;
  }
  const match = className.match(/language-([\w-]+)/i);
  if (!match) {
    return null;
  }
  return match[1];
}

/**
 * 判断代码块语言是否应按 Mermaid 图渲染。
 *
 * @param languageTag 代码块语言标签。
 * @returns 匹配 Mermaid 语言时返回 true。
 */
function isMermaidLanguageTag(languageTag: string | null) {
  return languageTag?.toLowerCase() === "mermaid";
}

function extractCodeFromPre(node?: PreProps["node"]) {
  const codeNode = node?.children?.find((child) => child.tagName === "code");
  const className = codeNode?.properties?.className;
  const normalizedClassName = Array.isArray(className)
    ? className.join(" ")
    : className;
  const value =
    codeNode?.children?.map((child) => child.value ?? "").join("") ?? "";
  return {
    className: normalizedClassName,
    value: value.replace(/\n$/, ""),
  };
}

function normalizeUrlLine(line: string) {
  const trimmed = line.trim();
  if (!trimmed) {
    return null;
  }
  const withoutBullet = trimmed.replace(/^(?:[-*]|\d+\.)\s+/, "");
  if (!/^https?:\/\/\S+$/i.test(withoutBullet)) {
    return null;
  }
  return withoutBullet;
}

type StructuredReviewFinding = {
  file: string;
  category: string;
  finding: string;
  recommendation: string;
  severity: string;
};

function escapeTableCell(value: string) {
  return value
    .replace(/\\/g, "\\\\")
    .replace(/\|/g, "\\|")
    .replace(/\r?\n/g, "<br />")
    .trim();
}

function parseStructuredReviewFinding(line: string): StructuredReviewFinding | null {
  const parts = line.split(/\s+\|\s+/).map((part) => part.trim());
  if (parts.length !== 5) {
    return null;
  }
  const [file, rawCategory, finding, recommendation, rawSeverity] = parts;
  if (!file || !finding || !recommendation || !/^category=/i.test(rawCategory)) {
    return null;
  }
  const category = rawCategory.replace(/^category=/i, "").trim();
  const severity = rawSeverity.replace(/^severity=/i, "").trim();
  if (!category || !severity) {
    return null;
  }
  if (!/^(critical|high|medium|low|info|warning|error)$/i.test(severity)) {
    return null;
  }
  return {
    file,
    category,
    finding,
    recommendation,
    severity,
  };
}

function buildStructuredReviewTable(rows: StructuredReviewFinding[]) {
  const header = [
    "| File | Category | Finding | Recommendation | Severity |",
    "| --- | --- | --- | --- | --- |",
  ];
  const body = rows.map(
    ({ file, category, finding, recommendation, severity }) =>
      `| \`${escapeTableCell(file)}\` | ${escapeTableCell(category)} | ${escapeTableCell(
        finding,
      )} | ${escapeTableCell(recommendation)} | ${escapeTableCell(severity)} |`,
  );
  return [...header, ...body].join("\n");
}

function normalizeStructuredReviewTables(value: string) {
  const lines = value.split(/\r?\n/);
  let inFence = false;
  let pendingRows: StructuredReviewFinding[] = [];
  const output: string[] = [];

  const flushPendingRows = () => {
    if (pendingRows.length === 0) {
      return;
    }
    if (output.length > 0 && output[output.length - 1].trim()) {
      output.push("");
    }
    output.push(buildStructuredReviewTable(pendingRows));
    output.push("");
    pendingRows = [];
  };

  for (const line of lines) {
    const fenceMatch = line.match(/^\s*(```|~~~)/);
    if (fenceMatch) {
      flushPendingRows();
      inFence = !inFence;
      output.push(line);
      continue;
    }
    const structuredRow = inFence ? null : parseStructuredReviewFinding(line);
    if (structuredRow) {
      pendingRows.push(structuredRow);
      continue;
    }
    if (!inFence && pendingRows.length > 0 && !line.trim()) {
      continue;
    }
    flushPendingRows();
    output.push(line);
  }

  flushPendingRows();
  return output.join("\n");
}

function stripTrailingMemoryCitation(value: string) {
  return value.replace(/\n*<oai-mem-citation>[\s\S]*?<\/oai-mem-citation>\s*$/i, "").trim();
}

/**
 * 初始化 Mermaid 的浏览器渲染配置。
 *
 * @param mermaid Mermaid 默认导出的 API 对象。
 */
function initializeMermaid(mermaid: MermaidApi) {
  if (mermaidInitialized) {
    return;
  }
  mermaid.initialize({
    startOnLoad: false,
    securityLevel: "strict",
    suppressErrorRendering: true,
    theme: "base",
    htmlLabels: true,
    themeVariables: {
      darkMode: true,
      background: "transparent",
      mainBkg: "#20242d",
      primaryColor: "#273241",
      primaryBorderColor: "#526070",
      primaryTextColor: "#f4f7fb",
      lineColor: "#8aa2b6",
      textColor: "#f4f7fb",
      secondaryColor: "#1f3d3a",
      tertiaryColor: "#2b2f3a",
    },
    fontFamily:
      "Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, Segoe UI, sans-serif",
  });
  mermaidInitialized = true;
}

/**
 * 将 Mermaid 源码渲染成 SVG 字符串。
 *
 * @param source Mermaid 图源码。
 * @param renderId 本次渲染使用的唯一 DOM id。
 * @returns Mermaid 生成的 SVG 字符串。
 */
async function renderMermaidSvg(source: string, renderId: string) {
  const mermaidModule = await import("mermaid");
  const mermaid = mermaidModule.default;
  initializeMermaid(mermaid);
  const { svg } = await mermaid.render(renderId, source);
  return svg;
}

/**
 * 带缓存地渲染 Mermaid，避免父级刷新时重复进入加载态。
 *
 * @param source Mermaid 图源码。
 * @param renderId 本次渲染使用的唯一 DOM id。
 * @returns Mermaid 生成的 SVG 字符串。
 */
async function renderCachedMermaidSvg(source: string, renderId: string) {
  const cachedSvg = mermaidSvgCache.get(source);
  if (cachedSvg) {
    return cachedSvg;
  }

  const pendingSvg = mermaidSvgPendingCache.get(source);
  if (pendingSvg) {
    return pendingSvg;
  }

  const pendingRender = renderMermaidSvg(source, renderId)
    .then((svg) => {
      mermaidSvgCache.set(source, svg);
      mermaidSvgPendingCache.delete(source);
      return svg;
    })
    .catch((error: unknown) => {
      mermaidSvgPendingCache.delete(source);
      throw error;
    });
  mermaidSvgPendingCache.set(source, pendingRender);
  return pendingRender;
}

/**
 * 保存最新值，同时保持 ref 对象身份稳定。
 *
 * @param value 需要暴露给稳定回调读取的最新值。
 * @returns 指向最新值的稳定 ref。
 */
function useLatestRef<T>(value: T) {
  const valueRef = useRef(value);
  valueRef.current = value;
  return valueRef;
}

/**
 * 管理复制状态，并在指定时间后自动复位。
 *
 * @param timeoutMs 复制成功状态保留的毫秒数。
 * @returns 复制状态和写入剪贴板的方法。
 */
function useClipboardCopy(timeoutMs = 1200) {
  const [copied, setCopied] = useState(false);
  const copyTimeoutRef = useRef<number | null>(null);

  useEffect(() => {
    return () => {
      if (copyTimeoutRef.current) {
        window.clearTimeout(copyTimeoutRef.current);
      }
    };
  }, []);

  const copyText = async (text: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      if (copyTimeoutRef.current) {
        window.clearTimeout(copyTimeoutRef.current);
      }
      copyTimeoutRef.current = window.setTimeout(() => {
        setCopied(false);
      }, timeoutMs);
    } catch {
      // No-op: clipboard errors can occur in restricted contexts.
    }
  };

  return {
    copied,
    copyText,
  };
}

/**
 * 将未知错误转换为可读文本。
 *
 * @param error 捕获到的未知错误。
 * @returns 用于展示的错误说明。
 */
function formatMermaidError(error: unknown) {
  if (error instanceof Error && error.message.trim()) {
    return error.message;
  }
  if (typeof error === "string" && error.trim()) {
    return error;
  }
  return "Mermaid 图渲染失败";
}

/**
 * 记录链接按下位置，用于区分普通点击和拖动划选文本。
 *
 * @returns 链接鼠标按下处理器，以及判断点击是否应被视为拖动的函数。
 */
function useLinkDragGuard() {
  const pointerStartRef = useRef<{ x: number; y: number } | null>(null);

  const handleMouseDown = useCallback((event: MouseEvent<Element>) => {
    if (event.button !== 0) {
      pointerStartRef.current = null;
      return;
    }
    pointerStartRef.current = {
      x: event.clientX,
      y: event.clientY,
    };
  }, []);

  const isDragClick = useCallback((event: MouseEvent<Element>) => {
    const start = pointerStartRef.current;
    pointerStartRef.current = null;
    if (!start) {
      return false;
    }
    const movementX = Math.abs(event.clientX - start.x);
    const movementY = Math.abs(event.clientY - start.y);
    return movementX > 3 || movementY > 3;
  }, []);

  return useMemo(
    () => ({
      handleMouseDown,
      isDragClick,
    }),
    [handleMouseDown, isDragClick],
  );
}

export function isStandaloneMarkdownTable(value: string) {
  const stripped = stripTrailingMemoryCitation(value);
  if (!stripped) {
    return false;
  }
  const normalized = normalizeStructuredReviewTables(normalizeListIndentation(stripped)).trim();
  if (!normalized) {
    return false;
  }
  const lines = normalized.split(/\r?\n/).filter((line) => line.trim().length > 0);
  if (lines.length < 2) {
    return false;
  }
  return lines.every((line) => /^\|.*\|\s*$/.test(line.trim()));
}

function extractUrlLines(value: string) {
  const lines = value.split(/\r?\n/);
  const urls = lines
    .map((line) => normalizeUrlLine(line))
    .filter((line): line is string => Boolean(line));
  const nonEmptyLines = lines.filter((line) => line.trim().length > 0);
  if (nonEmptyLines.length === 0) {
    return null;
  }
  if (urls.length !== nonEmptyLines.length) {
    return null;
  }
  return urls;
}

function normalizeListIndentation(value: string) {
  const lines = value.split(/\r?\n/);
  let inFence = false;
  let activeOrderedItem = false;
  let orderedBaseIndent = 4;
  let orderedIndentOffset: number | null = null;

  const countLeadingSpaces = (line: string) =>
    line.match(/^\s*/)?.[0].length ?? 0;
  const spaces = (count: number) => " ".repeat(Math.max(0, count));
  const normalized = lines.map((line) => {
    const fenceMatch = line.match(/^\s*(```|~~~)/);
    if (fenceMatch) {
      inFence = !inFence;
      activeOrderedItem = false;
      orderedIndentOffset = null;
      return line;
    }
    if (inFence) {
      return line;
    }
    if (!line.trim()) {
      return line;
    }

    const orderedMatch = line.match(/^(\s*)\d+\.\s+/);
    if (orderedMatch) {
      const rawIndent = orderedMatch[1].length;
      const normalizedIndent =
        rawIndent > 0 && rawIndent < 4 ? 4 : rawIndent;
      activeOrderedItem = true;
      orderedBaseIndent = normalizedIndent + 4;
      orderedIndentOffset = null;
      if (normalizedIndent !== rawIndent) {
        return `${spaces(normalizedIndent)}${line.trimStart()}`;
      }
      return line;
    }

    const bulletMatch = line.match(/^(\s*)([-*+])\s+/);
    if (bulletMatch) {
      const rawIndent = bulletMatch[1].length;
      let targetIndent = rawIndent;

      if (!activeOrderedItem && rawIndent > 0 && rawIndent < 4) {
        targetIndent = 4;
      }

      if (activeOrderedItem) {
        if (orderedIndentOffset === null && rawIndent < orderedBaseIndent) {
          orderedIndentOffset = orderedBaseIndent - rawIndent;
        }
        if (orderedIndentOffset !== null) {
          const adjustedIndent = rawIndent + orderedIndentOffset;
          if (adjustedIndent <= orderedBaseIndent + 12) {
            targetIndent = adjustedIndent;
          }
        }
      }

      if (targetIndent !== rawIndent) {
        return `${spaces(targetIndent)}${line.trimStart()}`;
      }
      return line;
    }

    const leadingSpaces = countLeadingSpaces(line);
    if (activeOrderedItem && leadingSpaces < orderedBaseIndent) {
      activeOrderedItem = false;
      orderedIndentOffset = null;
    }
    return line;
  });
  return normalized.join("\n");
}

function LinkBlock({ urls, linkDragGuard }: LinkBlockProps & { linkDragGuard: LinkDragGuard }) {
  return (
    <div className="markdown-linkblock">
      {urls.map((url, index) => (
        <a
          key={`${url}-${index}`}
          href={url}
          onMouseDown={linkDragGuard.handleMouseDown}
          onClick={(event) => {
            event.preventDefault();
            event.stopPropagation();
            if (linkDragGuard.isDragClick(event)) {
              return;
            }
            void openUrl(url);
          }}
        >
          {url}
        </a>
      ))}
    </div>
  );
}

function FileReferenceLink({
  href,
  rawPath,
  showFilePath,
  workspacePath,
  onClick,
  onContextMenu,
  linkDragGuard,
}: {
  href: string;
  rawPath: ParsedFileLocation;
  showFilePath: boolean;
  workspacePath?: string | null;
  onClick: (event: React.MouseEvent, path: ParsedFileLocation) => void;
  onContextMenu: (event: React.MouseEvent, path: ParsedFileLocation) => void;
  linkDragGuard: LinkDragGuard;
}) {
  const { fullPath, fileName, lineLabel, parentPath } = describeFileTarget(rawPath, workspacePath);
  return (
    <a
      href={href}
      className="message-file-link"
      title={fullPath}
      onMouseDown={linkDragGuard.handleMouseDown}
      onClick={(event) => onClick(event, rawPath)}
      onContextMenu={(event) => onContextMenu(event, rawPath)}
    >
      <span className="message-file-link-name">{fileName}</span>
      {lineLabel ? <span className="message-file-link-line">L{lineLabel}</span> : null}
      {showFilePath && parentPath ? (
        <span className="message-file-link-path">{parentPath}</span>
      ) : null}
    </a>
  );
}

function CodeBlock({ className, value, copyUseModifier }: CodeBlockProps) {
  const { copied, copyText } = useClipboardCopy();
  const languageTag = extractLanguageTag(className);
  const languageLabel = languageTag ?? "代码";
  const fencedValue = `\`\`\`${languageTag ?? ""}\n${value}\n\`\`\``;

  const handleCopy = async (event: MouseEvent<HTMLButtonElement>) => {
    const shouldFence = copyUseModifier ? event.altKey : true;
    const nextValue = shouldFence ? fencedValue : value;
    await copyText(nextValue);
  };

  return (
    <div className="markdown-codeblock">
      <div className="markdown-codeblock-header">
        <span className="markdown-codeblock-language">{languageLabel}</span>
        <button
          type="button"
          className={`ghost markdown-codeblock-copy${copied ? " is-copied" : ""}`}
          onClick={handleCopy}
          aria-label="复制代码块"
          title={copied ? "已复制" : "复制"}
        >
          {copied ? "已复制" : "复制"}
        </button>
      </div>
      <pre className="markdown-codeblock-body">
        <code
          className={className ? `${className} markdown-codeblock-content` : "markdown-codeblock-content"}
        >
          {value}
        </code>
      </pre>
    </div>
  );
}

/**
 * 渲染 Mermaid 代码块，失败时展示错误和原始源码。
 *
 * @param props Mermaid 代码块渲染参数。
 * @returns Mermaid 图组件。
 */
function MermaidBlock({ className, value, copyUseModifier }: MermaidBlockProps) {
  const { copied, copyText } = useClipboardCopy();
  const [state, setState] = useState<MermaidRenderState>(() => {
    const cachedSvg = mermaidSvgCache.get(value);
    return cachedSvg ? { status: "ready", svg: cachedSvg } : { status: "loading" };
  });
  const [renderId] = useState(() => {
    mermaidRenderId += 1;
    return `message-mermaid-${mermaidRenderId}`;
  });
  const fencedValue = `\`\`\`mermaid\n${value}\n\`\`\``;

  useEffect(() => {
    let active = true;
    const cachedSvg = mermaidSvgCache.get(value);
    if (cachedSvg) {
      setState({ status: "ready", svg: cachedSvg });
      return () => {
        active = false;
      };
    }
    setState((current) => (current.status === "ready" ? current : { status: "loading" }));
    renderCachedMermaidSvg(value, renderId)
      .then((svg) => {
        if (active) {
          setState({ status: "ready", svg });
        }
      })
      .catch((error: unknown) => {
        if (active) {
          setState({ status: "error", message: formatMermaidError(error) });
        }
      });

    return () => {
      active = false;
    };
  }, [renderId, value]);

  const handleCopy = async (event: MouseEvent<HTMLButtonElement>) => {
    const shouldFence = copyUseModifier ? event.altKey : true;
    const nextValue = shouldFence ? fencedValue : value;
    await copyText(nextValue);
  };

  return (
    <div className="markdown-mermaid">
      <div className="markdown-codeblock-header markdown-mermaid-header">
        <span className="markdown-codeblock-language">MERMAID</span>
        <button
          type="button"
          className={`ghost markdown-codeblock-copy${copied ? " is-copied" : ""}`}
          onClick={handleCopy}
          aria-label="复制 Mermaid 源码"
          title={copied ? "已复制" : "复制"}
        >
          {copied ? "已复制" : "复制"}
        </button>
      </div>
      <div className="markdown-mermaid-body">
        {state.status === "loading" ? (
          <div className="markdown-mermaid-placeholder">正在渲染 Mermaid 图...</div>
        ) : null}
        {state.status === "ready" ? (
          <div
            className="markdown-mermaid-svg"
            aria-label="Mermaid 图"
            dangerouslySetInnerHTML={{ __html: state.svg }}
          />
        ) : null}
        {state.status === "error" ? (
          <div className="markdown-mermaid-error">
            <div className="markdown-mermaid-error-title">Mermaid 图渲染失败</div>
            <div className="markdown-mermaid-error-message">{state.message}</div>
            <CodeBlock
              className={className}
              value={value}
              copyUseModifier={copyUseModifier}
            />
          </div>
        ) : null}
      </div>
    </div>
  );
}

function PreBlock({ node, children, copyUseModifier, linkDragGuard }: PreProps) {
  const { className, value } = extractCodeFromPre(node);
  if (!className && !value && children) {
    return <pre>{children}</pre>;
  }
  const urlLines = extractUrlLines(value);
  if (urlLines) {
    return <LinkBlock urls={urlLines} linkDragGuard={linkDragGuard} />;
  }
  const languageTag = extractLanguageTag(className);
  if (isMermaidLanguageTag(languageTag)) {
    return (
      <MermaidBlock
        className={className}
        value={value}
        copyUseModifier={copyUseModifier}
      />
    );
  }
  const isSingleLine = !value.includes("\n");
  if (isSingleLine) {
    return (
      <pre className="markdown-codeblock-single">
        <code
          className={className ? `${className} markdown-codeblock-content` : "markdown-codeblock-content"}
        >
          {value}
        </code>
      </pre>
    );
  }
  return (
    <CodeBlock
      className={className}
      value={value}
      copyUseModifier={copyUseModifier}
    />
  );
}

export function Markdown({
  value,
  className,
  codeBlock,
  codeBlockStyle = "default",
  codeBlockCopyUseModifier = false,
  showFilePath = true,
  workspacePath = null,
  onOpenFileLink,
  onOpenFileLinkMenu,
  onOpenThreadLink,
}: MarkdownProps) {
  const linkDragGuard = useLinkDragGuard();
  const onOpenFileLinkRef = useLatestRef(onOpenFileLink);
  const onOpenFileLinkMenuRef = useLatestRef(onOpenFileLinkMenu);
  const onOpenThreadLinkRef = useLatestRef(onOpenThreadLink);
  const hasOpenFileLinkMenu = Boolean(onOpenFileLinkMenu);
  const resolvedHrefFilePathCache = useRef(new Map<string, ParsedFileLocation | null>());
  const normalizedValue = useMemo(
    () =>
      codeBlock
        ? value
        : normalizeStructuredReviewTables(normalizeListIndentation(value)),
    [codeBlock, value],
  );
  const content = useMemo(
    () => (codeBlock ? `\`\`\`\n${normalizedValue}\n\`\`\`` : normalizedValue),
    [codeBlock, normalizedValue],
  );

  useEffect(() => {
    resolvedHrefFilePathCache.current.clear();
  }, [workspacePath]);

  const handleFileLinkClick = useCallback((event: React.MouseEvent, path: ParsedFileLocation) => {
    event.preventDefault();
    event.stopPropagation();
    if (linkDragGuard.isDragClick(event)) {
      return;
    }
    onOpenFileLinkRef.current?.(path);
  }, [linkDragGuard, onOpenFileLinkRef]);
  const handleLocalLinkClick = useCallback((event: React.MouseEvent) => {
    event.preventDefault();
    event.stopPropagation();
    linkDragGuard.isDragClick(event);
  }, [linkDragGuard]);
  const handleFileLinkContextMenu = useCallback((
    event: React.MouseEvent,
    path: ParsedFileLocation,
  ) => {
    event.preventDefault();
    event.stopPropagation();
    onOpenFileLinkMenuRef.current?.(event, path);
  }, [onOpenFileLinkMenuRef]);
  const resolveHrefFilePath = useCallback((url: string) => {
    if (resolvedHrefFilePathCache.current.has(url)) {
      return resolvedHrefFilePathCache.current.get(url) ?? null;
    }
    const resolvedPath = resolveMessageFileHref(url, workspacePath);
    if (!resolvedPath) {
      resolvedHrefFilePathCache.current.set(url, null);
      return null;
    }
    resolvedHrefFilePathCache.current.set(url, resolvedPath);
    return resolvedPath;
  }, [workspacePath]);
  const components: Components = useMemo(() => {
    const markdownComponents: Components = {
      table: ({ children }) => (
        <div className="markdown-table-wrap">
          <table className="markdown-table">{children}</table>
        </div>
      ),
      a: ({ href, children }) => {
        const url = (href ?? "").trim();
        const threadId = url.startsWith("thread://")
          ? url.slice("thread://".length).trim()
          : url.startsWith("/thread/")
            ? url.slice("/thread/".length).trim()
            : "";
        if (threadId) {
          return (
            <a
              href={href}
              onMouseDown={linkDragGuard.handleMouseDown}
              onClick={(event) => {
                event.preventDefault();
                event.stopPropagation();
                if (linkDragGuard.isDragClick(event)) {
                  return;
                }
                onOpenThreadLinkRef.current?.(threadId);
              }}
            >
              {children}
            </a>
          );
        }
        if (isFileLinkUrl(url)) {
          const path = parseFileLinkUrl(url);
          if (!path) {
            return (
              <a
                href={href}
                onMouseDown={linkDragGuard.handleMouseDown}
                onClick={(event) => {
                  event.preventDefault();
                  event.stopPropagation();
                  linkDragGuard.isDragClick(event);
                }}
              >
                {children}
              </a>
            );
          }
          return (
            <FileReferenceLink
              href={href ?? toFileLink(path)}
              rawPath={path}
              showFilePath={showFilePath}
              workspacePath={workspacePath}
              onClick={handleFileLinkClick}
              onContextMenu={handleFileLinkContextMenu}
              linkDragGuard={linkDragGuard}
            />
          );
        }
        const hrefFilePath = resolveHrefFilePath(url);
        if (hrefFilePath) {
          const formattedHrefFilePath = formatParsedFileLocation(hrefFilePath);
          const clickHandler = (event: React.MouseEvent) =>
            handleFileLinkClick(event, hrefFilePath);
          const contextMenuHandler = hasOpenFileLinkMenu
            ? (event: React.MouseEvent) => handleFileLinkContextMenu(event, hrefFilePath)
            : undefined;
          return (
            <a
              href={href ?? toFileLink(hrefFilePath)}
              title={formattedHrefFilePath}
              onMouseDown={linkDragGuard.handleMouseDown}
              onClick={clickHandler}
              onContextMenu={contextMenuHandler}
            >
              {children}
            </a>
          );
        }
        const isExternal =
          url.startsWith("http://") ||
          url.startsWith("https://") ||
          url.startsWith("mailto:");

        if (!isExternal) {
          if (url.startsWith("#")) {
            return <a href={href} onMouseDown={linkDragGuard.handleMouseDown}>{children}</a>;
          }
          return (
            <a
              href={href}
              onMouseDown={linkDragGuard.handleMouseDown}
              onClick={handleLocalLinkClick}
            >
              {children}
            </a>
          );
        }

        return (
          <a
            href={href}
            onMouseDown={linkDragGuard.handleMouseDown}
            onClick={(event) => {
              event.preventDefault();
              event.stopPropagation();
              if (linkDragGuard.isDragClick(event)) {
                return;
              }
              void openUrl(url);
            }}
          >
            {children}
          </a>
        );
      },
      code: ({ className: codeClassName, children }) => {
        if (codeClassName) {
          return <code className={codeClassName}>{children}</code>;
        }
        const text = String(children ?? "").trim();
        const fileTarget = parseInlineFileTarget(text);
        if (!fileTarget) {
          return <code className="markdown-inline-code">{children}</code>;
        }
        const href = toFileLink(fileTarget);
        return (
          <FileReferenceLink
            href={href}
            rawPath={fileTarget}
            showFilePath={showFilePath}
            workspacePath={workspacePath}
            onClick={handleFileLinkClick}
            onContextMenu={handleFileLinkContextMenu}
            linkDragGuard={linkDragGuard}
          />
        );
      },
    };

    if (codeBlockStyle === "message") {
      markdownComponents.pre = ({ node, children }) => (
        <PreBlock
          node={node as PreProps["node"]}
          copyUseModifier={codeBlockCopyUseModifier}
          linkDragGuard={linkDragGuard}
        >
          {children}
        </PreBlock>
      );
    }

    return markdownComponents;
  }, [
    codeBlockCopyUseModifier,
    codeBlockStyle,
    handleFileLinkClick,
    handleFileLinkContextMenu,
    handleLocalLinkClick,
    hasOpenFileLinkMenu,
    linkDragGuard,
    onOpenFileLinkMenuRef,
    onOpenThreadLinkRef,
    resolveHrefFilePath,
    showFilePath,
    workspacePath,
  ]);

  return (
    <div className={className}>
      <ReactMarkdown
        remarkPlugins={[remarkGfm, remarkFileLinks]}
        urlTransform={(url) => {
          const hasScheme = /^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(url);
          // Keep file-like hrefs intact before scheme sanitization runs, otherwise
          // Windows absolute paths such as C:/repo/file.ts look like unknown schemes.
          if (resolveHrefFilePath(url)) {
            return url;
          }
          if (
            isFileLinkUrl(url) ||
            url.startsWith("http://") ||
            url.startsWith("https://") ||
            url.startsWith("mailto:") ||
            url.startsWith("#") ||
            url.startsWith("/") ||
            url.startsWith("./") ||
            url.startsWith("../")
          ) {
            return url;
          }
          if (!hasScheme) {
            return url;
          }
          return "";
        }}
        components={components}
      >
        {content}
      </ReactMarkdown>
    </div>
  );
}

import {
  cloneElement,
  useCallback,
  useEffect,
  useMemo,
  useState,
  type FormEvent,
  type ReactElement,
} from "react";
import {
  WebSessionRequiredError,
  ensureWebBootstrap,
  getCachedWebBootstrap,
  getWebSessionEventName,
  loginWebSession,
} from "@services/runtime/webClient";

type WebRuntimeGateProps = {
  children: ReactElement;
};

type GateStatus = "checking" | "login" | "submitting" | "ready" | "error";

function errorMessage(error: unknown) {
  if (error instanceof Error && error.message.trim()) {
    return error.message.trim();
  }
  return "连接 Web 运行时失败，请稍后重试。";
}

/**
 * Web runtime 登录与 bootstrap 壳层。
 *
 * `children`：登录完成后渲染的应用根节点。
 *
 * @author lichong
 */
export function WebRuntimeGate({ children }: WebRuntimeGateProps) {
  const [status, setStatus] = useState<GateStatus>("checking");
  const [token, setToken] = useState("");
  const [message, setMessage] = useState<string | null>(null);
  const [sessionRevision, setSessionRevision] = useState(0);

  const bootstrap = useMemo(() => getCachedWebBootstrap(), [sessionRevision]);
  const appName = bootstrap?.app?.name?.trim() || "CodexMonitor";
  const appVersion = bootstrap?.app?.version?.trim() || null;

  /**
   * 拉取当前浏览器 session 对应的 bootstrap 数据。
   *
   * 无入参；成功后进入应用，失败时切换到登录或错误状态。
   */
  const hydrateBootstrap = useCallback(async () => {
    setStatus("checking");
    setMessage(null);
    try {
      await ensureWebBootstrap();
      setStatus("ready");
    } catch (error) {
      if (error instanceof WebSessionRequiredError) {
        setStatus("login");
        return;
      }
      setStatus("error");
      setMessage(errorMessage(error));
    }
  }, []);

  useEffect(() => {
    void hydrateBootstrap();
  }, [hydrateBootstrap]);

  useEffect(() => {
    if (typeof window === "undefined") {
      return undefined;
    }
    const eventName = getWebSessionEventName();
    const handleSessionChanged = (event: Event) => {
      const detail = (event as CustomEvent<{ authenticated?: boolean }>).detail;
      if (detail?.authenticated) {
        return;
      }
      setStatus("login");
      setMessage("登录已失效，请重新输入访问令牌。");
      setToken("");
      setSessionRevision((current) => current + 1);
    };
    window.addEventListener(eventName, handleSessionChanged as EventListener);
    return () => {
      window.removeEventListener(eventName, handleSessionChanged as EventListener);
    };
  }, []);

  /**
   * 提交登录令牌并在成功后刷新 bootstrap。
   *
   * `event`：表单提交事件。
   */
  const handleSubmit = useCallback(
    async (event: FormEvent<HTMLFormElement>) => {
      event.preventDefault();
      const nextToken = token.trim();
      if (!nextToken) {
        setMessage("请输入访问令牌。");
        setStatus("login");
        return;
      }
      setStatus("submitting");
      setMessage(null);
      try {
        await loginWebSession(nextToken);
        setSessionRevision((current) => current + 1);
        setStatus("ready");
        setToken("");
      } catch (error) {
        setStatus("login");
        setMessage(errorMessage(error));
      }
    },
    [token],
  );

  if (status === "ready") {
    return cloneElement(children, { key: `web-runtime-${sessionRevision}` });
  }

  const isBusy = status === "checking" || status === "submitting";
  const title =
    status === "error"
      ? "连接失败"
      : status === "checking"
        ? "正在连接"
        : "登录 Web 访问";
  const subtitle =
    status === "error"
      ? "守护进程已启动，但浏览器初始化失败。"
      : "请输入桌面端配置的远程访问令牌，完成 Web 版初始化。";

  return (
    <div className="web-runtime-gate">
      <div className="web-runtime-gate__ambient web-runtime-gate__ambient--left" />
      <div className="web-runtime-gate__ambient web-runtime-gate__ambient--right" />
      <div className="web-runtime-gate__panel">
        <div className="web-runtime-gate__eyebrow">
          <span className="web-runtime-gate__pulse" aria-hidden />
          Web MVP
        </div>
        <h1 className="web-runtime-gate__title">{title}</h1>
        <p className="web-runtime-gate__subtitle">{subtitle}</p>
        <div className="web-runtime-gate__meta">
          <span>{appName}</span>
          <span>{appVersion ? `版本 ${appVersion}` : "浏览器访问入口"}</span>
        </div>
        {message ? <div className="web-runtime-gate__message">{message}</div> : null}
        {status === "error" ? (
          <button
            type="button"
            className="web-runtime-gate__button"
            onClick={() => {
              void hydrateBootstrap();
            }}
          >
            重试连接
          </button>
        ) : (
          <form className="web-runtime-gate__form" onSubmit={handleSubmit}>
            <label className="web-runtime-gate__label" htmlFor="web-runtime-token">
              访问令牌
            </label>
            <input
              id="web-runtime-token"
              className="web-runtime-gate__input"
              type="password"
              autoComplete="current-password"
              placeholder="请输入 remoteBackendToken"
              value={token}
              disabled={isBusy}
              onChange={(event) => setToken(event.target.value)}
            />
            <button
              type="submit"
              className="web-runtime-gate__button"
              disabled={isBusy}
            >
              {status === "submitting" ? "登录中..." : status === "checking" ? "连接中..." : "进入应用"}
            </button>
          </form>
        )}
      </div>
    </div>
  );
}

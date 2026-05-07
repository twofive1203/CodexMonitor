import { useMemo } from "react";
import Activity from "lucide-react/dist/esm/icons/activity";
import AlertTriangle from "lucide-react/dist/esm/icons/alert-triangle";
import CheckCircle2 from "lucide-react/dist/esm/icons/check-circle-2";
import type { AccountSnapshot, WorkspaceInfo } from "../../../types";
import {
  MenuTrigger,
  PopoverSurface,
} from "../../design-system/components/popover/PopoverPrimitives";
import { useMenuController } from "../hooks/useMenuController";

type WorkspaceHealthButtonProps = {
  workspace: WorkspaceInfo;
  remoteThreadConnectionState: "live" | "polling" | "disconnected";
  gitError: string | null;
  accountInfo: AccountSnapshot | null;
  accountSupported: boolean;
  modelCount: number;
  skillCount: number;
  appCount: number;
};

type WorkspaceHealthRow = {
  id: string;
  label: string;
  value: string;
  ok: boolean;
  nextStep: string;
};

/**
 * 生成工作区健康面板的状态行。
 * @param props 当前工作区、远程连接、Git、账号和能力数量。
 */
function buildWorkspaceHealthRows({
  workspace,
  remoteThreadConnectionState,
  gitError,
  accountInfo,
  accountSupported,
  modelCount,
  skillCount,
  appCount,
}: WorkspaceHealthButtonProps): WorkspaceHealthRow[] {
  const accountLabel = accountSupported
    ? accountInfo?.email?.trim() || accountInfo?.type || "未登录"
    : "不需要登录";
  return [
    {
      id: "workspace",
      label: "工作区连接",
      value: workspace.connected ? "已连接" : "未连接",
      ok: workspace.connected,
      nextStep: workspace.connected ? "可继续使用当前工作区。" : "在侧栏重新连接该工作区。",
    },
    {
      id: "daemon",
      label: "远程会话",
      value:
        remoteThreadConnectionState === "live"
          ? "实时"
          : remoteThreadConnectionState === "polling"
            ? "轮询"
            : "断开",
      ok: remoteThreadConnectionState !== "disconnected",
      nextStep:
        remoteThreadConnectionState === "disconnected"
          ? "刷新会话或检查远程服务状态。"
          : "会话状态可用。",
    },
    {
      id: "git",
      label: "Git 状态",
      value: gitError ? "异常" : "可用",
      ok: !gitError,
      nextStep: gitError ? "打开 Git 面板查看错误并选择下一步。" : "Git 面板可用。",
    },
    {
      id: "account",
      label: "账号",
      value: accountLabel,
      ok: !accountSupported || Boolean(accountInfo),
      nextStep:
        !accountSupported || accountInfo
          ? "账号状态可用。"
          : "通过侧栏账号入口登录或切换账号。",
    },
    {
      id: "models",
      label: "模型",
      value: modelCount > 0 ? `${modelCount} 个可用` : "未加载",
      ok: modelCount > 0,
      nextStep: modelCount > 0 ? "模型可选择。" : "刷新工作区或检查提供方配置。",
    },
    {
      id: "tools",
      label: "Skills / Apps",
      value: `${skillCount} / ${appCount}`,
      ok: skillCount > 0 || appCount > 0,
      nextStep: skillCount > 0 || appCount > 0 ? "工具能力已加载。" : "检查工作区工具目录或实验功能开关。",
    },
  ];
}

/**
 * 渲染工作区健康状态按钮和弹出面板。
 * @param props 工作区健康状态所需的各项运行时输入。
 */
export function WorkspaceHealthButton(props: WorkspaceHealthButtonProps) {
  const menu = useMenuController();
  const rows = useMemo(() => buildWorkspaceHealthRows(props), [props]);
  const issueCount = rows.filter((row) => !row.ok).length;
  const HealthyIcon = issueCount > 0 ? AlertTriangle : CheckCircle2;

  return (
    <div className="workspace-health" ref={menu.containerRef}>
      <MenuTrigger
        isOpen={menu.isOpen}
        popupRole="dialog"
        className={`ghost main-header-action workspace-health-button${
          issueCount > 0 ? " has-issues" : ""
        }`}
        onClick={menu.toggle}
        data-tauri-drag-region="false"
        aria-label="工作区健康状态"
        title="工作区健康状态"
      >
        <Activity size={14} aria-hidden />
        <span className="workspace-health-count">{issueCount}</span>
      </MenuTrigger>
      {menu.isOpen && (
        <PopoverSurface className="workspace-health-popover" role="dialog">
          <div className="workspace-health-title">
            <HealthyIcon size={14} aria-hidden />
            <span>{issueCount > 0 ? "需要关注" : "状态正常"}</span>
          </div>
          <div className="workspace-health-list">
            {rows.map((row) => (
              <div key={row.id} className="workspace-health-row">
                <div className="workspace-health-row-main">
                  <span className="workspace-health-row-label">{row.label}</span>
                  <span className={row.ok ? "workspace-health-ok" : "workspace-health-warn"}>
                    {row.value}
                  </span>
                </div>
                <div className="workspace-health-next">{row.nextStep}</div>
              </div>
            ))}
          </div>
        </PopoverSurface>
      )}
    </div>
  );
}

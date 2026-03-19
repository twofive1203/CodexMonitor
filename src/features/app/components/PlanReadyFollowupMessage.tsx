import { useMemo, useState } from "react";

type PlanReadyFollowupMessageProps = {
  onAccept: () => void;
  onSubmitChanges: (changes: string) => void;
};

export function PlanReadyFollowupMessage({
  onAccept,
  onSubmitChanges,
}: PlanReadyFollowupMessageProps) {
  const [changes, setChanges] = useState("");
  const trimmed = useMemo(() => changes.trim(), [changes]);

  return (
    <div className="message request-user-input-message">
      <div
        className="bubble request-user-input-card"
        role="group"
        aria-label="计划已就绪"
      >
        <div className="request-user-input-header">
          <div className="request-user-input-title">计划已就绪</div>
        </div>
        <div className="request-user-input-body">
          <section className="request-user-input-question">
            <div className="request-user-input-question-text">
              按这个计划开始执行，或描述你希望调整的内容。
            </div>
            <textarea
              className="request-user-input-notes"
              placeholder="描述你希望如何调整这个计划..."
              value={changes}
              onChange={(event) => setChanges(event.target.value)}
              rows={3}
            />
          </section>
        </div>
        <div className="request-user-input-actions">
          <button
            type="button"
            className="plan-ready-followup-change"
            onClick={() => {
              if (!trimmed) {
                return;
              }
              onSubmitChanges(trimmed);
              setChanges("");
            }}
            disabled={!trimmed}
          >
            发送修改
          </button>
          <button type="button" className="primary" onClick={onAccept}>
            按此计划执行
          </button>
        </div>
      </div>
    </div>
  );
}

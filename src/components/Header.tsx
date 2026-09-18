import logoUrl from "../assets/logo.svg";

export type RunStatus = "idle" | "running" | "paused" | "goal";

export const STATUS_LABELS: Record<RunStatus, string> = {
  idle: "대기 중 Ready",
  running: "실행 중 Running",
  paused: "일시정지 Paused",
  goal: "목표 도착 Goal reached",
};

type Props = {
  status: RunStatus;
  onStart: () => void;
  onPause: () => void;
  onStep: () => void;
  onReset: () => void;
};

export function Header({ status, onStart, onPause, onStep, onReset }: Props) {
  const running = status === "running";
  const finished = status === "goal";

  return (
    <header className="panel header">
      <div className="brand">
        <img src={logoUrl} alt="" width={40} height={40} />
        <div>
          <h1>
            Neuro<span className="accent">Route</span>
          </h1>
          <p>Bio-inspired Navigation Lab</p>
        </div>
      </div>

      <div className="controls" role="toolbar" aria-label="시뮬레이션 제어">
        <button
          type="button"
          className="btn btn-primary"
          onClick={onStart}
          disabled={running || finished}
          aria-keyshortcuts="Space"
        >
          ▶ 시작
        </button>
        <button type="button" className="btn" onClick={onPause} disabled={!running} aria-keyshortcuts="Space">
          ❚❚ 일시정지
        </button>
        <button type="button" className="btn" onClick={onStep} disabled={running || finished} aria-keyshortcuts="S">
          ⏭ 한 단계
        </button>
        <button type="button" className="btn" onClick={onReset} aria-keyshortcuts="R">
          ↺ 초기화
        </button>
        <span className="status" data-status={status} role="status" aria-live="polite">
          <span className="status-dot" aria-hidden="true" />
          {STATUS_LABELS[status]}
        </span>
      </div>
    </header>
  );
}

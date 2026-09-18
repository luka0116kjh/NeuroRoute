import type { ControllerKind } from "../neuro/types";
import type { ScenarioInfo } from "../simulation/types";

export const ALGORITHMS: { id: ControllerKind; label: string; description: string }[] = [
  { id: "neuro", label: "Bio-inspired", description: "감각→중간→운동 뉴런 회로" },
  { id: "rule-based", label: "Rule-based", description: "if/else 거리 규칙" },
  { id: "random", label: "Random", description: "무작위 기준선" },
];

export const ALGORITHM_LABELS: Record<ControllerKind, string> = {
  neuro: "Bio-inspired",
  "rule-based": "Rule-based",
  random: "Random",
};

export type RunStats = {
  collisions: number;
  distance: number;
  elapsed: number;
  reachedGoal: boolean;
};

export type RunRecord = RunStats & {
  id: number;
  algorithm: ControllerKind;
  scenarioName: string;
};

export type ExperimentSettings = {
  algorithm: ControllerKind;
  scenarioId: string;
  speed: number;
  sensorRange: number;
  /** Normalised 0..1 danger threshold passed to the controller */
  dangerThreshold: number;
};

type Props = {
  settings: ExperimentSettings;
  scenarios: ScenarioInfo[];
  stats: RunStats;
  history: RunRecord[];
  onChange: (patch: Partial<ExperimentSettings>) => void;
  onClearHistory: () => void;
};

export const formatTime = (s: number) => `${s.toFixed(1)}s`;
export const formatDistance = (px: number) => `${Math.round(px)}px`;

export function ExperimentPanel({ settings, scenarios, stats, history, onChange, onClearHistory }: Props) {
  const scenarioDescription = scenarios.find((s) => s.id === settings.scenarioId)?.description;

  return (
    <section className="panel" aria-labelledby="experiment-title">
      <h2 id="experiment-title" className="panel-title">
        Experiment · 실험 패널
      </h2>
      <div className="experiment">
        <div className="field-grid">
          <div className="field">
            <fieldset>
              <legend>알고리즘</legend>
              <div className="algo-options">
                {ALGORITHMS.map((a) => (
                  <label className="algo-option" key={a.id}>
                    <input
                      type="radio"
                      name="algorithm"
                      value={a.id}
                      checked={settings.algorithm === a.id}
                      onChange={() => onChange({ algorithm: a.id })}
                    />
                    <span>
                      <strong>{a.label}</strong>{" "}
                      <span style={{ color: "var(--text-muted)", fontSize: "0.8rem" }}>{a.description}</span>
                    </span>
                  </label>
                ))}
              </div>
            </fieldset>
          </div>

          <div className="field">
            <label htmlFor="scenario-select">예제 맵</label>
            <select
              id="scenario-select"
              value={settings.scenarioId}
              onChange={(e) => onChange({ scenarioId: e.target.value })}
              aria-describedby="scenario-desc"
            >
              {scenarios.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </select>
            <p id="scenario-desc" className="field-help">
              {scenarioDescription}
            </p>

            <label htmlFor="speed-range" style={{ marginTop: 8 }}>
              실행 속도 <output htmlFor="speed-range">{settings.speed.toFixed(2)}×</output>
            </label>
            <input
              id="speed-range"
              type="range"
              min={0.25}
              max={4}
              step={0.25}
              value={settings.speed}
              onChange={(e) => onChange({ speed: Number(e.target.value) })}
            />
          </div>

          <div className="field">
            <label htmlFor="sensor-range">
              센서 범위 <output htmlFor="sensor-range">{settings.sensorRange}px</output>
            </label>
            <input
              id="sensor-range"
              type="range"
              min={40}
              max={300}
              step={10}
              value={settings.sensorRange}
              onChange={(e) => onChange({ sensorRange: Number(e.target.value) })}
            />

            <label htmlFor="danger-range" style={{ marginTop: 8 }}>
              위험 임계값 <output htmlFor="danger-range">{Math.round(settings.dangerThreshold * 100)}%</output>
            </label>
            <input
              id="danger-range"
              type="range"
              min={0.05}
              max={0.95}
              step={0.05}
              value={settings.dangerThreshold}
              onChange={(e) => onChange({ dangerThreshold: Number(e.target.value) })}
              aria-describedby="danger-help"
            />
            <p id="danger-help" className="field-help">
              위험도(0 = 멀리, 100% = 접촉)가 이 값을 넘으면 회피 뉴런이 반응합니다.
            </p>
          </div>
        </div>

        <div>
          <dl className="stats" aria-label="현재 실행 결과">
            <div className="stat" data-tone={stats.collisions > 0 ? "danger" : undefined}>
              <dt>충돌 횟수</dt>
              <dd>{stats.collisions}</dd>
            </div>
            <div className="stat">
              <dt>이동 거리</dt>
              <dd>{formatDistance(stats.distance)}</dd>
            </div>
            <div className="stat">
              <dt>경과 시간</dt>
              <dd>{formatTime(stats.elapsed)}</dd>
            </div>
            <div className="stat" data-tone={stats.reachedGoal ? "success" : "muted"}>
              <dt>목표 도착</dt>
              <dd>{stats.reachedGoal ? "성공 ✓" : "아직"}</dd>
            </div>
          </dl>

          <div className="sim-toolbar" style={{ marginBottom: 6 }}>
            <h3 className="panel-title" style={{ margin: 0 }}>
              실행 기록 ({history.length})
            </h3>
            <button type="button" className="btn btn-small" onClick={onClearHistory} disabled={history.length === 0}>
              실행 결과 초기화
            </button>
          </div>
          {history.length === 0 ? (
            <p className="empty-note">초기화하거나 목표에 도착하면 실행 결과가 여기에 기록됩니다.</p>
          ) : (
            <div className="history-wrap">
              <table className="history">
                <caption className="visually-hidden">최근 실행 기록</caption>
                <thead>
                  <tr>
                    <th scope="col">알고리즘</th>
                    <th scope="col">맵</th>
                    <th scope="col">시간</th>
                    <th scope="col">거리</th>
                    <th scope="col">충돌</th>
                    <th scope="col">도착</th>
                  </tr>
                </thead>
                <tbody>
                  {history.map((r) => (
                    <tr key={r.id}>
                      <td>{ALGORITHM_LABELS[r.algorithm]}</td>
                      <td>{r.scenarioName}</td>
                      <td>{formatTime(r.elapsed)}</td>
                      <td>{formatDistance(r.distance)}</td>
                      <td>{r.collisions}</td>
                      <td data-tone={r.reachedGoal ? "success" : "danger"}>{r.reachedGoal ? "✓" : "✗"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>
    </section>
  );
}

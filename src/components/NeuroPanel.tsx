import type { NeuralDecision, NeuronActivation, NeuronLayer } from "../neuro/types";
import type { MovementCommand, SensorReadings } from "../simulation/types";

export const COMMAND_LABELS: Record<MovementCommand, string> = {
  FORWARD: "전진 FORWARD",
  TURN_LEFT: "좌회전 TURN_LEFT",
  TURN_RIGHT: "우회전 TURN_RIGHT",
  STOP: "정지 STOP",
};

const LAYERS: { layer: NeuronLayer; title: string; subtitle: string }[] = [
  { layer: "sensory", title: "감각 뉴런", subtitle: "Sensory" },
  { layer: "interneuron", title: "중간 뉴런", subtitle: "Interneuron" },
  { layer: "motor", title: "운동 뉴런", subtitle: "Motor" },
];

// CSS uses the short name "inter" for the interneuron colour token.
const LAYER_CSS: Record<NeuronLayer, string> = {
  sensory: "sensory",
  interneuron: "inter",
  motor: "motor",
};

const pct = (v: number) => Math.round(Math.min(1, Math.max(0, v)) * 100);

function NeuronRow({ neuron }: { neuron: NeuronActivation }) {
  const value = pct(neuron.activation);
  return (
    <li className="neuron-row">
      <span className="neuron-name" title={neuron.label}>
        {neuron.label}
      </span>
      <div
        className="neuron-bar"
        role="meter"
        aria-label={`${neuron.label} 활성도`}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={value}
        aria-valuetext={`${value}%`}
      >
        <div className="neuron-bar-fill" style={{ width: `${value}%` }} />
      </div>
      <span className="neuron-value" aria-hidden="true">
        {value}%
      </span>
    </li>
  );
}

type Props = {
  decision: NeuralDecision | null;
  sensors: SensorReadings | null;
  sensorRange: number;
  /** Sensor distance (px) under which a reading is flagged as dangerous */
  dangerDistance: number;
};

export function NeuroPanel({ decision, sensors, sensorRange, dangerDistance }: Props) {
  const activations = decision?.activations ?? [];

  return (
    <section className="panel neuro-panel" aria-labelledby="neuro-title">
      <h2 id="neuro-title" className="panel-title">
        Neural State · 신경망 상태
      </h2>

      <div>
        <h3 className="panel-title" style={{ marginBottom: 8 }}>
          센서 거리 (최대 {Math.round(sensorRange)}px)
        </h3>
        <dl className="sensor-grid">
          {(["left", "center", "right"] as const).map((key) => {
            const value = sensors?.[key];
            const danger = value !== undefined && value < dangerDistance;
            return (
              <div className="sensor-cell" key={key} data-danger={danger}>
                <dt>{key === "left" ? "좌 Left" : key === "center" ? "중앙 Center" : "우 Right"}</dt>
                <dd>
                  {value === undefined ? "—" : `${Math.round(value)}px`}
                  {danger && <span className="visually-hidden"> (위험)</span>}
                </dd>
              </div>
            );
          })}
        </dl>
      </div>

      {LAYERS.map(({ layer, title, subtitle }) => {
        const neurons = activations.filter((n) => n.layer === layer);
        return (
          <div className="neuron-group" data-layer={LAYER_CSS[layer]} key={layer}>
            <h3>
              <span className="swatch" style={{ background: `var(--${LAYER_CSS[layer]})` }} aria-hidden="true" />
              {title} <span style={{ color: "var(--text-dim)", fontWeight: 400 }}>{subtitle}</span>
            </h3>
            {neurons.length > 0 ? (
              <ul className="neuron-list">
                {neurons.map((n) => (
                  <NeuronRow neuron={n} key={n.id} />
                ))}
              </ul>
            ) : (
              <p className="empty-note">이 컨트롤러는 해당 층의 활성도를 제공하지 않습니다.</p>
            )}
          </div>
        );
      })}

      {/* No aria-live here: it refreshes ~10×/s. The header status announces state changes. */}
      <div className="decision-card">
        <div className="decision-head">
          <span className="decision-action">{decision ? COMMAND_LABELS[decision.command] : "—"}</span>
          <span className="decision-confidence">
            confidence <strong>{decision ? `${pct(decision.confidence)}%` : "—"}</strong>
          </span>
        </div>
        <p className="decision-explanation">
          {decision?.explanation ?? "시뮬레이션을 시작하면 판단 근거가 표시됩니다."}
        </p>
        {decision?.warnings && decision.warnings.length > 0 && (
          <ul className="empty-note" style={{ margin: 0, paddingLeft: 18, color: "var(--warning)" }}>
            {decision.warnings.map((w) => (
              <li key={w}>{w}</li>
            ))}
          </ul>
        )}
      </div>
    </section>
  );
}

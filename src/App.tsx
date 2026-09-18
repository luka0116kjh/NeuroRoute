import { useEffect } from "react";
import { Header } from "./components/Header";
import { SimulationCanvas } from "./components/SimulationCanvas";
import { NeuroPanel } from "./components/NeuroPanel";
import { ExperimentPanel } from "./components/ExperimentPanel";
import { dangerDistance, useSimulation } from "./hooks/useSimulation";
import { useKeyboardShortcuts } from "./hooks/useKeyboardShortcuts";

export default function App() {
  const sim = useSimulation();
  const { status, settings, snapshot, start, pause, toggle, step, reset } = sim;
  const danger = dangerDistance(settings);

  useKeyboardShortcuts({ toggle, step, reset });

  useEffect(() => {
    document.title = status === "running" ? "▶ NeuroRoute" : "NeuroRoute — Bio-inspired Navigation Lab";
  }, [status]);

  return (
    <div className="app">
      <a className="skip-link" href="#experiment-title">
        실험 패널로 건너뛰기
      </a>
      <Header status={status} onStart={start} onPause={pause} onStep={step} onReset={reset} />

      <main className="workspace">
        <SimulationCanvas sim={sim} dangerDistance={danger} />
        <NeuroPanel
          decision={snapshot.decision}
          sensors={snapshot.sensors}
          sensorRange={settings.sensorRange}
          dangerDistance={danger}
        />
      </main>

      <ExperimentPanel
        settings={settings}
        scenarios={sim.scenarios}
        stats={snapshot.stats}
        history={sim.history}
        onChange={sim.updateSettings}
        onClearHistory={sim.clearHistory}
      />

      <footer className="footer">
        <p>
          NeuroRoute uses a simplified bio-inspired visual-to-motor model. It is an educational simulation and not a
          biologically complete reproduction of a fruit-fly brain.
        </p>
        <p>단축키: Space 시작/일시정지 · S 한 단계 · R 초기화</p>
      </footer>
    </div>
  );
}

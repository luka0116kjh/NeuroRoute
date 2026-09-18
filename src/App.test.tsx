import { act, fireEvent, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import App from "./App";

// Map the 800×600 world 1:1 onto the canvas' client rect.
beforeEach(() => {
  vi.spyOn(HTMLCanvasElement.prototype, "getBoundingClientRect").mockReturnValue({
    x: 0, y: 0, left: 0, top: 0, width: 800, height: 600, right: 800, bottom: 600, toJSON: () => ({}),
  } as DOMRect);
});

const stat = (label: string) => screen.getByText(label).nextElementSibling as HTMLElement;
const sensorCells = () => within(screen.getByRole("region", { name: /Neural State/ })).getAllByRole("definition");

describe("App", () => {
  it("renders the dashboard with header, canvas, neural and experiment panels", () => {
    render(<App />);
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent("NeuroRoute");
    expect(screen.getByText("Bio-inspired Navigation Lab")).toBeInTheDocument();
    expect(screen.getByTestId("sim-canvas")).toBeInTheDocument();
    expect(screen.getByText("감각 뉴런")).toBeInTheDocument();
    expect(screen.getByText("중간 뉴런")).toBeInTheDocument();
    expect(screen.getByText("운동 뉴런")).toBeInTheDocument();
  });

  it("shows live sensor distances and a controller decision before starting", () => {
    render(<App />);
    const cells = sensorCells();
    expect(cells).toHaveLength(3);
    for (const c of cells) expect(c.textContent).toMatch(/^\d+px/);
    expect(screen.getAllByRole("meter").length).toBeGreaterThan(3);
    expect(screen.getByText(/confidence/)).toBeInTheDocument();
  });

  it("start / pause / step / reset drive the run state", async () => {
    const user = userEvent.setup();
    render(<App />);
    const status = screen.getByText(/Ready/);

    await user.click(screen.getByRole("button", { name: /시작/ }));
    expect(status).toHaveTextContent(/Running/);
    expect(screen.getByRole("button", { name: /시작/ })).toBeDisabled();

    await user.click(screen.getByRole("button", { name: /일시정지/ }));
    expect(status).toHaveTextContent(/Paused/);

    const before = stat("경과 시간").textContent;
    for (let i = 0; i < 6; i++) await user.click(screen.getByRole("button", { name: /한 단계/ }));
    expect(stat("경과 시간").textContent).not.toBe(before);
    expect(stat("이동 거리").textContent).not.toBe("0px");

    await user.click(screen.getByRole("button", { name: "↺ 초기화" }));
    expect(status).toHaveTextContent(/Ready/);
    expect(stat("경과 시간")).toHaveTextContent("0.0s");
    expect(stat("이동 거리")).toHaveTextContent("0px");
    // The finished run is recorded in the history table.
    expect(screen.getByRole("table")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "실행 결과 초기화" }));
    expect(screen.queryByRole("table")).not.toBeInTheDocument();
  });

  it("switches between the three algorithms", async () => {
    const user = userEvent.setup();
    render(<App />);
    const interneurons = () => screen.getByText("중간 뉴런").closest(".neuron-group")!;
    expect(within(interneurons() as HTMLElement).queryAllByRole("meter").length).toBeGreaterThan(0);

    await user.click(screen.getByRole("radio", { name: /Rule-based/ }));
    expect(screen.getByRole("radio", { name: /Rule-based/ })).toBeChecked();
    // Baseline controllers expose only sensory activations.
    expect(within(interneurons() as HTMLElement).queryAllByRole("meter")).toHaveLength(0);

    await user.click(screen.getByRole("radio", { name: /Random/ }));
    expect(screen.getByRole("radio", { name: /Random/ })).toBeChecked();
    await user.click(screen.getByRole("button", { name: /한 단계/ }));
    expect(screen.getByText(/confidence/)).toBeInTheDocument();

    await user.click(screen.getByRole("radio", { name: /Bio-inspired/ }));
    expect(within(interneurons() as HTMLElement).queryAllByRole("meter").length).toBeGreaterThan(0);
  });

  it("adds an obstacle on click and removes it on right-click", () => {
    render(<App />);
    const canvas = screen.getByTestId("sim-canvas");
    fireEvent.click(canvas, { clientX: 400, clientY: 80 });
    expect(screen.getByText(/장애물을 추가했습니다/)).toBeInTheDocument();
    fireEvent.contextMenu(canvas, { clientX: 400, clientY: 80 });
    expect(screen.getByText(/장애물을 삭제했습니다/)).toBeInTheDocument();
  });

  it("supports a dedicated delete mode", async () => {
    const user = userEvent.setup();
    render(<App />);
    const canvas = screen.getByTestId("sim-canvas");
    fireEvent.click(canvas, { clientX: 400, clientY: 80 });
    await user.click(screen.getByRole("button", { name: /삭제 모드/ }));
    expect(screen.getByRole("button", { name: /삭제 모드/ })).toHaveAttribute("aria-pressed", "true");
    fireEvent.click(canvas, { clientX: 400, clientY: 80 });
    expect(screen.getByText(/장애물을 삭제했습니다/)).toBeInTheDocument();
  });

  it("changes map, speed, sensor range and danger threshold", async () => {
    render(<App />);
    fireEvent.change(screen.getByLabelText("예제 맵"), { target: { value: "maze" } });
    expect(screen.getByLabelText("예제 맵")).toHaveValue("maze");

    fireEvent.change(screen.getByRole("slider", { name: /센서 범위/ }), { target: { value: "250" } });
    expect(screen.getByText("센서 거리 (최대 250px)")).toBeInTheDocument();

    fireEvent.change(screen.getByRole("slider", { name: /위험 임계값/ }), { target: { value: "0.5" } });
    expect(screen.getByText("50%")).toBeInTheDocument();

    fireEvent.change(screen.getByRole("slider", { name: /실행 속도/ }), { target: { value: "2" } });
    expect(screen.getByText("2.00×")).toBeInTheDocument();
  });

  it("supports keyboard shortcuts", () => {
    render(<App />);
    const status = screen.getByText(/Ready/);
    act(() => {
      fireEvent.keyDown(document.body, { code: "Space", key: " " });
    });
    expect(status).toHaveTextContent(/Running/);
    act(() => {
      fireEvent.keyDown(document.body, { code: "Space", key: " " });
    });
    expect(status).toHaveTextContent(/Paused/);
    act(() => {
      fireEvent.keyDown(document.body, { key: "r" });
    });
    expect(status).toHaveTextContent(/Ready/);
  });

  it("does not drop a Space press that arrives before React re-renders", () => {
    render(<App />);
    const status = screen.getByText(/Ready/);
    act(() => {
      // Two presses in one task: the second must see the first one's state change.
      fireEvent.keyDown(document.body, { code: "Space", key: " " });
      fireEvent.keyDown(document.body, { code: "Space", key: " " });
    });
    expect(status).toHaveTextContent(/Paused/);
  });
});

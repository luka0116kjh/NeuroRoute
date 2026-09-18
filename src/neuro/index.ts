/**
 * NeuroRoute neural controller — public API.
 *
 * A simplified bio-inspired visual-to-motor circuit, not a biologically
 * complete fruit-fly brain simulation.
 *
 * 순수 TypeScript 계산 모듈. React/DOM/네트워크에 의존하지 않는다.
 */
export { DEFAULT_NEURO_CONFIG, NEURO_PRESETS, getPreset } from "./presets";
export type { NeuroPreset, NeuroPresetId } from "./presets";

export { createNeuroController, decideMovement } from "./controller";

export {
  ruleBasedController,
  randomController,
  createRuleBasedController,
  createRandomController,
  createController,
  CONTROLLER_OPTIONS,
  RANDOM_COMMAND_WEIGHTS
} from "./baselines";
export type { ControllerOption } from "./baselines";

export { NEURON_DEFINITIONS, SYNAPSE_DEFINITIONS, WEIGHTS, runCircuit } from "./circuit";
export type { CircuitResult, TurnSide } from "./circuit";

export { normalizeSensors, resolveConfig, clamp01 } from "./normalize";
export { createRng } from "./rng";

export type {
  ControllerKind,
  DecisionFunction,
  MovementCommand,
  NeuralDecision,
  NeuronActivation,
  NeuronDefinition,
  NeuronLayer,
  NeuroConfig,
  NeuroController,
  SensorReadings,
  SynapseDefinition
} from "./types";

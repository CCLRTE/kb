import {
  captureExitCode as captureExitCodeImplementation,
  captureSucceeded as captureSucceededImplementation,
  captureSummary as captureSummaryImplementation,
  main as clipMainImplementation,
  type ClipRuntimeOptions,
} from "./clip/cli.js";
import {
  runCapture as runCaptureImplementation,
  type CaptureAttempt,
  type CaptureDependencies,
  type CaptureOutcome,
} from "./clip/capture.js";
import {
  adapterCapabilities as installedAdapterCapabilities,
  inspectClipEnvironment as inspectClipEnvironmentImplementation,
  type DoctorReport,
} from "./clip/doctor.js";

// Explicit value assignments avoid a Bun bundler bug that can drop bindings
// used only by a re-exporting entrypoint.
export const adapterCapabilities = installedAdapterCapabilities;
export const captureExitCode: typeof captureExitCodeImplementation = (...arguments_) =>
  captureExitCodeImplementation(...arguments_);
export const captureSucceeded: typeof captureSucceededImplementation = (...arguments_) =>
  captureSucceededImplementation(...arguments_);
export const captureSummary: typeof captureSummaryImplementation = (...arguments_) =>
  captureSummaryImplementation(...arguments_);
export const clipMain: typeof clipMainImplementation = (...arguments_) =>
  clipMainImplementation(...arguments_);
export const inspectClipEnvironment: typeof inspectClipEnvironmentImplementation = (...arguments_) =>
  inspectClipEnvironmentImplementation(...arguments_);
export const runCapture: typeof runCaptureImplementation = (...arguments_) =>
  runCaptureImplementation(...arguments_);

export type {
  CaptureAttempt,
  CaptureDependencies,
  CaptureOutcome,
  ClipRuntimeOptions,
  DoctorReport,
};

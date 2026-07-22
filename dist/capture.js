// @bun
import {
  adapterCapabilities,
  captureExitCode,
  captureSucceeded,
  captureSummary,
  inspectClipEnvironment,
  main,
  runCapture
} from "./index-71w4dbh2.js";

// src/capture.ts
var adapterCapabilities2 = adapterCapabilities;
var captureExitCode2 = (...arguments_) => captureExitCode(...arguments_);
var captureSucceeded2 = (...arguments_) => captureSucceeded(...arguments_);
var captureSummary2 = (...arguments_) => captureSummary(...arguments_);
var clipMain = (...arguments_) => main(...arguments_);
var inspectClipEnvironment2 = (...arguments_) => inspectClipEnvironment(...arguments_);
var runCapture2 = (...arguments_) => runCapture(...arguments_);
export {
  runCapture2 as runCapture,
  inspectClipEnvironment2 as inspectClipEnvironment,
  clipMain,
  captureSummary2 as captureSummary,
  captureSucceeded2 as captureSucceeded,
  captureExitCode2 as captureExitCode,
  adapterCapabilities2 as adapterCapabilities
};

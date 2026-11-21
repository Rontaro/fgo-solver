// Web Worker entry: new Worker(new URL('./solver/worker.ts', import.meta.url), { type: 'module' }).
// The protocol (and the cancel semantics) lives in worker-handler.ts.
import { handleMessage, type InMsg, type OutMsg } from './worker-handler';

const ctx = self as unknown as {
  onmessage: ((e: MessageEvent<InMsg>) => void) | null;
  postMessage: (m: OutMsg) => void;
};
ctx.onmessage = (e) => { void handleMessage(e.data, (m) => ctx.postMessage(m)); };

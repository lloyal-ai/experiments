import { Agent, fetch } from 'undici';

// A long SDK deadline does not change Node's independent 300 s header limit.
// Keep the matching fetch/dispatcher pair, with no retries or queue limit.
export function benchmarkTransport(timeoutMs) {
 if (!Number.isSafeInteger(timeoutMs) || timeoutMs <= 0) throw new Error('Invalid transport timeout');
 const dispatcher = new Agent({ headersTimeout: timeoutMs, bodyTimeout: timeoutMs });
 return {
  fetch: (input, init) => fetch(input, { ...init, dispatcher }),
  close: () => dispatcher.close(),
  receipt: { implementation: 'undici', version: '8.11.2', headersTimeoutMs: timeoutMs, bodyTimeoutMs: timeoutMs, sdkTimeoutMs: timeoutMs, retries: 0 },
 };
}

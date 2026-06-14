import { spawn } from 'node:child_process';

const BUFFER_RESET_MS = 250;
const MAX_SCAN_WINDOW_MS = 1500;
const MIN_BARCODE_LENGTH = 4;

export function createScannerListener({ helperPath, onScan, onStateChange = () => {}, now = () => Date.now() }) {
  const state = {
    supported: process.platform === 'win32',
    enabled: false,
    active: false,
    status: process.platform === 'win32' ? 'ready' : 'unsupported',
    lastCapturedAt: null,
    lastBarcode: null,
    error: null
  };

  let child = null;
  let stdout = '';
  let scanBuffer = '';
  let scanStartedAt = 0;
  let lastKeyAt = 0;

  function emit() {
    onStateChange({ ...state });
  }

  function resetKeyboardBuffer() {
    scanBuffer = '';
    scanStartedAt = 0;
    lastKeyAt = 0;
  }

  async function processVirtualKey(vkCode) {
    const current = now();

    if (scanBuffer && current - lastKeyAt > BUFFER_RESET_MS) {
      resetKeyboardBuffer();
    }

    let digit = null;
    if (vkCode >= 48 && vkCode <= 57) {
      digit = String(vkCode - 48);
    } else if (vkCode >= 96 && vkCode <= 105) {
      digit = String(vkCode - 96);
    }

    if (digit) {
      if (!scanBuffer) {
        scanStartedAt = current;
      }
      scanBuffer += digit;
      lastKeyAt = current;
      return;
    }

    if (vkCode === 13) {
      const duration = scanStartedAt ? current - scanStartedAt : Infinity;
      const barcode = scanBuffer;
      resetKeyboardBuffer();

      if (barcode.length < MIN_BARCODE_LENGTH || duration > MAX_SCAN_WINDOW_MS) {
        return;
      }

      try {
        await onScan(barcode, {
          source: 'global-listener',
          note: 'Captured from keyboard listener'
        });
        state.lastCapturedAt = new Date().toISOString();
        state.lastBarcode = barcode;
        state.error = null;
        emit();
      } catch (error) {
        state.error = error.message;
        emit();
      }
      return;
    }

    if (vkCode !== 16) {
      resetKeyboardBuffer();
    }
  }

  function handleOutput(chunk) {
    stdout += chunk.toString('utf8');
    const lines = stdout.split(/\r?\n/);
    stdout = lines.pop() || '';

    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed) continue;

      const [eventState, vkCodeText] = trimmed.split(',');
      if (eventState !== 'DOWN') continue;

      const vkCode = Number(vkCodeText);
      if (Number.isFinite(vkCode)) {
        processVirtualKey(vkCode);
      }
    }
  }

  return {
    async start() {
      if (!state.supported) {
        emit();
        return state;
      }
      if (child) {
        return state;
      }

      child = spawn(helperPath, [], {
        stdio: ['ignore', 'pipe', 'pipe']
      });

      child.stdout.on('data', handleOutput);
      child.stderr.on('data', (chunk) => {
        state.error = chunk.toString('utf8').trim() || 'Keyboard helper error';
        state.status = 'error';
        emit();
      });
      child.on('error', (error) => {
        state.error = error.message;
        state.status = 'error';
        state.active = false;
        state.enabled = false;
        emit();
      });
      child.on('exit', (code) => {
        if (state.enabled && code !== 0) {
          state.error = `Keyboard helper exited with code ${code}`;
          state.status = 'error';
        }
        child = null;
        state.active = false;
        emit();
      });

      state.enabled = true;
      state.active = true;
      state.status = 'listening';
      state.error = null;
      emit();
      return state;
    },
    stop() {
      if (child) {
        child.kill();
      }
      child = null;
      stdout = '';
      resetKeyboardBuffer();
      state.enabled = false;
      state.active = false;
      state.status = state.supported ? 'paused' : 'unsupported';
      emit();
      return state;
    },
    getState() {
      return { ...state };
    }
  };
}

// Preferências de áudio/vídeo (salvas no navegador de cada um)
import { store, save } from '../ui.js';

export const CAMERA_PRESETS = {
  '2160p30': { label: '4K • 30 fps', width: 3840, height: 2160, fps: 30, kbps: 16000 },
  '1440p30': { label: '1440p • 30 fps', width: 2560, height: 1440, fps: 30, kbps: 10000 },
  '1080p60': { label: '1080p • 60 fps', width: 1920, height: 1080, fps: 60, kbps: 8000 },
  '1080p30': { label: '1080p • 30 fps', width: 1920, height: 1080, fps: 30, kbps: 5000 },
  '720p60': { label: '720p • 60 fps', width: 1280, height: 720, fps: 60, kbps: 4000 },
  '720p30': { label: '720p • 30 fps', width: 1280, height: 720, fps: 30, kbps: 2500 },
};

export const SCREEN_RESOLUTIONS = {
  native: { label: 'Original (resolução nativa)', width: null, height: null, kbps: 25000 },
  '2160': { label: '4K (2160p)', width: 3840, height: 2160, kbps: 25000 },
  '1440': { label: '1440p', width: 2560, height: 1440, kbps: 16000 },
  '1080': { label: '1080p', width: 1920, height: 1080, kbps: 10000 },
  '720': { label: '720p', width: 1280, height: 720, kbps: 5000 },
};

const DEFAULTS = {
  micDeviceId: 'default',
  camDeviceId: '',
  outputDeviceId: 'default',
  echoCancellation: true,
  noiseSuppression: true,
  autoGainControl: true,
  hifi: false, // desliga todo processamento e manda estéreo cru (música/instrumento)
  gateEnabled: false,
  gateDb: -50,
  micVolume: 1,
  camQuality: '1080p60',
  mirrorCam: true,
  codec: 'VP9',
  maxBitrateKbps: 50000,
  screenRes: 'native',
  screenFps: 60,
  screenContent: 'motion',
  screenAudio: true,
  restrictOwnAudio: true,
  showSelfPreview: true,
  showNonVideo: true,
  joinSounds: true,
  pttEnabled: false, // push-to-talk
  pttKey: 'KeyV',
};

let current = { ...DEFAULTS, ...store('settings', {}) };
const listeners = new Set();

export const settings = () => current;

export function updateSettings(patch) {
  current = { ...current, ...patch };
  save('settings', current);
  listeners.forEach((fn) => fn(current, patch));
}

export function onSettings(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

export function micConstraints(deviceId) {
  const s = current;
  const processing = !s.hifi;
  return {
    deviceId: deviceId && deviceId !== 'default' ? { exact: deviceId } : undefined,
    echoCancellation: processing && s.echoCancellation,
    noiseSuppression: processing && s.noiseSuppression,
    autoGainControl: processing && s.autoGainControl,
    channelCount: { ideal: 2 },
    sampleRate: { ideal: 48000 },
    sampleSize: { ideal: 24 },
    latency: { ideal: 0.01 },
  };
}

export function cameraConstraints(deviceId) {
  const p = CAMERA_PRESETS[current.camQuality] || CAMERA_PRESETS['1080p60'];
  return {
    deviceId: deviceId ? { exact: deviceId } : undefined,
    width: { ideal: p.width },
    height: { ideal: p.height },
    frameRate: { ideal: p.fps },
    aspectRatio: { ideal: 16 / 9 },
  };
}

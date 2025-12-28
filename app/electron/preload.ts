import { contextBridge, ipcRenderer } from 'electron';

console.log('Preload script loading...');

contextBridge.exposeInMainWorld('electronAPI', {
  getApiBaseUrl: () => "http://localhost:4789",
  setOverlayMode: (isOverlay: boolean) => ipcRenderer.send('ui:set-overlay-mode', isOverlay),
  setClickThrough: (enable: boolean) => ipcRenderer.send('ui:set-click-through', enable),
  setIgnoreMouseEvents: (ignore: boolean) => ipcRenderer.send('ui:set-mouse-ignore', ignore),
  // Listen for global hotkey from main process
  onToggleRecording: (callback: () => void) => {
    ipcRenderer.on('hotkey:toggle-recording', callback);
    // Return cleanup function
    return () => ipcRenderer.removeListener('hotkey:toggle-recording', callback);
  },
  onToggleOverlay: (callback: () => void) => {
    ipcRenderer.on('hotkey:toggle-overlay', callback);
    return () => ipcRenderer.removeListener('hotkey:toggle-overlay', callback);
  }
});


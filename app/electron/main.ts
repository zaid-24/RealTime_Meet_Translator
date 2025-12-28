import { app, BrowserWindow, ipcMain, screen, globalShortcut } from 'electron';
import path from 'path';
import { fileURLToPath } from 'url';
import express from 'express';
import cors from 'cors';
import axios from 'axios';
import fs from 'fs';

// --- Configuration & Paths ---
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Load embedded config if it exists (for standalone builds)
let EMBEDDED_SPEECH_KEY = "";
let EMBEDDED_SPEECH_REGION = "";

// In production/dist-electron, we look for embedded-config.json in the same folder
const embeddedConfigPath = path.join(__dirname, 'embedded-config.json');
if (fs.existsSync(embeddedConfigPath)) {
  try {
    const config = JSON.parse(fs.readFileSync(embeddedConfigPath, 'utf-8'));
    EMBEDDED_SPEECH_KEY = config.SPEECH_KEY || "";
    EMBEDDED_SPEECH_REGION = config.SPEECH_REGION || "";
    console.log('✅ Loaded embedded configuration');
  } catch (e) {
    console.error('❌ Failed to parse embedded-config.json', e);
  }
}

let mainWindow: BrowserWindow | null = null;
let normalBounds: Electron.Rectangle;

function createWindow() {
  const primaryDisplay = screen.getPrimaryDisplay();
  const { width, height } = primaryDisplay.workAreaSize;

  const preloadPath = path.resolve(__dirname, 'preload.js');
  console.log('Loading preload from:', preloadPath);

  mainWindow = new BrowserWindow({
    width: 800,
    height: 600,
    frame: false,
    transparent: true,
    backgroundColor: '#00000000',
    webPreferences: {
      preload: preloadPath,
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false
    },
  });

  // Initialize normalBounds
  normalBounds = mainWindow.getBounds();
  mainWindow.center();

  if (process.env.NODE_ENV === 'development') {
    mainWindow.loadURL('http://localhost:5173');
    // mainWindow.webContents.openDevTools();
  } else {
    mainWindow.loadFile(path.join(__dirname, '../dist/index.html'));
  }

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

// --- Local API Server ---
const server = express();
server.use(cors());

server.get('/health', (req, res) => {
  res.json({ ok: true });
});

server.get('/token', async (req, res) => {
  // Priority: Environment variables > Embedded config
  const speechKey = process.env.SPEECH_KEY || EMBEDDED_SPEECH_KEY;
  const speechRegion = process.env.SPEECH_REGION || EMBEDDED_SPEECH_REGION;

  if (!speechKey || !speechRegion) {
    res.status(500).json({ 
      error: 'Azure credentials not found. Set SPEECH_KEY and SPEECH_REGION environment variables, or use an embedded build.' 
    });
    return;
  }

  try {
    const response = await axios.post(
      `https://${speechRegion}.api.cognitive.microsoft.com/sts/v1.0/issueToken`,
      null,
      {
        headers: {
          'Ocp-Apim-Subscription-Key': speechKey,
          'Content-Type': 'application/x-www-form-urlencoded'
        }
      }
    );
    res.json({ token: response.data, region: speechRegion });
  } catch (error: any) {
    console.error('Token error:', error.response?.data || error.message);
    res.status(error.response?.status || 500).json({ 
      error: 'Failed to fetch token from Azure' 
    });
  }
});

const PORT = 4789;
server.listen(PORT, () => {
  console.log(`Local API server running on http://localhost:${PORT}`);
});

// --- App Lifecycle ---
app.whenReady().then(() => {
  createWindow();

  // Register Global Hotkeys
  globalShortcut.register('CommandOrControl+Shift+S', () => {
    if (mainWindow) {
      mainWindow.webContents.send('hotkey:toggle-recording');
    }
  });

  globalShortcut.register('CommandOrControl+Shift+D', () => {
    if (mainWindow) {
      mainWindow.webContents.send('hotkey:toggle-overlay');
    }
  });

  app.on('activate', function () {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', function () {
  if (process.platform !== 'darwin') app.quit();
});

app.on('will-quit', () => {
  globalShortcut.unregisterAll();
});

// --- IPC Handlers ---
ipcMain.on('ui:set-overlay-mode', (event, isOverlay) => {
  if (!mainWindow) return;

  if (isOverlay) {
    // Save current bounds before switching to overlay
    normalBounds = mainWindow.getBounds();
    
    const { width, height } = screen.getPrimaryDisplay().workAreaSize;
    const overlayWidth = width - 100;
    const overlayHeight = 180;
    const x = (width - overlayWidth) / 2;
    const y = height - overlayHeight - 20;

    mainWindow.setAlwaysOnTop(true, 'screen-saver');
    // Set bounds for overlay
    mainWindow.setBounds({ x, y, width: overlayWidth, height: overlayHeight }, true);
  } else {
    // Restore normal window
    mainWindow.setAlwaysOnTop(false);
    mainWindow.setIgnoreMouseEvents(false);
    // Restore saved bounds
    mainWindow.setBounds(normalBounds, true);
  }
});

ipcMain.on('ui:set-click-through', (event, enable) => {
  if (!mainWindow) return;
  mainWindow.setIgnoreMouseEvents(enable, { forward: true });
});

ipcMain.on('ui:set-mouse-ignore', (event, ignore) => {
  if (!mainWindow) return;
  mainWindow.setIgnoreMouseEvents(ignore, { forward: true });
});

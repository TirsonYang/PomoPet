import { app, BrowserWindow, ipcMain, Tray, Menu, nativeImage } from 'electron';
import path from 'node:path';
import { createRequire } from 'node:module';

// Handle creating/removing shortcuts on Windows when installing/uninstalling.
if (require('electron-squirrel-startup')) {
  app.quit();
}

// Set userData path to project directory for development/sandbox environment
// This avoids permission issues in some environments
app.setPath('userData', path.join(process.cwd(), 'userData'));

// Initialize Database using createRequire for better-sqlite3 compatibility
const requireNative = createRequire(import.meta.url);
const Database = requireNative('better-sqlite3');

let db;
let store;
let tray = null;
let isQuitting = false;

// Initialize Electron Store dynamically (ESM)
async function initStore() {
  const { default: Store } = await import('electron-store');
  store = new Store({
    defaults: {
      autoLaunch: false,
      clickThrough: false
    }
  });
}

function initDatabase() {
  const dbPath = path.join(app.getPath('userData'), 'pomopet.db');
  console.log('Database path:', dbPath);
  
  try {
    db = new Database(dbPath);
    // Enable WAL mode for better concurrency
    db.pragma('journal_mode = WAL');
    
    // Create tables
    const createTodos = `
      CREATE TABLE IF NOT EXISTS todos (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        text TEXT NOT NULL,
        completed BOOLEAN DEFAULT 0,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
      )
    `;
    
    const createSessions = `
      CREATE TABLE IF NOT EXISTS pomodoro_sessions (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        start_time DATETIME,
        end_time DATETIME,
        duration_seconds INTEGER,
        completed BOOLEAN DEFAULT 1
      )
    `;
    
    const createPetState = `
      CREATE TABLE IF NOT EXISTS pet_state (
        id INTEGER PRIMARY KEY CHECK (id=1),
        current_mood TEXT DEFAULT 'default',
        hunger_level INTEGER DEFAULT 0,
        last_fed_time DATETIME,
        total_coins INTEGER DEFAULT 0
      )
    `;
    
    db.exec(createTodos);
    db.exec(createSessions);
    db.exec(createPetState);
    
    // Initialize pet state if not exists
    const initPet = db.prepare('INSERT OR IGNORE INTO pet_state (id) VALUES (1)');
    initPet.run();
    
    console.log('Database initialized successfully');
  } catch (error) {
    console.error('Failed to initialize database:', error);
  }
}

// IPC Handlers
ipcMain.handle('todos:load', () => {
  try {
    const stmt = db.prepare('SELECT * FROM todos ORDER BY id DESC');
    return stmt.all();
  } catch (err) {
    console.error('todos:load error:', err);
    return [];
  }
});

ipcMain.handle('todos:add', (event, { text }) => {
  try {
    const stmt = db.prepare('INSERT INTO todos (text) VALUES (?)');
    const info = stmt.run(text);
    return info.lastInsertRowid;
  } catch (err) {
    console.error('todos:add error:', err);
    throw err;
  }
});

ipcMain.handle('todos:toggle', (event, { id, completed }) => {
  try {
    const stmt = db.prepare('UPDATE todos SET completed = ? WHERE id = ?');
    stmt.run(completed ? 1 : 0, id);
    return true;
  } catch (err) {
    console.error('todos:toggle error:', err);
    throw err;
  }
});

ipcMain.handle('todos:delete', (event, { id }) => {
  try {
    const stmt = db.prepare('DELETE FROM todos WHERE id = ?');
    stmt.run(id);
    return true;
  } catch (err) {
    console.error('todos:delete error:', err);
    throw err;
  }
});

ipcMain.handle('todos:clear-completed', () => {
  try {
    const stmt = db.prepare('DELETE FROM todos WHERE completed = 1');
    stmt.run();
    return true;
  } catch (err) {
    console.error('todos:clear-completed error:', err);
    throw err;
  }
});

// Pomodoro IPC Handlers
ipcMain.handle('pomodoro:save', (event, { startTime, endTime, duration, completed }) => {
  try {
    const stmt = db.prepare('INSERT INTO pomodoro_sessions (start_time, end_time, duration_seconds, completed) VALUES (?, ?, ?, ?)');
    stmt.run(startTime, endTime, duration, completed ? 1 : 0);
    return true;
  } catch (err) {
    console.error('pomodoro:save error:', err);
    throw err;
  }
});

ipcMain.handle('pomodoro:stats', () => {
  try {
    // Get today's stats (local time)
    const today = new Date().toISOString().split('T')[0];
    const stmt = db.prepare(`
      SELECT 
        COUNT(*) as count, 
        SUM(duration_seconds) as total_seconds 
      FROM pomodoro_sessions 
      WHERE date(start_time, 'localtime') = date('now', 'localtime') 
      AND completed = 1
    `);
    const result = stmt.get();
    return {
      count: result.count || 0,
      total_minutes: Math.round((result.total_seconds || 0) / 60)
    };
  } catch (err) {
    console.error('pomodoro:stats error:', err);
    return { count: 0, total_minutes: 0 };
  }
});

// Pet IPC Handlers
ipcMain.handle('pet:load', () => {
  try {
    const stmt = db.prepare('SELECT * FROM pet_state WHERE id = 1');
    const pet = stmt.get();
    if (!pet) {
      // Should have been initialized, but just in case
      const init = db.prepare('INSERT INTO pet_state (id) VALUES (1)');
      init.run();
      return { id: 1, current_mood: 'default', hunger_level: 0, total_coins: 0 };
    }
    return pet;
  } catch (err) {
    console.error('pet:load error:', err);
    return { id: 1, current_mood: 'default', hunger_level: 0, total_coins: 0 };
  }
});

ipcMain.handle('pet:save', (event, { current_mood, hunger_level, last_fed_time, total_coins }) => {
  try {
    const stmt = db.prepare(`
      UPDATE pet_state 
      SET current_mood = @current_mood, 
          hunger_level = @hunger_level, 
          last_fed_time = @last_fed_time, 
          total_coins = @total_coins 
      WHERE id = 1
    `);
    stmt.run({ current_mood, hunger_level, last_fed_time, total_coins });
    return true;
  } catch (err) {
    console.error('pet:save error:', err);
    throw err;
  }
});

// Tray Logic
function createTray(mainWindow) {
  // Create a simple icon if none provided (16x16 red dot)
  // Ideally, use a proper .ico or .png file from assets
  const icon = nativeImage.createFromDataURL('data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAABAAAAAQCAYAAAAf8/9hAAAAAXNSR0IArs4c6QAAADFJREFUOE9jZGBg+M9AAWAhRENY/6lR8B8Y/6lR8B8Y/6lR8B8Y/6lR8B8Y/6lR8B8YANlFAhF24k2dAAAAAElFTkSuQmCC');
  
  tray = new Tray(icon);
  tray.setToolTip('PomoPet');
  
  const updateContextMenu = () => {
    const autoLaunch = store.get('autoLaunch');
    const clickThrough = store.get('clickThrough');
    
    const contextMenu = Menu.buildFromTemplate([
      { 
        label: mainWindow.isVisible() ? '隐藏窗口' : '显示窗口', 
        click: () => toggleWindow(mainWindow) 
      },
      { type: 'separator' },
      { 
        label: '开机自启', 
        type: 'checkbox', 
        checked: autoLaunch,
        click: () => toggleAutoLaunch()
      },
      { 
        label: '窗口穿透', 
        type: 'checkbox', 
        checked: clickThrough,
        click: () => toggleClickThrough(mainWindow)
      },
      { type: 'separator' },
      { 
        label: '退出', 
        click: () => {
          isQuitting = true;
          app.quit();
        } 
      }
    ]);
    tray.setContextMenu(contextMenu);
  };

  tray.on('click', () => toggleWindow(mainWindow));
  
  // Initial menu
  updateContextMenu();
  
  // Expose update function for state changes
  return updateContextMenu;
}

function toggleWindow(mainWindow) {
  if (mainWindow.isVisible()) {
    mainWindow.hide();
  } else {
    mainWindow.show();
  }
  // Rebuild menu to update label
  // Since we don't have easy access to rebuild function here without passing it around,
  // we can rely on next right-click or improve structure.
  // For now, let's keep it simple.
}

function toggleAutoLaunch() {
  const current = store.get('autoLaunch');
  const next = !current;
  store.set('autoLaunch', next);
  
  app.setLoginItemSettings({
    openAtLogin: next,
    path: app.getPath('exe')
  });
  
  // Update tray menu if possible (requires reference)
  // For simplicity, we just update store. Next right-click will reflect.
}

function toggleClickThrough(mainWindow) {
  const current = store.get('clickThrough');
  const next = !current;
  store.set('clickThrough', next);
  
  mainWindow.setIgnoreMouseEvents(next, { forward: true });
  
  // Update tray menu if possible
}

const createWindow = async () => {
  // Ensure store is ready
  if (!store) await initStore();

  // Create the browser window.
  const mainWindow = new BrowserWindow({
    width: 800,
    height: 600,
    frame: false, // Frameless
    transparent: true, // Transparent for custom shapes/backgrounds
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      nodeIntegration: false,
      contextIsolation: true,
    },
    skipTaskbar: true // Don't show in taskbar if using tray (optional, user preference)
  });

  // Apply saved settings
  if (store.get('clickThrough')) {
    mainWindow.setIgnoreMouseEvents(true, { forward: true });
  }

  // Create Tray
  const updateTray = createTray(mainWindow);
  
  // Hook for updating tray when window visibility changes (optional refinement)
  mainWindow.on('show', updateTray);
  mainWindow.on('hide', updateTray);

  // Prevent closing, hide instead
  mainWindow.on('close', (event) => {
    if (!isQuitting) {
      event.preventDefault();
      mainWindow.hide();
    }
  });

  // and load the index.html of the app.
  if (MAIN_WINDOW_VITE_DEV_SERVER_URL) {
    mainWindow.loadURL(MAIN_WINDOW_VITE_DEV_SERVER_URL);
  } else {
    mainWindow.loadFile(path.join(__dirname, `../renderer/${MAIN_WINDOW_VITE_NAME}/index.html`));
  }

  // Open the DevTools.
  // mainWindow.webContents.openDevTools();
};

// --- Pomodoro Logic in Main Process ---
const DEFAULT_TIME = 25 * 60;
let pomodoroSecondsLeft = DEFAULT_TIME;
let pomodoroTotalSeconds = DEFAULT_TIME;
let pomodoroTimer = null;
let pomodoroActive = false;
let pomodoroStartTime = null;

function broadcastTick() {
  const windows = BrowserWindow.getAllWindows();
  windows.forEach(win => {
    if (!win.isDestroyed()) {
      win.webContents.send('pomodoro:tick', pomodoroSecondsLeft);
    }
  });
}

function broadcastCompleted() {
  const windows = BrowserWindow.getAllWindows();
  windows.forEach(win => {
    if (!win.isDestroyed()) {
      win.webContents.send('pomodoro:completed');
    }
  });
}

function stopPomodoro() {
  if (pomodoroTimer) {
    clearInterval(pomodoroTimer);
    pomodoroTimer = null;
  }
  pomodoroActive = false;
}

ipcMain.handle('pomodoro:start', () => {
  if (pomodoroActive) return;
  
  // Set start time if this is a fresh start (or resume)
  // If resuming, we might want to keep original start time, 
  // but to simplify logic and match previous "save" logic:
  // We'll capture start time now if not already set.
  // Note: If pausing and resuming, keeping original start time might be better,
  // but here we just ensure we have *a* start time for the record.
  if (!pomodoroStartTime) {
    pomodoroStartTime = new Date().toISOString();
  }

  stopPomodoro(); // Ensure no duplicates
  pomodoroActive = true;
  
  pomodoroTimer = setInterval(() => {
    pomodoroSecondsLeft--;
    broadcastTick();
    
    if (pomodoroSecondsLeft <= 0) {
      stopPomodoro();
      
      // Save session
      const endTime = new Date().toISOString();
      const stmt = db.prepare('INSERT INTO pomodoro_sessions (start_time, end_time, duration_seconds, completed) VALUES (?, ?, ?, ?)');
      stmt.run(pomodoroStartTime, endTime, pomodoroTotalSeconds, 1);
      
      pomodoroStartTime = null; // Reset for next
      pomodoroSecondsLeft = pomodoroTotalSeconds; // Reset time for next
      broadcastCompleted();
    }
  }, 1000);
});

ipcMain.handle('pomodoro:pause', () => {
  stopPomodoro();
});

ipcMain.handle('pomodoro:reset', () => {
  stopPomodoro();
  pomodoroSecondsLeft = pomodoroTotalSeconds;
  pomodoroStartTime = null;
  broadcastTick();
});

ipcMain.handle('pomodoro:get-state', () => {
  return {
    secondsLeft: pomodoroSecondsLeft,
    active: pomodoroActive
  };
});

// This method will be called when Electron has finished
// initialization and is ready to create browser windows.
app.whenReady().then(async () => {
  initDatabase();
  await initStore(); // Ensure store is loaded
  
  // Apply auto-launch setting on startup to ensure sync
  app.setLoginItemSettings({
    openAtLogin: store.get('autoLaunch'),
    path: app.getPath('exe')
  });

  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

app.on('window-all-closed', () => {
  stopPomodoro(); // Clean up timer
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

// Example IPC handler to expose DB operations safely (optional, but good practice)
// This is where you would add handlers for renderer requests

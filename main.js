const { app, BrowserWindow, Menu } = require('electron');
const path = require('path');
const fs = require('fs/promises');

const RUTA_INICIAL = path.join(__dirname, 'src', 'index.html');
// Debe configurarse antes de app.whenReady() para no heredar la ruta genérica de Electron.
const RUTA_DATOS = path.join(app.getPath('appData'), 'bardoclient');
const ARCHIVO_CONFIG = path.join(RUTA_DATOS, 'config.json');

app.setPath('userData', RUTA_DATOS);

async function prepararAlmacenamiento() {
  await fs.mkdir(app.getPath('userData'), { recursive: true });

  try {
    await fs.access(ARCHIVO_CONFIG);
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
    await fs.writeFile(ARCHIVO_CONFIG, JSON.stringify({ version: 1 }, null, 2), 'utf8');
  }
}

function crearVentanaPrincipal() {
  const ventana = new BrowserWindow({
    width: 1000,
    height: 600,
    resizable: false,
    title: 'Bardo Client',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true
    }
  });

  Menu.setApplicationMenu(null);
  ventana.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  ventana.webContents.on('page-title-updated', evento => evento.preventDefault());
  ventana.loadFile(RUTA_INICIAL);
}

app.whenReady().then(async () => {
  await prepararAlmacenamiento();
  crearVentanaPrincipal();
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) crearVentanaPrincipal();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

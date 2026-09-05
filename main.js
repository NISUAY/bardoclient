const { app, BrowserWindow, Menu } = require('electron');
const path = require('path');

const RUTA_INICIAL = path.join(__dirname, 'src', 'index.html');

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

app.whenReady().then(() => {
  crearVentanaPrincipal();
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) crearVentanaPrincipal();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

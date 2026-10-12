const { app, BrowserWindow, Menu, ipcMain, safeStorage } = require('electron');
const path = require('path');
const fs = require('fs/promises');
const { Client: MinecraftLauncherClient } = require('minecraft-launcher-core');
const { Auth } = require('msmc');

const NICK_VALIDO = /^[A-Za-z0-9_]{3,16}$/;
const RUTA_INICIAL = path.join(__dirname, 'src', 'index.html');
const RUTA_DATOS = path.join(app.getPath('appData'), 'bardoclient');
const ARCHIVO_CONFIG = path.join(RUTA_DATOS, 'config.json');
let colaDeConfig = Promise.resolve();
let loginMicrosoftEnCurso = false;

// Reserva explícita para la futura fase de arranque del juego con MCLC.
void MinecraftLauncherClient;
app.setPath('userData', RUTA_DATOS);

function normalizarConfig(config = {}) {
  const cuentaMicrosoft = config.tipoCuenta === 'microsoft';
  const cuentaOffline = config.tipoCuenta === 'offline';
  return {
    version: 1,
    ...(NICK_VALIDO.test(config.nick || '') && { nick: config.nick }),
    ...(cuentaMicrosoft || cuentaOffline ? { tipoCuenta: config.tipoCuenta } : {}),
    ...(cuentaMicrosoft && typeof config.token === 'string' ? { token: config.token } : { token: null }),
    ...(cuentaMicrosoft && typeof config.uuid === 'string' ? { uuid: config.uuid } : {})
  };
}

async function leerConfig() {
  try {
    return normalizarConfig(JSON.parse(await fs.readFile(ARCHIVO_CONFIG, 'utf8')));
  } catch (error) {
    if (error.code && error.code !== 'ENOENT') console.warn('[Bardo] config.json inválido:', error.message);
    return normalizarConfig();
  }
}

async function escribirConfig(cambios) {
  await fs.mkdir(app.getPath('userData'), { recursive: true });
  const config = normalizarConfig({ ...await leerConfig(), ...cambios });
  const temporal = `${ARCHIVO_CONFIG}.${process.pid}.${Date.now()}.tmp`;
  await fs.writeFile(temporal, JSON.stringify(config, null, 2), { encoding: 'utf8', mode: 0o600 });
  await fs.rename(temporal, ARCHIVO_CONFIG);
}

function actualizarConfig(cambios) {
  const tarea = colaDeConfig.then(() => escribirConfig(cambios));
  colaDeConfig = tarea.catch(() => undefined);
  return tarea;
}

function cifrarToken(token) {
  if (!safeStorage.isEncryptionAvailable()) {
    throw new Error('El cifrado seguro del sistema no está disponible.');
  }
  return `dpapi:${safeStorage.encryptString(token).toString('base64')}`;
}

async function prepararAlmacenamiento() {
  await fs.mkdir(app.getPath('userData'), { recursive: true });
  await colaDeConfig;
  try { await fs.access(ARCHIVO_CONFIG); }
  catch (error) {
    if (error.code !== 'ENOENT') throw error;
    await escribirConfig({});
  }
}

ipcMain.handle('config:guardar-nick', async (_evento, nick) => {
  if (typeof nick !== 'string' || !NICK_VALIDO.test(nick)) throw new Error('Nick inválido.');
  await actualizarConfig({ nick, tipoCuenta: 'offline', token: null, uuid: undefined });
  return { ok: true, username: nick };
});

// Perfil de sólo lectura: el renderer nunca recibe token ni credenciales.
ipcMain.handle('config:obtener-perfil', async () => {
  await colaDeConfig;
  const { nick, tipoCuenta, uuid } = await leerConfig();
  return { nick: nick || null, tipoCuenta: tipoCuenta || null, uuid: uuid || null };
});

ipcMain.handle('auth:cerrar-sesion', async () => {
  await actualizarConfig({ nick: undefined, tipoCuenta: undefined, token: null, uuid: undefined });
  return { ok: true };
});

ipcMain.handle('auth:microsoft', async () => {
  if (loginMicrosoftEnCurso) throw new Error('Ya hay un inicio de sesión en curso.');
  loginMicrosoftEnCurso = true;
  try {
    const auth = new Auth({
      client_id: '00000000402b5328',
      redirect: 'https://login.live.com/oauth20_desktop.srf',
      prompt: 'select_account'
    });
    const xbox = await auth.launch('electron', {
      parent: BrowserWindow.getFocusedWindow(),
      modal: true,
      width: 500,
      height: 650,
      resizable: false,
      title: 'Iniciar sesión con Microsoft',
      webPreferences: { nodeIntegration: false, contextIsolation: true, sandbox: true }
    });
    const minecraft = await xbox.getMinecraft();
    if (!minecraft.profile?.name || !minecraft.profile.id || !minecraft.mcToken) {
      throw new Error('Microsoft no devolvió un perfil válido de Minecraft Java.');
    }
    const credenciales = minecraft.getToken(true);
    const secretoCifrado = cifrarToken(JSON.stringify({
      accessToken: minecraft.mcToken,
      refreshToken: credenciales.refresh,
      expiraEn: credenciales.exp,
      xuid: credenciales.xuid
    }));
    await actualizarConfig({
      nick: minecraft.profile.name,
      tipoCuenta: 'microsoft',
      token: secretoCifrado,
      uuid: minecraft.profile.id
    });
    return { ok: true, username: minecraft.profile.name };
  } finally {
    loginMicrosoftEnCurso = false;
  }
});

function crearVentanaPrincipal() {
  const ventana = new BrowserWindow({
    width: 1000, height: 600, resizable: false, title: 'Bardo Client',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true, nodeIntegration: false, sandbox: true
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
  app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) crearVentanaPrincipal(); });
});
app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });

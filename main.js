const { app, BrowserWindow, Menu, ipcMain, safeStorage } = require('electron');
const path = require('path');
const fs = require('fs/promises');
const fsSync = require('fs');
const { spawnSync } = require('child_process');
const { Client, Authenticator } = require('minecraft-launcher-core');
const { Auth } = require('msmc');

const NICK_VALIDO = /^[A-Za-z0-9_]{3,16}$/;
const RUTA_INICIAL = path.join(__dirname, 'src', 'index.html');
const RUTA_DATOS = path.join(app.getPath('appData'), 'bardoclient');
const ARCHIVO_CONFIG = path.join(RUTA_DATOS, 'config.json');
const URL_MANIFIESTO_REMOTO = 'https://raw.githubusercontent.com/NISUAY/bardoclient/main/manifiesto.json';
const URL_META_FABRIC = 'https://meta.fabricmc.net/v2/versions/loader';
const CATALOGO_SERVIDORES_RESPALDO = Object.freeze([
  Object.freeze({
    id: 'srv_01',
    nombre: 'Hispanicraft',
    activo: true,
    versionMinecraft: '1.20.1',
    requiereMods: true,
    cargadorMods: 'fabric'
  })
]);
let colaDeConfig = Promise.resolve();
let loginMicrosoftEnCurso = false;
let juegoEnCurso = false;
let ventanaPrincipal = null;

app.setPath('userData', RUTA_DATOS);

function normalizarConfig(config = {}) {
  const cuentaMicrosoft = config.tipoCuenta === 'microsoft';
  const cuentaOffline = config.tipoCuenta === 'offline';
  return {
    version: 1,
    ...(NICK_VALIDO.test(config.nick || '') && { nick: config.nick }),
    ...(cuentaMicrosoft || cuentaOffline ? { tipoCuenta: config.tipoCuenta } : {}),
    ...(cuentaMicrosoft && typeof config.token === 'string' ? { token: config.token } : { token: null }),
    ...(cuentaMicrosoft && typeof config.uuid === 'string' ? { uuid: config.uuid } : {}),
    ram: Number.isInteger(config.ram) && config.ram >= 2 && config.ram <= 16 ? config.ram : 4
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

function normalizarCatalogoRemoto(manifiesto) {
  if (!manifiesto || !Array.isArray(manifiesto.servidores)) {
    throw new Error('El manifiesto remoto no contiene una lista de servidores válida.');
  }

  const servidores = manifiesto.servidores
    .filter(servidor => servidor && typeof servidor === 'object')
    .map(servidor => ({
      id: typeof servidor.id === 'string' ? servidor.id.trim() : '',
      nombre: typeof servidor.nombre === 'string' ? servidor.nombre.trim() : '',
      activo: servidor.activo !== false,
      versionMinecraft: typeof servidor.versionMinecraft === 'string' ? servidor.versionMinecraft.trim() : '',
      requiereMods: Boolean(servidor.requiereMods),
      cargadorMods: typeof servidor.cargadorMods === 'string' ? servidor.cargadorMods.trim() : 'vanilla'
    }))
    .filter(servidor => servidor.id && servidor.nombre && servidor.versionMinecraft);

  if (!servidores.length) throw new Error('El manifiesto remoto no contiene servidores utilizables.');
  return servidores;
}

async function descargarCatalogoRemoto() {
  const controlador = new AbortController();
  const temporizador = setTimeout(() => controlador.abort(), 8000);

  try {
    const respuesta = await fetch(URL_MANIFIESTO_REMOTO, {
      headers: { Accept: 'application/json' },
      signal: controlador.signal
    });
    if (!respuesta.ok) throw new Error(`Respuesta HTTP ${respuesta.status}.`);
    return normalizarCatalogoRemoto(await respuesta.json());
  } finally {
    clearTimeout(temporizador);
  }
}

ipcMain.handle('pizarra:leer-remota', async () => {
  try {
    return { servidores: await descargarCatalogoRemoto(), origen: 'remoto' };
  } catch (error) {
    console.warn('[Bardo] No se pudo leer el manifiesto remoto; se usará el catálogo de respaldo:', error.message);
    return { servidores: CATALOGO_SERVIDORES_RESPALDO, origen: 'respaldo' };
  }
});

ipcMain.handle('config:guardar-nick', async (_evento, nick) => {
  if (typeof nick !== 'string' || !NICK_VALIDO.test(nick)) throw new Error('Nick inválido.');
  await actualizarConfig({ nick, tipoCuenta: 'offline', token: null, uuid: undefined });
  return { ok: true, username: nick };
});

// Perfil de sólo lectura: el renderer nunca recibe token ni credenciales.
ipcMain.handle('config:obtener-perfil', async () => {
  await colaDeConfig;
  const { nick, tipoCuenta, uuid, ram } = await leerConfig();
  return { nick: nick || null, tipoCuenta: tipoCuenta || null, uuid: uuid || null, ram };
});

ipcMain.handle('config:guardar-ram', async (_evento, ram) => {
  const valor = Number(ram);
  if (!Number.isInteger(valor) || valor < 2 || valor > 16) throw new Error('La RAM debe estar entre 2 y 16 GB.');
  await actualizarConfig({ ram: valor });
  return { ok: true, ram: valor };
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

function enviarProgresoJuego(datos) {
  if (!ventanaPrincipal || ventanaPrincipal.isDestroyed()) return;
  ventanaPrincipal.webContents.send('juego:progreso', datos);
}

function normalizarInstanciaParaLanzamiento(instancia) {
  if (!instancia || typeof instancia !== 'object') throw new Error('No hay una instancia válida seleccionada.');

  const id = typeof instancia.id === 'string' ? instancia.id.trim() : '';
  const versionMinecraft = typeof instancia.versionMinecraft === 'string' ? instancia.versionMinecraft.trim() : '';
  const cargadorMods = typeof instancia.cargadorMods === 'string' ? instancia.cargadorMods.trim().toLowerCase() : 'vanilla';

  if (!/^[a-zA-Z0-9_-]{1,64}$/.test(id)) throw new Error('El ID de la instancia no es seguro.');
  if (!/^\d+\.\d+(?:\.\d+)?(?:-[A-Za-z0-9._-]+)?$/.test(versionMinecraft)) {
    throw new Error('La versión de Minecraft no es válida.');
  }

  if (!['vanilla', 'fabric'].includes(cargadorMods)) throw new Error('El cargador de mods no es compatible.');
  return { id, versionMinecraft, cargadorMods };
}

function porcentajeDeProgreso(progreso) {
  const total = Number(progreso?.total);
  const tarea = Number(progreso?.task);
  if (!Number.isFinite(total) || total <= 0 || !Number.isFinite(tarea)) return null;
  return Math.max(0, Math.min(100, Math.round((tarea / total) * 100)));
}

function obtenerVersionJava(ejecutable) {
  const resultado = spawnSync(ejecutable, ['-version'], {
    encoding: 'utf8',
    windowsHide: true,
    timeout: 5000
  });
  const salida = `${resultado.stdout || ''}\n${resultado.stderr || ''}`;
  const coincidencia = salida.match(/version\s+"([^"]+)"/i);
  if (resultado.error || !coincidencia) return null;

  const version = coincidencia[1];
  const mayor = Number(version.startsWith('1.') ? version.split('.')[1] : version.split('.')[0]);
  return Number.isInteger(mayor) ? { ejecutable, version, mayor } : null;
}

function resolverJavaCompatible() {
  const candidatos = [];
  const javaHome = process.env.JAVA_HOME;
  if (javaHome) {
    candidatos.push(path.join(javaHome, 'bin', 'javaw.exe'), path.join(javaHome, 'bin', 'java.exe'));
  }

  const programFiles = process.env.ProgramFiles || 'C:\\Program Files';
  for (const proveedor of ['Eclipse Adoptium', 'Java']) {
    const raiz = path.join(programFiles, proveedor);
    if (!fsSync.existsSync(raiz)) continue;
    let carpetas;
    try {
      carpetas = fsSync.readdirSync(raiz, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const carpeta of carpetas) {
      if (!carpeta.isDirectory()) continue;
      const bin = path.join(raiz, carpeta.name, 'bin');
      candidatos.push(path.join(bin, 'javaw.exe'), path.join(bin, 'java.exe'));
    }
  }

  // javaw evita abrir una consola negra al iniciar Minecraft en Windows.
  candidatos.push('javaw.exe', 'java.exe');

  const revisados = new Set();
  for (const candidato of candidatos) {
    if (revisados.has(candidato)) continue;
    revisados.add(candidato);
    const java = obtenerVersionJava(candidato);
    if (java?.mayor >= 17) return java;
  }
  return null;
}

async function descargarJson(url, mensajeError) {
  const controlador = new AbortController();
  const temporizador = setTimeout(() => controlador.abort(), 15000);
  try {
    const respuesta = await fetch(url, {
      signal: controlador.signal,
      headers: { Accept: 'application/json' }
    });
    if (!respuesta.ok) throw new Error(`HTTP ${respuesta.status}`);
    return await respuesta.json();
  } catch (error) {
    throw new Error(`${mensajeError}: ${error.message}`);
  } finally {
    clearTimeout(temporizador);
  }
}

async function existeArchivo(ruta) {
  try {
    await fs.access(ruta);
    return true;
  } catch {
    return false;
  }
}

async function prepararPerfilFabric(runtime, versionMinecraft) {
  const cargadores = await descargarJson(
    `${URL_META_FABRIC}/${encodeURIComponent(versionMinecraft)}`,
    `No se pudo consultar Fabric para Minecraft ${versionMinecraft}`
  );
  const seleccion = Array.isArray(cargadores)
    ? cargadores.find(entrada => entrada?.loader?.stable === true && typeof entrada.loader.version === 'string')
    : null;
  const versionLoader = seleccion?.loader?.version;
  if (!versionLoader || !/^[A-Za-z0-9._-]+$/.test(versionLoader)) {
    throw new Error(`Fabric no ofrece un Loader estable para Minecraft ${versionMinecraft}.`);
  }

  const perfil = await descargarJson(
    `${URL_META_FABRIC}/${encodeURIComponent(versionMinecraft)}/${encodeURIComponent(versionLoader)}/profile/json`,
    'No se pudo descargar el perfil de Fabric'
  );
  const idPerfil = typeof perfil?.id === 'string' ? perfil.id : '';
  if (!/^[A-Za-z0-9._-]+$/.test(idPerfil) || perfil.inheritsFrom !== versionMinecraft) {
    throw new Error('El perfil recibido de Fabric no es válido para esta versión de Minecraft.');
  }

  const carpetaPerfil = path.join(runtime, 'versions', idPerfil);
  const archivoPerfil = path.join(carpetaPerfil, `${idPerfil}.json`);
  if (!await existeArchivo(archivoPerfil)) {
    await fs.mkdir(carpetaPerfil, { recursive: true });
    await fs.writeFile(archivoPerfil, JSON.stringify(perfil, null, 2), 'utf8');
  }

  return { number: versionMinecraft, type: 'release', custom: idPerfil, idPerfil, versionLoader };
}

async function registrarDiagnosticoJuego(instanciaId, mensaje) {
  const rutaLog = path.join(app.getPath('userData'), 'instances', instanciaId, 'launcher.log');
  const seguro = String(mensaje).replace(/--accessToken\s+\S+/gi, '--accessToken [oculto]');
  await fs.appendFile(rutaLog, `[${new Date().toISOString()}] ${seguro}\n`, 'utf8');
}

ipcMain.handle('juego:lanzar', async (_evento, datos = {}) => {
  if (juegoEnCurso) return { ok: false, error: 'Ya hay un juego iniciándose o en ejecución.' };

  try {
    const instancia = normalizarInstanciaParaLanzamiento(datos.instancia);
    const config = await leerConfig();
    if (!config.nick) throw new Error('Debes iniciar sesión antes de lanzar el juego.');

    const ramSolicitada = Number(datos.ram ?? config.ram);
    const ram = Number.isInteger(ramSolicitada) && ramSolicitada >= 2 && ramSolicitada <= 16
      ? ramSolicitada
      : config.ram;
    const java = resolverJavaCompatible();
    if (!java) {
      throw new Error('Minecraft 1.20.1 requiere Java 17 o superior. Instala un JDK/JRE 17 de 64 bits y vuelve a abrir Bardo Client.');
    }
    const runtime = path.join(app.getPath('userData'), 'runtime');
    const gameDirectory = path.join(app.getPath('userData'), 'instances', instancia.id, '.minecraft');

    await fs.mkdir(runtime, { recursive: true });
    await fs.mkdir(gameDirectory, { recursive: true });

    juegoEnCurso = true;
    enviarProgresoJuego({ estado: 'preparando', mensaje: 'PREPARANDO JUEGO...' });

    const version = instancia.cargadorMods === 'fabric'
      ? await prepararPerfilFabric(runtime, instancia.versionMinecraft)
      : { number: instancia.versionMinecraft, type: 'release' };
    if (instancia.cargadorMods === 'fabric') {
      enviarProgresoJuego({ estado: 'preparando', mensaje: 'FABRIC PREPARADO. INICIANDO JUEGO...' });
    }

    const launcher = new Client();
    let ultimoDiagnostico = '';
    const registrarSalida = mensaje => {
      ultimoDiagnostico = String(mensaje).slice(-2000);
      registrarDiagnosticoJuego(instancia.id, mensaje).catch(error => {
        console.warn('[Bardo] No se pudo escribir el diagnostico del juego:', error.message);
      });
    };
    launcher.on('progress', progreso => {
      enviarProgresoJuego({
        estado: 'descargando',
        mensaje: `DESCARGANDO ${String(progreso?.type || 'ARCHIVOS').toUpperCase()}...`,
        porcentaje: porcentajeDeProgreso(progreso)
      });
    });
    launcher.on('debug', mensaje => {
      registrarSalida(mensaje);
      console.info('[MCLC]', String(mensaje).replace(/--accessToken\s+\S+/gi, '--accessToken [oculto]'));
      enviarProgresoJuego({ estado: 'preparando', mensaje: 'PREPARANDO ARCHIVOS DEL JUEGO...' });
    });
    launcher.on('data', mensaje => registrarSalida(mensaje));
    launcher.on('close', codigo => {
      juegoEnCurso = false;
      if (codigo === 0) {
        enviarProgresoJuego({ estado: 'cerrado', codigo, mensaje: 'JUGAR' });
      } else {
        enviarProgresoJuego({
          estado: 'error',
          codigo,
          mensaje: 'EL JUEGO SE CERRO CON ERROR.',
          diagnostico: ultimoDiagnostico
        });
      }
    });

    const proceso = await launcher.launch({
      authorization: await Authenticator.getAuth(config.nick),
      root: runtime,
      version,
      memory: { max: `${ram}G`, min: '2G' },
      javaPath: java.ejecutable,
      overrides: { gameDirectory }
    });

    if (!proceso) {
      juegoEnCurso = false;
      enviarProgresoJuego({ estado: 'error', mensaje: 'NO SE PUDO INICIAR EL JUEGO.' });
      return { ok: false, error: 'Minecraft no pudo iniciarse. Revisa Java y la consola del launcher.' };
    }

    enviarProgresoJuego({ estado: 'iniciado', mensaje: 'JUEGO INICIADO.' });
    return { ok: true, pid: proceso.pid, instanciaId: instancia.id, cargadorMods: instancia.cargadorMods };
  } catch (error) {
    juegoEnCurso = false;
    console.error('[Bardo] Error al lanzar Minecraft:', error);
    enviarProgresoJuego({ estado: 'error', mensaje: 'NO SE PUDO INICIAR EL JUEGO.' });
    return { ok: false, error: error.message || 'No se pudo iniciar el juego.' };
  }
});

function crearVentanaPrincipal() {
  ventanaPrincipal = new BrowserWindow({
    width: 1000, height: 600,
    minWidth: 1000, minHeight: 600,
    resizable: true, maximizable: true, title: 'Bardo Client',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true, nodeIntegration: false, sandbox: true
    }
  });
  ventanaPrincipal.setAspectRatio(1000 / 600);
  Menu.setApplicationMenu(null);
  ventanaPrincipal.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  ventanaPrincipal.webContents.on('page-title-updated', evento => evento.preventDefault());
  ventanaPrincipal.on('closed', () => { ventanaPrincipal = null; });
  ventanaPrincipal.loadFile(RUTA_INICIAL);
}

app.whenReady().then(async () => {
  await prepararAlmacenamiento();
  crearVentanaPrincipal();
  app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) crearVentanaPrincipal(); });
});
app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });

const { app, BrowserWindow, Menu, ipcMain, safeStorage } = require('electron');
const path = require('path');
const fs = require('fs/promises');
const fsSync = require('fs');
const os = require('os');
const { spawnSync } = require('child_process');
const { Client, Authenticator } = require('minecraft-launcher-core');
const { Auth } = require('msmc');

const NICK_VALIDO = /^[A-Za-z0-9_]{3,16}$/;
const RUTA_INICIAL = path.join(__dirname, 'src', 'index.html');
const RUTA_DATOS = path.join(app.getPath('appData'), 'bardoclient');
const ARCHIVO_CONFIG = path.join(RUTA_DATOS, 'config.json');
const URL_MANIFIESTO_REMOTO = 'https://raw.githubusercontent.com/NISUAY/bardoclient/main/manifiesto.json';
const URL_META_FABRIC = 'https://meta.fabricmc.net/v2/versions/loader';
const RAM_MINIMA_GB = 0.5;
const RAM_MAXIMA_GB = 32;
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
let instalacionEnCurso = false;
let ventanaPrincipal = null;
let catalogoRemotoEnSesion = null;

app.setPath('userData', RUTA_DATOS);

function obtenerLimiteRamRecomendado() {
  const totalGb = os.totalmem() / (1024 ** 3);
  const recomendado = Math.floor((totalGb - 1) * 10) / 10;
  return Math.max(1.5, Math.min(RAM_MAXIMA_GB, recomendado));
}

function normalizarRam(ram) {
  const valor = Number(ram);
  if (!Number.isFinite(valor)) return Math.min(4, obtenerLimiteRamRecomendado());
  return Math.round(Math.max(RAM_MINIMA_GB, Math.min(obtenerLimiteRamRecomendado(), valor)) * 10) / 10;
}

function opcionesMemoriaMclc(ramGb) {
  const maximoMb = Math.round(Number(ramGb) * 1024);
  return { max: maximoMb, min: Math.min(512, maximoMb) };
}

function normalizarConfig(config = {}) {
  const cuentaMicrosoft = config.tipoCuenta === 'microsoft';
  const cuentaOffline = config.tipoCuenta === 'offline';
  return {
    version: 1,
    ...(NICK_VALIDO.test(config.nick || '') && { nick: config.nick }),
    ...(cuentaMicrosoft || cuentaOffline ? { tipoCuenta: config.tipoCuenta } : {}),
    ...(cuentaMicrosoft && typeof config.token === 'string' ? { token: config.token } : { token: null }),
    ...(cuentaMicrosoft && typeof config.uuid === 'string' ? { uuid: config.uuid } : {}),
    ram: normalizarRam(config.ram),
    fullscreen: Boolean(config.fullscreen)
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

function descifrarToken(token) {
  if (typeof token !== 'string' || !token.startsWith('dpapi:')) {
    throw new Error('La sesión de Microsoft guardada no es válida. Inicia sesión nuevamente.');
  }
  if (!safeStorage.isEncryptionAvailable()) {
    throw new Error('El cifrado seguro del sistema no está disponible. Inicia sesión nuevamente.');
  }
  try {
    return JSON.parse(safeStorage.decryptString(Buffer.from(token.slice(6), 'base64')));
  } catch {
    throw new Error('No se pudo leer la sesión de Microsoft. Inicia sesión nuevamente.');
  }
}

function crearClienteMicrosoft() {
  return new Auth({
    client_id: '00000000402b5328',
    redirect: 'https://login.live.com/oauth20_desktop.srf',
    prompt: 'select_account'
  });
}

async function guardarSesionMicrosoft(minecraft) {
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
}

async function obtenerAutorizacionDeJuego(config) {
  if (config.tipoCuenta !== 'microsoft') return Authenticator.getAuth(config.nick);

  const sesion = descifrarToken(config.token);
  if (typeof sesion.refreshToken !== 'string' || !sesion.refreshToken) {
    throw new Error('La sesión de Microsoft expiró. Inicia sesión nuevamente.');
  }

  try {
    // Se renueva antes de lanzar: cubre tokens vencidos y mantiene la sesión oficial.
    const xbox = await crearClienteMicrosoft().refresh(sesion.refreshToken);
    const minecraft = await xbox.getMinecraft();
    await guardarSesionMicrosoft(minecraft);
    return minecraft.mclc();
  } catch (error) {
    console.warn('[Bardo] No se pudo renovar la sesión Microsoft:', error.message);
    throw new Error('La sesión de Microsoft ya no es válida. Inicia sesión nuevamente.');
  }
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
      cargadorMods: typeof servidor.cargadorMods === 'string' ? servidor.cargadorMods.trim() : 'vanilla',
      urlModpack: typeof servidor.urlModpack === 'string' ? servidor.urlModpack.trim() : '',
      versionModpack: typeof servidor.versionModpack === 'string' ? servidor.versionModpack.trim() : '',
      hashModpack: typeof servidor.hashModpack === 'string' ? servidor.hashModpack.trim() : ''
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
  if (catalogoRemotoEnSesion) {
    return { servidores: catalogoRemotoEnSesion, origen: 'memoria' };
  }
  try {
    const servidores = await descargarCatalogoRemoto();
    catalogoRemotoEnSesion = servidores;
    return { servidores, origen: 'remoto' };
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
  const { nick, tipoCuenta, uuid, ram, fullscreen } = await leerConfig();
  return { nick: nick || null, tipoCuenta: tipoCuenta || null, uuid: uuid || null, ram, fullscreen };
});

ipcMain.handle('config:guardar-ram', async (_evento, ram) => {
  const valor = Number(ram);
  const limite = obtenerLimiteRamRecomendado();
  if (!Number.isFinite(valor) || valor < RAM_MINIMA_GB || valor > limite) {
    throw new Error(`La RAM debe estar entre ${RAM_MINIMA_GB} y ${limite} GB.`);
  }
  const redondeado = Math.round(valor * 10) / 10;
  await actualizarConfig({ ram: redondeado });
  return { ok: true, ram: redondeado };
});

ipcMain.handle('config:obtener-ajustes', async () => {
  await colaDeConfig;
  const { ram, fullscreen } = await leerConfig();
  return {
    ram,
    fullscreen,
    ramMinima: RAM_MINIMA_GB,
    ramMaxima: obtenerLimiteRamRecomendado(),
    ramTotal: Math.floor((os.totalmem() / (1024 ** 3)) * 10) / 10
  };
});

ipcMain.handle('config:guardar-fullscreen', async (_evento, fullscreen) => {
  if (typeof fullscreen !== 'boolean') throw new Error('El valor de pantalla completa no es válido.');
  await actualizarConfig({ fullscreen });
  return { ok: true, fullscreen };
});

ipcMain.handle('auth:cerrar-sesion', async () => {
  await actualizarConfig({ nick: undefined, tipoCuenta: undefined, token: null, uuid: undefined });
  return { ok: true };
});

ipcMain.handle('auth:microsoft', async () => {
  if (loginMicrosoftEnCurso) throw new Error('Ya hay un inicio de sesión en curso.');
  loginMicrosoftEnCurso = true;
  try {
    const auth = crearClienteMicrosoft();
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
    await guardarSesionMicrosoft(minecraft);
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
  const nombre = typeof instancia.nombre === 'string' ? instancia.nombre.trim() : '';
  const versionMinecraft = typeof instancia.versionMinecraft === 'string' ? instancia.versionMinecraft.trim() : '';
  const cargadorMods = typeof instancia.cargadorMods === 'string' ? instancia.cargadorMods.trim().toLowerCase() : 'vanilla';
  const requiereMods = Boolean(instancia.requiereMods);

  if (!/^[a-zA-Z0-9_-]{1,64}$/.test(id)) throw new Error('El ID de la instancia no es seguro.');
  if (!/^\d+\.\d+(?:\.\d+)?(?:-[A-Za-z0-9._-]+)?$/.test(versionMinecraft)) {
    throw new Error('La versión de Minecraft no es válida.');
  }

  if (!['vanilla', 'fabric'].includes(cargadorMods)) throw new Error('El cargador de mods no es compatible.');
  const urlModpack = typeof instancia.urlModpack === 'string' ? instancia.urlModpack.trim() : '';
  const versionModpack = typeof instancia.versionModpack === 'string' ? instancia.versionModpack.trim() : '';
  const hashModpack = typeof instancia.hashModpack === 'string' ? instancia.hashModpack.trim() : '';
  if (urlModpack && !/^https:\/\//i.test(urlModpack)) throw new Error('La URL del modpack debe usar HTTPS.');
  return { id, nombre, versionMinecraft, cargadorMods, requiereMods, urlModpack, versionModpack, hashModpack };
}

function rutaInstancia(id) {
  return path.join(app.getPath('userData'), 'instances', id);
}

function rutaEstadoInstalacion(id) {
  return path.join(rutaInstancia(id), 'estado-instalacion.json');
}

function datosClaveInstancia(instancia) {
  return {
    id: instancia.id,
    versionMinecraft: instancia.versionMinecraft,
    cargadorMods: instancia.cargadorMods,
    requiereMods: instancia.requiereMods,
    urlModpack: instancia.urlModpack || null,
    versionModpack: instancia.versionModpack || null,
    hashModpack: instancia.hashModpack || null
  };
}

function huellaInstancia(instancia) {
  return JSON.stringify(datosClaveInstancia(instancia));
}

async function leerEstadoInstalacion(instancia) {
  try {
    const estado = JSON.parse(await fs.readFile(rutaEstadoInstalacion(instancia.id), 'utf8'));
    if (estado?.huella !== huellaInstancia(instancia)) return { estado: 'desactualizado' };
    return { estado: 'listo' };
  } catch (error) {
    if (error.code !== 'ENOENT') console.warn('[Bardo] Estado de instalación inválido:', error.message);
    return { estado: 'no-instalado' };
  }
}

async function guardarEstadoInstalacion(instancia) {
  const archivo = rutaEstadoInstalacion(instancia.id);
  const temporal = `${archivo}.${process.pid}.${Date.now()}.tmp`;
  const contenido = {
    esquema: 1,
    huella: huellaInstancia(instancia),
    instancia: datosClaveInstancia(instancia),
    instaladoEn: new Date().toISOString()
  };
  await fs.mkdir(path.dirname(archivo), { recursive: true });
  await fs.writeFile(temporal, JSON.stringify(contenido, null, 2), 'utf8');
  await fs.rename(temporal, archivo);
}

async function escribirInfoInstancia(instancia) {
  const contenido = [
    `Nombre: ${instancia.nombre || instancia.id}`,
    `ID: ${instancia.id}`,
    `Versión: ${instancia.versionMinecraft}`,
    `Cargador: ${instancia.cargadorMods}`,
    ''
  ].join('\r\n');
  await fs.writeFile(path.join(rutaInstancia(instancia.id), 'info.txt'), contenido, 'utf8');
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

  const archivoBase = path.join(runtime, 'versions', versionMinecraft, `${versionMinecraft}.json`);
  let base;
  try {
    base = JSON.parse(await fs.readFile(archivoBase, 'utf8'));
  } catch {
    throw new Error(`No se encontró el perfil base de Minecraft ${versionMinecraft}.`);
  }
  const mezclarArgumentos = (clave) => [
    ...(Array.isArray(base.arguments?.[clave]) ? base.arguments[clave] : []),
    ...(Array.isArray(perfil.arguments?.[clave]) ? perfil.arguments[clave] : [])
  ];
  const perfilMaterializado = {
    ...base,
    ...perfil,
    id: idPerfil,
    inheritsFrom: undefined,
    libraries: [...(base.libraries || []), ...(perfil.libraries || [])],
    arguments: { game: mezclarArgumentos('game'), jvm: mezclarArgumentos('jvm') }
  };

  const carpetaPerfil = path.join(runtime, 'versions', idPerfil);
  const archivoPerfil = path.join(carpetaPerfil, `${idPerfil}.json`);
  await fs.mkdir(carpetaPerfil, { recursive: true });
  await fs.writeFile(archivoPerfil, JSON.stringify(perfilMaterializado, null, 2), 'utf8');

  return { number: idPerfil, type: 'release', custom: idPerfil, idPerfil, versionLoader };
}

async function registrarDiagnosticoJuego(instanciaId, mensaje) {
  const rutaLog = path.join(app.getPath('userData'), 'instances', instanciaId, 'launcher.log');
  const seguro = String(mensaje).replace(/--accessToken\s+\S+/gi, '--accessToken [oculto]');
  await fs.appendFile(rutaLog, `[${new Date().toISOString()}] ${seguro}\n`, 'utf8');
}

async function repararArchivosCliente() {
  if (juegoEnCurso || instalacionEnCurso) throw new Error('Cierra el juego o espera a que termine la instalación antes de reparar.');

  const runtime = path.join(app.getPath('userData'), 'runtime');
  const instances = path.join(app.getPath('userData'), 'instances');
  await fs.rm(runtime, { recursive: true, force: true });

  let entradas = [];
  try {
    entradas = await fs.readdir(instances, { withFileTypes: true });
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
  }
  await Promise.all(entradas
    .filter(entrada => entrada.isDirectory())
    .map(entrada => fs.rm(path.join(instances, entrada.name, 'estado-instalacion.json'), { force: true })));

  return { ok: true };
}

ipcMain.handle('cliente:reparar-archivos', async () => {
  try {
    return await repararArchivosCliente();
  } catch (error) {
    console.error('[Bardo] Error al reparar archivos:', error);
    return { ok: false, error: error.message || 'No se pudieron reparar los archivos.' };
  }
});

async function descargarRecursosConMclc({ instancia, config, java, runtime, gameDirectory, version, minecraftJar }) {
  const launcher = new Client();
  launcher.startMinecraft = () => ({ pid: null, instalacion: true });
  launcher.on('progress', progreso => {
    enviarProgresoJuego({
      estado: 'descargando',
      mensaje: `DESCARGANDO ${String(progreso?.type || 'ARCHIVOS').toUpperCase()}...`,
      porcentaje: porcentajeDeProgreso(progreso)
    });
  });
  launcher.on('debug', mensaje => {
    registrarDiagnosticoJuego(instancia.id, mensaje).catch(() => undefined);
    enviarProgresoJuego({ estado: 'preparando', mensaje: 'PREPARANDO ARCHIVOS DEL JUEGO...' });
  });

  const resultado = await launcher.launch({
    authorization: await Authenticator.getAuth(config.nick),
    root: runtime,
    version,
    memory: opcionesMemoriaMclc(config.ram),
    javaPath: java.ejecutable,
    overrides: { gameDirectory, ...(minecraftJar ? { minecraftJar } : {}) }
  });
  if (!resultado?.instalacion) throw new Error('No se pudieron descargar los recursos de Minecraft.');
}

ipcMain.handle('instancia:verificar-estado', async (_evento, datos = {}) => {
  try {
    const instancia = normalizarInstanciaParaLanzamiento(datos.instancia || datos);
    return await leerEstadoInstalacion(instancia);
  } catch (error) {
    return { estado: 'no-instalado', error: error.message || 'Instancia inválida.' };
  }
});

ipcMain.handle('instancia:instalar', async (_evento, datos = {}) => {
  if (juegoEnCurso || instalacionEnCurso) return { ok: false, error: 'Ya hay una instalación o un juego en curso.' };

  try {
    const instancia = normalizarInstanciaParaLanzamiento(datos.instancia);
    const config = await leerConfig();
    if (!config.nick) throw new Error('Debes iniciar sesión antes de instalar la instancia.');
    const java = resolverJavaCompatible();
    if (!java) throw new Error('Minecraft 1.20.1 requiere Java 17 o superior.');

    const runtime = path.join(app.getPath('userData'), 'runtime');
    const gameDirectory = path.join(rutaInstancia(instancia.id), '.minecraft');
    await fs.mkdir(gameDirectory, { recursive: true });
    instalacionEnCurso = true;
    enviarProgresoJuego({ estado: 'preparando', mensaje: 'PREPARANDO INSTALACIÓN...' });

    await descargarRecursosConMclc({
      instancia,
      config,
      java,
      runtime,
      gameDirectory,
      version: { number: instancia.versionMinecraft, type: 'release' }
    });

    if (instancia.cargadorMods === 'fabric') {
      enviarProgresoJuego({ estado: 'preparando', mensaje: 'INSTALANDO FABRIC...' });
      const versionFabric = await prepararPerfilFabric(runtime, instancia.versionMinecraft);
      const jarVanilla = path.join(runtime, 'versions', instancia.versionMinecraft, `${instancia.versionMinecraft}.jar`);
      await descargarRecursosConMclc({
        instancia,
        config,
        java,
        runtime,
        gameDirectory,
        version: versionFabric,
        minecraftJar: jarVanilla
      });
    }

    await guardarEstadoInstalacion(instancia);
    await escribirInfoInstancia(instancia);
    instalacionEnCurso = false;
    enviarProgresoJuego({ estado: 'instalado', mensaje: 'JUGAR' });
    return { ok: true, estado: 'listo' };
  } catch (error) {
    instalacionEnCurso = false;
    console.error('[Bardo] Error al instalar la instancia:', error);
    enviarProgresoJuego({ estado: 'error', mensaje: 'NO SE PUDO INSTALAR.' });
    return { ok: false, error: error.message || 'No se pudo instalar la instancia.' };
  }
});

ipcMain.handle('juego:lanzar', async (_evento, datos = {}) => {
  if (juegoEnCurso) return { ok: false, error: 'Ya hay un juego iniciándose o en ejecución.' };

  try {
    const instancia = normalizarInstanciaParaLanzamiento(datos.instancia);
    const config = await leerConfig();
    if (!config.nick) throw new Error('Debes iniciar sesión antes de lanzar el juego.');
    const estadoInstalacion = await leerEstadoInstalacion(instancia);
    if (estadoInstalacion.estado !== 'listo') {
      throw new Error('La instancia debe instalarse o actualizarse antes de jugar.');
    }

    const ramSolicitada = Number(datos.ram ?? config.ram);
    const ram = Number.isFinite(ramSolicitada) && ramSolicitada >= RAM_MINIMA_GB && ramSolicitada <= obtenerLimiteRamRecomendado()
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
    let procesoConfirmado = false;
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
    const confirmarProcesoIniciado = () => {
      if (procesoConfirmado) return;
      procesoConfirmado = true;
      enviarProgresoJuego({ estado: 'iniciado', mensaje: 'EN EJECUCIÓN' });
    };
    launcher.on('data', mensaje => {
      registrarSalida(mensaje);
      confirmarProcesoIniciado();
    });
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

    const authorization = await obtenerAutorizacionDeJuego(config);
    const proceso = await launcher.launch({
      authorization,
      root: runtime,
      version,
      memory: opcionesMemoriaMclc(ram),
      window: { fullscreen: config.fullscreen },
      javaPath: java.ejecutable,
      overrides: {
        gameDirectory,
        ...(instancia.cargadorMods === 'fabric'
          ? { minecraftJar: path.join(runtime, 'versions', instancia.versionMinecraft, `${instancia.versionMinecraft}.jar`) }
          : {})
      }
    });

    if (!proceso) {
      juegoEnCurso = false;
      enviarProgresoJuego({ estado: 'error', mensaje: 'NO SE PUDO INICIAR EL JUEGO.' });
      return { ok: false, error: 'Minecraft no pudo iniciarse. Revisa Java y la consola del launcher.' };
    }

    // Respaldo: spawn exitoso ya confirma que Java abrió el proceso, incluso si
    // todavía no escribió una línea en stdout/stderr.
    confirmarProcesoIniciado();
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

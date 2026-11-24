const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('bardo', Object.freeze({
  guardarNick: nick => ipcRenderer.invoke('config:guardar-nick', nick),
  guardarRam: ram => ipcRenderer.invoke('config:guardar-ram', ram),
  obtenerPerfil: () => ipcRenderer.invoke('config:obtener-perfil'),
  leerPizarraRemota: () => ipcRenderer.invoke('pizarra:leer-remota'),
  verificarEstadoInstancia: instancia => ipcRenderer.invoke('instancia:verificar-estado', { instancia }),
  instalarInstancia: datos => ipcRenderer.invoke('instancia:instalar', datos),
  lanzarJuego: datos => ipcRenderer.invoke('juego:lanzar', datos),
  onProgresoJuego: callback => {
    if (typeof callback !== 'function') return () => {};
    const listener = (_evento, progreso) => callback(progreso);
    ipcRenderer.on('juego:progreso', listener);
    return () => ipcRenderer.removeListener('juego:progreso', listener);
  },
  cerrarSesion: () => ipcRenderer.invoke('auth:cerrar-sesion'),
  iniciarLoginMicrosoft: () => ipcRenderer.invoke('auth:microsoft')
}));

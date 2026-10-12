const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('bardo', Object.freeze({
  guardarNick: nick => ipcRenderer.invoke('config:guardar-nick', nick),
  obtenerPerfil: () => ipcRenderer.invoke('config:obtener-perfil'),
  cerrarSesion: () => ipcRenderer.invoke('auth:cerrar-sesion'),
  iniciarLoginMicrosoft: () => ipcRenderer.invoke('auth:microsoft')
}));

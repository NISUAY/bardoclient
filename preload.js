const { contextBridge } = require('electron');

// Contrato vacío y seguro para la maqueta. Se ampliará con APIs IPC explícitas
// cuando comience la fase de persistencia o del motor de Minecraft.
contextBridge.exposeInMainWorld('bardo', Object.freeze({}));

const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('api', {
  hasKey: () => ipcRenderer.invoke('has-key'),
  setKey: key => ipcRenderer.invoke('set-key', key),
  loadTickets: () => ipcRenderer.invoke('tickets'),
  loadDetail: id => ipcRenderer.invoke('ticket-detail', id),
  loadAnexos: id => ipcRenderer.invoke('anexos', id),
  anexoHtml: (id, kind) => ipcRenderer.invoke('anexo-html', { id, kind }),
  anexoText: id => ipcRenderer.invoke('anexo-text', id)
});

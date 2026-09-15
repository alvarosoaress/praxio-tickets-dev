const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('api', {
  hasKey: () => ipcRenderer.invoke('has-key'),
  setKey: key => ipcRenderer.invoke('set-key', key),
  loadTickets: () => ipcRenderer.invoke('tickets'),
  loadDetail: id => ipcRenderer.invoke('ticket-detail', id),
  loadViews: id => ipcRenderer.invoke('ticket-views', id),
  anexoHtml: (id, kind) => ipcRenderer.invoke('anexo-html', { id, kind }),
  anexoText: id => ipcRenderer.invoke('anexo-text', id),
  claudeOk: () => ipcRenderer.invoke('claude-ok'),
  claudeAllow: () => ipcRenderer.invoke('claude-allow'),
  resumo: (id, ticket, tramites, refazer) => ipcRenderer.invoke('resumo', { id, ticket, tramites, refazer }),
  getRepos: () => ipcRenderer.invoke('get-repos'),
  setRepos: list => ipcRenderer.invoke('set-repos', list),
  pickDir: () => ipcRenderer.invoke('pick-dir')
});

import { contextBridge, ipcRenderer, type IpcRendererEvent } from 'electron'
import type { NagayaApi } from '@shared/api'

function on<A extends unknown[]>(channel: string, cb: (...args: A) => void): () => void {
  const listener = (_e: IpcRendererEvent, ...args: unknown[]): void => cb(...(args as A))
  ipcRenderer.on(channel, listener)
  return () => ipcRenderer.removeListener(channel, listener)
}

const api: NagayaApi = {
  info: () => ipcRenderer.invoke('info'),

  getLayout: () => ipcRenderer.invoke('layout:get'),
  createSession: (input) => ipcRenderer.invoke('sessions:create', input),
  updateSession: (cfg) => ipcRenderer.invoke('sessions:update', cfg),
  removeSession: (id) => ipcRenderer.invoke('sessions:remove', id),
  moveSession: (id, groupId, beforeId) => ipcRenderer.invoke('sessions:move', id, groupId, beforeId),
  sessionMenu: (id) => ipcRenderer.invoke('sessions:menu', id),

  createGroup: (name) => ipcRenderer.invoke('groups:create', name),
  renameGroup: (id, name) => ipcRenderer.invoke('groups:rename', id, name),
  removeGroup: (id) => ipcRenderer.invoke('groups:remove', id),
  setGroupCollapsed: (id, collapsed) => ipcRenderer.invoke('groups:collapse', id, collapsed),
  moveGroup: (id, beforeId) => ipcRenderer.invoke('groups:move', id, beforeId),
  groupMenu: (id) => ipcRenderer.invoke('groups:menu', id),

  ptyStart: (id, cols, rows, reconnect) => ipcRenderer.invoke('pty:start', id, cols, rows, reconnect === true),
  ptyWrite: (id, data) => ipcRenderer.send('pty:write', id, data),
  ptyResize: (id, cols, rows) => ipcRenderer.send('pty:resize', id, cols, rows),
  ptyKill: (id) => ipcRenderer.send('pty:kill', id),
  onPtyData: (cb) => on('pty:data', cb),
  onPtyExit: (cb) => on('pty:exit', cb),

  getRules: () => ipcRenderer.invoke('rules:get'),
  reloadRules: () => ipcRenderer.invoke('rules:reload'),
  openRulesFolder: () => ipcRenderer.invoke('rules:open-folder'),
  onRulesChanged: (cb) => on('rules:changed', cb),

  getSettings: () => ipcRenderer.invoke('settings:get'),
  setFont: (font) => ipcRenderer.invoke('settings:font', font),
  onSettingsChanged: (cb) => on('settings:changed', cb),

  reportState: (id, state) => ipcRenderer.send('state', id, state),
  reportSelected: (id) => ipcRenderer.send('selected', id),
  onSelectSession: (cb) => on('select-session', cb),
  onMenu: (cb) => on('menu', cb),

  clipboardRead: () => ipcRenderer.invoke('clipboard:read'),
  clipboardWrite: (text) => ipcRenderer.send('clipboard:write', text),
  saveScreen: (defaultName, text) => ipcRenderer.invoke('screen:save', defaultName, text),
}

contextBridge.exposeInMainWorld('nagaya', api)

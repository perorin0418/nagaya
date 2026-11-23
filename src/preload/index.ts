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
  updateSession: (id, meta) => ipcRenderer.invoke('sessions:update', id, meta),
  duplicateSession: (id, meta) => ipcRenderer.invoke('sessions:duplicate', id, meta),
  removeSession: (id) => ipcRenderer.invoke('sessions:remove', id),
  moveSession: (id, groupId, beforeId) => ipcRenderer.invoke('sessions:move', id, groupId, beforeId),
  sessionMenu: (id) => ipcRenderer.invoke('sessions:menu', id),

  addTab: (sessionId, input, afterId) => ipcRenderer.invoke('tabs:add', sessionId, input, afterId),
  updateTab: (cfg) => ipcRenderer.invoke('tabs:update', cfg),
  removeTab: (id) => ipcRenderer.invoke('tabs:remove', id),
  tabMenu: (id) => ipcRenderer.invoke('tabs:menu', id),

  splitTab: (sessionId, input, targetId, dir) => ipcRenderer.invoke('tabs:split', sessionId, input, targetId, dir),
  unsplitTab: (id) => ipcRenderer.invoke('tabs:unsplit', id),
  setSplits: (sessionId, splits) => ipcRenderer.invoke('sessions:splits', sessionId, splits),
  terminalMenu: (id, hasSelection) => ipcRenderer.invoke('terminal:menu', id, hasSelection),

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
  reportSelected: (sessionId, tabId, visibleIds) => ipcRenderer.send('selected', sessionId, tabId, visibleIds),
  onSelectSession: (cb) => on('select-session', cb),
  onMenu: (cb) => on('menu', cb),

  clipboardRead: () => ipcRenderer.invoke('clipboard:read'),
  clipboardWrite: (text) => ipcRenderer.send('clipboard:write', text),
  saveScreen: (defaultName, text) => ipcRenderer.invoke('screen:save', defaultName, text),
  loadSavedScreen: (id) => ipcRenderer.invoke('screens:load', id),
  onPopoutOpened: (cb) => on('popout:opened', cb),
  onPopoutClosed: (cb) => on('popout:closed', cb),
  onPopoutInput: (cb) => on('popout:input', cb),
  onPopoutResize: (cb) => on('popout:resize', cb),
  onPopoutFocus: (cb) => on('popout:focus', cb),
  popoutRelay: (id, msg) => ipcRenderer.send('popout:relay', id, msg),
  popoutClose: (id) => ipcRenderer.send('popout:close', id),
  popoutShow: (id) => ipcRenderer.send('popout:show', id),
  popoutReady: () => ipcRenderer.send('popout:ready'),
  popoutInput: (data) => ipcRenderer.send('popout:input', data),
  popoutResize: (cols, rows) => ipcRenderer.send('popout:resize', cols, rows),
  popoutMenu: (hasSelection) => ipcRenderer.invoke('popout:menu', hasSelection),
  onPopoutData: (cb) => on('popout:data', cb),
  onCollectScreens: (cb) =>
    on('screens:collect', () => {
      let list: { id: string; data: string }[] = []
      try {
        list = cb()
      } finally {
        ipcRenderer.send('screens:collected', list)
      }
    }),
}

contextBridge.exposeInMainWorld('nagaya', api)

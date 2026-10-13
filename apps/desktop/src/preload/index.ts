import { contextBridge, ipcRenderer, type IpcRendererEvent } from 'electron'
import { IPC, type BackendEvent, type BluePyApi } from '@bluepy/protocol'

const api: BluePyApi = {
  app: {
    info: () => ipcRenderer.invoke(IPC.appInfo)
  },
  windows: {
    open: (role) => ipcRenderer.invoke(IPC.windowOpen, role)
  },
  state: {
    snapshot: () => ipcRenderer.invoke(IPC.stateSnapshot)
  },
  python: {
    discover: () => ipcRenderer.invoke(IPC.pythonDiscover),
    select: (pythonPath) => ipcRenderer.invoke(IPC.pythonSelect, pythonPath)
  },
  backend: {
    start: () => ipcRenderer.invoke(IPC.backendStart),
    reset: () => ipcRenderer.invoke(IPC.backendReset),
    status: () => ipcRenderer.invoke(IPC.backendStatus),
    halt: () => ipcRenderer.invoke(IPC.backendHalt),
    envInfo: () => ipcRenderer.invoke(IPC.backendEnvInfo)
  },
  project: {
    open: (dir) => ipcRenderer.invoke(IPC.projectOpen, dir),
    create: () => ipcRenderer.invoke(IPC.projectCreate),
    openExample: (name) => ipcRenderer.invoke(IPC.projectOpenExample, name),
    close: () => ipcRenderer.invoke(IPC.projectClose),
    readFile: (file) => ipcRenderer.invoke(IPC.projectReadFile, file),
    writeFile: (file, content) => ipcRenderer.invoke(IPC.projectWriteFile, { file, content }),
    createFile: (file, content) => ipcRenderer.invoke(IPC.projectCreateFile, { file, content }),
    compile: () => ipcRenderer.invoke(IPC.projectCompile),
    saveLayout: (layout) => ipcRenderer.invoke(IPC.projectSaveLayout, layout),
    runModule: (file) => ipcRenderer.invoke(IPC.projectRunModule, file)
  },
  editor: {
    open: (file, line) => ipcRenderer.invoke(IPC.editorOpen, { file, line })
  },
  objects: {
    describeClass: (module, name) => ipcRenderer.invoke(IPC.objectsDescribeClass, { module, name }),
    suggestName: (className) => ipcRenderer.invoke(IPC.objectsSuggestName, className),
    create: (module, name, benchName, args) => ipcRenderer.invoke(IPC.objectsCreate, { module, name, benchName, args }),
    call: (target, method, args) => ipcRenderer.invoke(IPC.objectsCall, { target, method, args }),
    inspect: (name, path) => ipcRenderer.invoke(IPC.objectsInspect, { name, path }),
    get: (name, path, newName) => ipcRenderer.invoke(IPC.objectsGet, { name, path, newName }),
    remove: (name) => ipcRenderer.invoke(IPC.objectsRemove, name)
  },
  debug: {
    setBreakpoints: (file, lines) => ipcRenderer.invoke(IPC.debugSetBreakpoints, { file, lines }),
    continue: () => ipcRenderer.invoke(IPC.debugCommand, 'continue'),
    step: () => ipcRenderer.invoke(IPC.debugCommand, 'step'),
    stepInto: () => ipcRenderer.invoke(IPC.debugCommand, 'stepInto'),
    stepOut: () => ipcRenderer.invoke(IPC.debugCommand, 'stepOut'),
    terminate: () => ipcRenderer.invoke(IPC.debugCommand, 'terminate'),
    pause: () => ipcRenderer.invoke(IPC.debugCommand, 'pause'),
    variables: (frame) => ipcRenderer.invoke(IPC.debugVariables, frame),
    inspect: (frame, scope, name, path) => ipcRenderer.invoke(IPC.debugInspect, { frame, scope, name, path })
  },
  codepad: {
    eval: (code) => ipcRenderer.invoke(IPC.codepadEval, { code })
  },
  terminal: {
    provideStdin: (text) => ipcRenderer.invoke(IPC.terminalStdin, text),
    clear: () => ipcRenderer.invoke(IPC.terminalClear)
  },
  onBackendEvent: (listener) => {
    const handler = (_event: IpcRendererEvent, payload: BackendEvent): void => listener(payload)
    ipcRenderer.on(IPC.backendEvent, handler)
    return () => {
      ipcRenderer.removeListener(IPC.backendEvent, handler)
    }
  }
}

contextBridge.exposeInMainWorld('bluepy', api)

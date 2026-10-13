import { contextBridge, ipcRenderer, type IpcRendererEvent } from 'electron'
import { IPC, type BackendEvent, type BluePyApi } from '@bluepy/protocol'

const api: BluePyApi = {
  app: {
    info: () => ipcRenderer.invoke(IPC.appInfo),
    setTheme: (theme) => ipcRenderer.invoke(IPC.appSetTheme, theme)
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
    examples: () => ipcRenderer.invoke(IPC.projectExamples),
    close: () => ipcRenderer.invoke(IPC.projectClose),
    readFile: (file) => ipcRenderer.invoke(IPC.projectReadFile, file),
    writeFile: (file, content) => ipcRenderer.invoke(IPC.projectWriteFile, { file, content }),
    createFile: (file, content) => ipcRenderer.invoke(IPC.projectCreateFile, { file, content }),
    compile: () => ipcRenderer.invoke(IPC.projectCompile),
    saveLayout: (layout) => ipcRenderer.invoke(IPC.projectSaveLayout, layout),
    runModule: (file) => ipcRenderer.invoke(IPC.projectRunModule, file)
  },
  editor: {
    open: (file, line) => ipcRenderer.invoke(IPC.editorOpen, { file, line }),
    flushed: (token) => ipcRenderer.invoke(IPC.editorFlushed, token),
    didOpen: (file, text) => ipcRenderer.invoke(IPC.editorDidOpen, { file, text }),
    didChange: (file, text) => ipcRenderer.invoke(IPC.editorDidChange, { file, text }),
    didClose: (file) => ipcRenderer.invoke(IPC.editorDidClose, file),
    complete: (file, line, character) => ipcRenderer.invoke(IPC.editorComplete, { file, line, character }),
    resolveCompletion: (item) => ipcRenderer.invoke(IPC.editorResolve, item),
    hover: (file, line, character) => ipcRenderer.invoke(IPC.editorHover, { file, line, character })
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
    eval: (code, id) => ipcRenderer.invoke(IPC.codepadEval, { code, id })
  },
  tests: {
    createTestClass: (classId) => ipcRenderer.invoke(IPC.testsCreateClass, classId),
    run: (target) => ipcRenderer.invoke(IPC.testsRun, target),
    describe: (file, className) => ipcRenderer.invoke(IPC.testsDescribe, { file, className }),
    startRecording: (file, className, method) => ipcRenderer.invoke(IPC.testsStartRecording, { file, className, method }),
    recordAssertion: (code, assertion) => ipcRenderer.invoke(IPC.testsRecordAssertion, { code, assertion }),
    endRecording: (save) => ipcRenderer.invoke(IPC.testsEndRecording, save),
    benchToFixture: (file, className) => ipcRenderer.invoke(IPC.testsBenchToFixture, { file, className }),
    fixtureToBench: (file, className) => ipcRenderer.invoke(IPC.testsFixtureToBench, { file, className })
  },
  hub: {
    settings: () => ipcRenderer.invoke(IPC.hubSettings),
    saveSettings: (patch) => ipcRenderer.invoke(IPC.hubSaveSettings, patch),
    fetchTask: (code) => ipcRenderer.invoke(IPC.hubFetchTask, code),
    submit: () => ipcRenderer.invoke(IPC.hubSubmit),
    taskStatus: () => ipcRenderer.invoke(IPC.hubTaskStatus),
    updateTask: () => ipcRenderer.invoke(IPC.hubUpdateTask),
    feedback: () => ipcRenderer.invoke(IPC.hubFeedback),
    classes: () => ipcRenderer.invoke(IPC.hubClasses),
    addClass: (name, students) => ipcRenderer.invoke(IPC.hubAddClass, { name, students }),
    addStudents: (id, students) => ipcRenderer.invoke(IPC.hubAddStudents, { id, students }),
    removeClass: (id) => ipcRenderer.invoke(IPC.hubRemoveClass, id),
    tasks: () => ipcRenderer.invoke(IPC.hubTasks),
    publish: (meta) => ipcRenderer.invoke(IPC.hubPublish, meta),
    collect: (code) => ipcRenderer.invoke(IPC.hubCollect, code),
    reviewOpen: (index) => ipcRenderer.invoke(IPC.hubReviewOpen, index),
    reviewNote: (index, notes, points) => ipcRenderer.invoke(IPC.hubReviewNote, { index, notes, points }),
    reviewClose: () => ipcRenderer.invoke(IPC.hubReviewClose),
    reviewRunTests: () => ipcRenderer.invoke(IPC.hubReviewRunTests),
    exportPackage: () => ipcRenderer.invoke(IPC.hubExport),
    importPackage: () => ipcRenderer.invoke(IPC.hubImport)
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

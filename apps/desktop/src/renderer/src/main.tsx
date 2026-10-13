import React from 'react'
import { createRoot } from 'react-dom/client'
import type { WindowRole } from '@bluepy/protocol'
import { ErrorBoundary, FatalError } from './components/ErrorBoundary'
import { DebuggerWindow } from './windows/DebuggerWindow'
import { DiagramWindow } from './windows/DiagramWindow'
import { MainWindow } from './windows/MainWindow'
import './i18n'
import './styles.css'

const container = document.getElementById('root')
if (!container) throw new Error('#root missing')
const root = createRoot(container)

/** Which window this renderer instance is – chosen by the main process via the URL. */
function windowRole(): WindowRole {
  const role = new URLSearchParams(window.location.search).get('window')
  return role === 'diagram' || role === 'debugger' ? role : 'main'
}

if (typeof window.bluepy === 'undefined') {
  // The preload script did not run (or crashed): nothing else can work.
  root.render(
    <FatalError
      title="Preload-Skript nicht geladen"
      detail={
        'window.bluepy fehlt. Das Preload-Skript (apps/desktop/src/preload) ist nicht gelaufen oder hat beim Laden einen Fehler geworfen.\n' +
        'Typische Ursache: ein require() auf ein Node-Modul im sandboxed Preload. Details stehen in der DevTools-Konsole (Ansicht → Entwicklerwerkzeuge).'
      }
    />
  )
} else {
  const role = windowRole()
  document.body.dataset.window = role
  root.render(
    <React.StrictMode>
      <ErrorBoundary>{role === 'diagram' ? <DiagramWindow /> : role === 'debugger' ? <DebuggerWindow /> : <MainWindow />}</ErrorBoundary>
    </React.StrictMode>
  )
}

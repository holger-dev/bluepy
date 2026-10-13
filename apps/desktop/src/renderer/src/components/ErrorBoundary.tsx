import { Component, type ErrorInfo, type JSX, type ReactNode } from 'react'

interface Props {
  children: ReactNode
}

interface State {
  error: Error | null
  info: ErrorInfo | null
}

/**
 * Last line of defence: an uncaught render/effect error must never leave the
 * learner with a blank window.  Shows the error with its component stack.
 */
export class ErrorBoundary extends Component<Props, State> {
  override state: State = { error: null, info: null }

  static getDerivedStateFromError(error: Error): Partial<State> {
    return { error }
  }

  override componentDidCatch(error: Error, info: ErrorInfo): void {
    console.error('[bluepy] uncaught error in renderer', error, info.componentStack)
    this.setState({ info })
  }

  override render(): ReactNode {
    const { error, info } = this.state
    if (!error) return this.props.children
    return (
      <FatalError
        title="BluePy ist auf einen Fehler gelaufen"
        detail={`${error.name}: ${error.message}\n${error.stack ?? ''}\n\nComponent stack:${info?.componentStack ?? ' (none)'}`}
      />
    )
  }
}

export function FatalError({ title, detail }: { title: string; detail: string }): JSX.Element {
  return (
    <div className="fatal">
      <h1>{title}</h1>
      <pre>{detail}</pre>
      <button type="button" onClick={() => window.location.reload()}>
        Neu laden
      </button>
    </div>
  )
}

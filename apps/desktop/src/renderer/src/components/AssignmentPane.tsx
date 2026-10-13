import { useMemo, type JSX } from 'react'
import { useTranslation } from 'react-i18next'
import { useStore } from '../store'
import { formatWhen } from './HubDialogs'

/** Tiny Markdown subset for task descriptions: headings, lists, code fences, inline code, bold/italic, links. */
export function renderMarkdown(source: string): string {
  const escape = (s: string): string => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  const inline = (s: string): string =>
    escape(s)
      .replace(/`([^`]+)`/g, '<code>$1</code>')
      .replace(/\*\*([^*]+)\*\*/g, '<b>$1</b>')
      .replace(/(^|[^*])\*([^*]+)\*/g, '$1<i>$2</i>')
      .replace(/\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)/g, '<a href="$2" target="_blank" rel="noopener">$1</a>')
  const lines = source.replace(/\r\n/g, '\n').split('\n')
  const out: string[] = []
  let list: 'ul' | 'ol' | null = null
  let para: string[] = []
  let code: string[] | null = null
  const flushPara = (): void => {
    if (para.length) out.push(`<p>${inline(para.join(' '))}</p>`)
    para = []
  }
  const flushList = (): void => {
    if (list) out.push(`</${list}>`)
    list = null
  }
  for (const raw of lines) {
    if (code) {
      if (raw.startsWith('```')) {
        out.push(`<pre><code>${escape(code.join('\n'))}</code></pre>`)
        code = null
      } else code.push(raw)
      continue
    }
    const line = raw.trimEnd()
    if (line.startsWith('```')) {
      flushPara()
      flushList()
      code = []
      continue
    }
    const heading = /^(#{1,4})\s+(.*)$/.exec(line)
    if (heading) {
      flushPara()
      flushList()
      const level = Math.min(4, (heading[1]?.length ?? 1) + 2)
      out.push(`<h${level}>${inline(heading[2] ?? '')}</h${level}>`)
      continue
    }
    const item = /^\s*([-*]|\d+[.)])\s+(.*)$/.exec(line)
    if (item) {
      flushPara()
      const kind: 'ul' | 'ol' = /\d/.test(item[1] ?? '') ? 'ol' : 'ul'
      if (list !== kind) {
        flushList()
        list = kind
        out.push(`<${kind}>`)
      }
      out.push(`<li>${inline(item[2] ?? '')}</li>`)
      continue
    }
    if (!line.trim()) {
      flushPara()
      flushList()
      continue
    }
    if (list) flushList()
    para.push(line.trim())
  }
  if (code) out.push(`<pre><code>${escape(code.join('\n'))}</code></pre>`)
  flushPara()
  flushList()
  return out.join('\n')
}

/** The task description, deadline and submit button for an assignment project (learner side). */
export function AssignmentPane(): JSX.Element | null {
  const { t } = useTranslation()
  const assignment = useStore((s) => s.assignment)
  const review = useStore((s) => s.review)
  const busy = useStore((s) => s.busy)
  const submitAssignment = useStore((s) => s.submitAssignment)
  const html = useMemo(() => renderMarkdown(assignment?.meta.description ?? ''), [assignment?.meta.description])
  if (!assignment) return null
  const inReview = review !== null && review.index >= 0
  const deadline = assignment.meta.submitUntil ? new Date(assignment.meta.submitUntil) : null
  const over = deadline !== null && !Number.isNaN(deadline.getTime()) && deadline.getTime() < Date.now()
  return (
    <div className="assignment">
      <div className="assignment-head">
        <div>
          <div className="assignment-title">{assignment.meta.title}</div>
          <div className="muted">
            {assignment.meta.code}
            {assignment.meta.teacher ? ` · ${assignment.meta.teacher}` : ''}
            {assignment.meta.submitUntil ? ` · ${t('hub.submitUntil')}: ${formatWhen(assignment.meta.submitUntil)}` : ''}
          </div>
        </div>
        {!inReview && (
          <button type="button" className={over ? '' : 'primary'} disabled={busy !== null} onClick={() => void submitAssignment()} title={over ? t('hub.windowAfter') : ''}>
            {busy === 'submit' ? t('hub.submitting') : t('hub.submit')}
          </button>
        )}
      </div>
      {assignment.lastSubmittedAt && !inReview && <div className="assignment-last ok">✓ {t('hub.lastSubmitted', { when: formatWhen(assignment.lastSubmittedAt) })}</div>}
      <div className="assignment-text markdown" dangerouslySetInnerHTML={{ __html: html || `<p class="muted">${t('hub.noDescription')}</p>` }} />
    </div>
  )
}

// Optional visibility goals. Only the explicit event name is collected.
// The main tracker owns eligibility and accepted pageview identity.
import type { EventOptions, PageContext, Props } from './types'

type GoalAPI = (command: string, name?: string, props?: Props, options?: EventOptions) => unknown
type GoalState = { observer: IntersectionObserver; timer: number; visible: boolean; name: string }
const goalWindow = window as unknown as { jelto?: GoalAPI; __jeltoGoals?: boolean; __jeltoForms?: boolean }
const context = (): PageContext | undefined => {
  try { return goalWindow.jelto?.('context') as PageContext | undefined } catch { return undefined }
}
const selector = '[data-jelto-visible]'

// A submit event means browser validation passed, not that a server accepted
// the form. Read declared attributes only; never inspect controls or FormData.
if (context()?.active && !goalWindow.__jeltoForms) {
  goalWindow.__jeltoForms = true
  document.addEventListener('submit', event => {
    const form = event.target
    if (event.defaultPrevented || !(form instanceof HTMLFormElement) || !context()?.active) return
    const name = form.getAttribute('data-jelto-event') || ''
    if (!/^[a-z0-9_:.-]{1,64}$/.test(name)) return
    const props: Props = {}
    for (const attribute of form.attributes) {
      if (attribute.name.startsWith('data-jelto-event-')) props[attribute.name.slice(17)] = attribute.value
    }
    goalWindow.jelto?.('event', name, props)
  }, true)
}

if (context()?.active && 'IntersectionObserver' in window && !goalWindow.__jeltoGoals) {
  goalWindow.__jeltoGoals = true
  let pageview: string | null = null
  let sent = new WeakSet<Element>()
  const states = new Map<Element, GoalState>()

  function cancel(state: GoalState): void {
    clearTimeout(state.timer)
    state.timer = 0
  }

  function remove(element: Element): void {
    const state = states.get(element)
    if (!state) return
    cancel(state)
    state.observer.disconnect()
    states.delete(element)
  }

  function eligible(): boolean {
    const now = context()
    return !!pageview && !!now?.active && now.pageviewId === pageview && !document.hidden
  }

  function deliver(element: Element, state: GoalState): void {
    state.timer = 0
    if (!eligible() || !element.isConnected || !state.visible || sent.has(element)) return
    goalWindow.jelto!('event', state.name, undefined, { interactive: false })
    sent.add(element)
    remove(element)
  }

  function observe(element: Element): void {
    if (!eligible() || sent.has(element) || states.has(element)) return
    const name = element.getAttribute('data-jelto-visible') || ''
    if (!/^[a-z0-9_:.-]{1,64}$/.test(name)) return
    const thresholdText = element.getAttribute('data-jelto-visible-threshold')?.trim()
    const thresholdValue = Number(thresholdText)
    const threshold = thresholdText && Number.isFinite(thresholdValue) && thresholdValue >= 0 && thresholdValue <= 1 ? thresholdValue : 0.5
    const delayText = element.getAttribute('data-jelto-visible-delay')?.trim()
    const delayValue = Number(delayText)
    const delay = delayText && Number.isInteger(delayValue) && delayValue >= 0 ? Math.min(delayValue, 60000) : 0
    // Native observers can report a zero-area edge as intersecting. Observe
    // a positive boundary for zero so gaining/losing visible pixels notifies
    // us as well; isIntersecting alone does not change at that transition.
    const observer = new IntersectionObserver(entries => {
      for (const entry of entries) {
        if (states.get(element) !== state) return
        state.visible = entry.isIntersecting && entry.intersectionRatio > 0 && entry.intersectionRatio >= threshold
        if (!state.visible || !eligible()) cancel(state)
        else if (!state.timer) {
          if (delay) state.timer = setTimeout(() => deliver(element, state), delay)
          else deliver(element, state)
        }
      }
    }, { threshold: threshold || Number.EPSILON })
    const state: GoalState = { observer, timer: 0, visible: false, name }
    states.set(element, state)
    observer.observe(element)
  }

  function each(node: ParentNode, action: (element: Element) => void): void {
    if (node instanceof Element && node.matches(selector)) action(node)
    node.querySelectorAll(selector).forEach(action)
  }

  function refresh(): void {
    for (const element of states.keys()) remove(element)
    const now = context()
    // Hiding preserves deduplication; only a new accepted pageview resets it.
    if (now?.pageviewId && now.pageviewId !== pageview) {
      pageview = now.pageviewId
      sent = new WeakSet<Element>()
    }
    if (eligible()) each(document, observe)
  }

  const mutations = new MutationObserver(records => {
    for (const record of records) {
      if (record.type === 'attributes') {
        const element = record.target as Element
        remove(element)
        if (element.matches(selector)) observe(element)
      } else {
        record.removedNodes.forEach(node => { if (node instanceof Element) each(node, remove) })
        record.addedNodes.forEach(node => { if (node instanceof Element) each(node, observe) })
      }
    }
  })
  function update(): void {
    mutations.disconnect()
    refresh()
    if (eligible()) mutations.observe(document.documentElement, {
      childList: true, subtree: true, attributes: true,
      attributeFilter: ['data-jelto-visible', 'data-jelto-visible-threshold', 'data-jelto-visible-delay'],
    })
  }
  addEventListener('jelto:pageview', update)
  document.addEventListener('visibilitychange', update)
  update()
}

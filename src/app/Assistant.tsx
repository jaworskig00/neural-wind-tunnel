import type { Surrogate } from '../ml/index'
import { useAssistant } from '../llm/useAssistant'
import { AssistantPanel } from './AssistantPanel'

/**
 * The assistant's entry point, and the boundary of its chunk.
 *
 * Everything the assistant needs -- the providers, the tool schemas, the dispatcher, the recorded
 * transcripts -- is reachable only from here, so this one lazy import keeps all of it out of the
 * page a visitor loads. It is also where the conversation lives: once opened, the component stays
 * mounted and is merely hidden, because closing a panel should not throw away what was said in it.
 */

export interface AssistantProps {
  readonly surrogate: Surrogate | null
  readonly hidden: boolean
  readonly onClose: () => void
}

export function Assistant({ surrogate, hidden, onClose }: AssistantProps) {
  const assistant = useAssistant(surrogate)
  return (
    <div className={hidden ? 'hidden' : 'contents'}>
      <AssistantPanel assistant={assistant} onClose={onClose} />
    </div>
  )
}

export default Assistant

/**
 * Keeps the URL and the application state in step.
 *
 * On load the hash is applied, so a shared link opens the design it describes. As the design
 * changes the hash is rewritten with `replaceState`, so the address bar always holds something
 * worth copying without filling the back button with every slider movement.
 *
 * Anything the decoder had to correct -- a clamped incidence, an unknown preset, a version it does
 * not read -- is surfaced rather than silently applied. A link that quietly shows something other
 * than what it says is worse than one that refuses.
 */

import { useEffect, useRef, useState } from 'react'

import { useAppStore } from './store'
import { decode, encode } from './urlState'

/** Milliseconds of quiet before the hash is rewritten, so a drag does not write on every frame. */
const WRITE_DELAY = 250

export interface UrlStateResult {
  /** Corrections the decoder made to the incoming link, for the UI to show. */
  readonly notices: string[]
  /** The camera the link asked for, applied once by the viewport. */
  readonly camera: readonly [number, number, number] | null
  dismissNotices: () => void
}

export function useUrlState(): UrlStateResult {
  const [notices, setNotices] = useState<string[]>([])
  const [camera, setCamera] = useState<readonly [number, number, number] | null>(null)
  const applied = useRef(false)

  useEffect(() => {
    if (applied.current) return
    applied.current = true

    const { state, notices: decoded } = decode(window.location.hash)
    const store = useAppStore.getState()
    if (state.presetId !== null) {
      store.loadPreset(state.presetId)
    } else {
      store.setSection(state.section)
    }
    store.setAlpha(state.alphaDeg)
    store.setView(state.view)
    store.setColormap(state.colormap)
    store.setTier(state.tier)

    setCamera(state.camera)
    setNotices(decoded)
  }, [])

  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | null = null

    const unsubscribe = useAppStore.subscribe((state) => {
      if (timer) clearTimeout(timer)
      timer = setTimeout(() => {
        const hash = encode({
          section: state.section,
          alphaDeg: state.alphaDeg,
          presetId: state.presetId,
          view: state.view,
          colormap: state.colormap,
          tier: state.tier,
          camera: camera ?? [45, 18, 3.2],
        })
        // `replaceState`, not `pushState`: every slider movement is a state change, and filling the
        // history with them would make the back button useless.
        window.history.replaceState(null, '', `#${hash}`)
      }, WRITE_DELAY)
    })

    return () => {
      if (timer) clearTimeout(timer)
      unsubscribe()
    }
  }, [camera])

  return {
    notices,
    camera,
    dismissNotices: () => {
      setNotices([])
    },
  }
}

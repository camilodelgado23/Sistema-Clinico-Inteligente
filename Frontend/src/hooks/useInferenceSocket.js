import { useEffect, useRef, useCallback } from 'react'

// En desarrollo apunta al orquestador directamente.
// En producción el proxy de Nginx redirige /ws → orchestrator:8003
const WS_BASE = import.meta.env.VITE_WS_URL ||
  `${window.location.protocol === 'https:' ? 'wss' : 'ws'}://${window.location.host}/ws`

/**
 * Hook que abre un WebSocket para escuchar el estado de una tarea de
 * inferencia en tiempo real.
 *
 * @param {string|null} taskId  — UUID de la tarea devuelto por POST /infer
 * @param {Function}    onMessage — callback(data) llamado con cada mensaje recibido
 *
 * Mensajes posibles:
 *   { task_id, status: 'RUNNING'|'DONE'|'ERROR', result_id?, error_msg? }
 *   { type: 'CRITICAL_ALERT', patient_id, risk_score, risk_category, ... }
 *   { type: 'ping' }  ← keep-alive, ignorar
 */
export function useInferenceSocket(taskId, onMessage) {
  const wsRef = useRef(null)

  const connect = useCallback(() => {
    if (!taskId) return

    const ws = new WebSocket(`${WS_BASE}/infer/${taskId}`)
    wsRef.current = ws

    ws.onopen = () => {
      console.debug(`[WS] conectado para task ${taskId}`)
    }

    ws.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data)
        // Ignorar pings de keep-alive
        if (data.type === 'ping') return
        onMessage(data)
      } catch (err) {
        console.warn('[WS] mensaje no parseable:', event.data)
      }
    }

    ws.onerror = (err) => {
      console.warn('[WS] error:', err)
      ws.close()
    }

    ws.onclose = () => {
      console.debug(`[WS] desconectado para task ${taskId}`)
      wsRef.current = null
    }

    // Devuelve cleanup
    return () => {
      if (ws.readyState === WebSocket.OPEN) ws.close()
    }
  }, [taskId, onMessage])

  useEffect(() => {
    const cleanup = connect()
    return () => {
      cleanup?.()
      wsRef.current?.close()
    }
  }, [connect])

  return wsRef
}
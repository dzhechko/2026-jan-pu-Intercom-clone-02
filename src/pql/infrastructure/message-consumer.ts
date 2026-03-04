/**
 * PQL Message Consumer — listens to Socket.io client:message events
 * and triggers PQL analysis on CLIENT messages.
 *
 * Wiring:
 *   - Hooks into the /chat namespace as a post-message handler
 *   - On PQL detection, broadcasts `pql:detected` to tenant:{tenantId} room
 *
 * Reference: docs/pseudocode.md PS-01
 */
import { Namespace } from 'socket.io'
import { PQLDetectorService, MessageEvent, PQLDetection } from '@pql/application/services/pql-detector-service'

export interface PQLMessageConsumerDeps {
  chatNamespace: Namespace
  pqlDetector: PQLDetectorService
}

/**
 * Register the PQL message consumer on the /chat namespace.
 * Listens for internal `pql:analyze` events emitted after a client message is saved.
 *
 * Usage in server.ts:
 *   registerPQLConsumer({ chatNamespace: nsp, pqlDetector })
 */
export function registerPQLConsumer({ chatNamespace, pqlDetector }: PQLMessageConsumerDeps): void {
  chatNamespace.on('connection', (socket) => {
    /**
     * Internal event: triggered by ws-handler after saving a CLIENT message.
     * Payload shape matches MessageEvent interface.
     */
    socket.on('pql:analyze', async (payload: unknown) => {
      try {
        const event = payload as MessageEvent
        if (!event.messageId || !event.dialogId || !event.tenantId || !event.content) {
          return
        }

        const detection = await pqlDetector.analyze(event)

        if (detection) {
          // Broadcast PQL detection to all operators watching this tenant
          chatNamespace.to(`tenant:${event.tenantId}`).emit('pql:detected', {
            detectionId: detection.id,
            dialogId: detection.dialogId,
            tenantId: detection.tenantId,
            score: detection.score,
            tier: detection.tier,
            topSignals: detection.topSignals,
          })
        }
      } catch (err) {
        console.error('[pql-consumer] analysis error', err)
      }
    })
  })
}

/**
 * Directly analyze a message event and emit PQL detection.
 * This can be called from the ws-handler inline (no extra socket event needed).
 */
export async function analyzePQLInline(
  pqlDetector: PQLDetectorService,
  chatNamespace: Namespace,
  event: MessageEvent,
): Promise<PQLDetection | null> {
  try {
    const detection = await pqlDetector.analyze(event)

    if (detection) {
      chatNamespace.to(`tenant:${event.tenantId}`).emit('pql:detected', {
        detectionId: detection.id,
        dialogId: detection.dialogId,
        tenantId: detection.tenantId,
        score: detection.score,
        tier: detection.tier,
        topSignals: detection.topSignals,
      })
    }

    return detection
  } catch (err) {
    console.error('[pql-consumer] inline analysis error', err)
    return null
  }
}

/** Hand-written declarations for vite-secret-bridge.mjs (consumed by the
 *  showcase's vite.config.ts, whose tsc run requires typed imports). */
import type { ViteDevServer, Plugin } from 'vite'

export function mountSecretBridge(
	server: ViteDevServer,
	options: { password: string; onFallbackPassword?: () => void },
): void

export function resolveDevPassword(
	envDir: string,
	mode: string,
): { password: string; usingFallback: boolean }

export function secretBridgePlugin(options?: { envDir?: string }): Plugin

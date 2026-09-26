import { isIP } from 'node:net'
import { isProduction } from './config.ts'

type RequestIpServer = { requestIP?: (request: Request) => { address: string } | null } | null

const isPrivatePeer = (ip: string): boolean => {
  if (ip.startsWith('::ffff:')) return isPrivatePeer(ip.slice(7))
  if (ip === '::1' || ip === '127.0.0.1' || ip.startsWith('127.')) return true
  if (ip.startsWith('10.') || ip.startsWith('192.168.')) return true
  const match = /^172\.(\d+)\./.exec(ip)
  if (match && Number(match[1]) >= 16 && Number(match[1]) <= 31) return true
  return /^(fc|fd|fe8|fe9|fea|feb)/i.test(ip)
}

/** Caddy overwrites X-Real-IP; accept it only from a private proxy peer. */
export const clientIpOf = (request: Request, server?: RequestIpServer): string => {
  const socketIp = server?.requestIP?.(request)?.address
  if (isProduction && socketIp && isPrivatePeer(socketIp)) {
    const proxyIp = request.headers.get('x-real-ip')
    if (proxyIp && isIP(proxyIp)) return proxyIp
  }
  if (socketIp) return socketIp
  // app.handle() has no socket. This branch is used by tests and local tools.
  if (!isProduction)
    return request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || '127.0.0.1'
  return 'unknown'
}

/**
 * API Proxy Route — forwards requests from Next.js (port 3000) to Express API (port 4000).
 * This avoids CORS issues by keeping all frontend requests same-origin.
 *
 * Maps: /api/proxy/dialogs → http://localhost:4000/api/dialogs
 * Maps: /api/proxy/auth/login → http://localhost:4000/api/auth/login
 */

import { NextRequest, NextResponse } from 'next/server'

const API_URL = process.env.API_URL ?? 'http://localhost:4000'

async function proxyRequest(req: NextRequest, { params }: { params: { path: string[] } }) {
  const path = params.path.join('/')
  const targetUrl = new URL(`/api/${path}`, API_URL)

  // Forward query params
  req.nextUrl.searchParams.forEach((value, key) => {
    targetUrl.searchParams.set(key, value)
  })

  // Build headers — forward auth and content-type
  const headers: Record<string, string> = {}
  const authHeader = req.headers.get('authorization')
  if (authHeader) headers['Authorization'] = authHeader
  const contentType = req.headers.get('content-type')
  if (contentType) headers['Content-Type'] = contentType

  // Build fetch options
  const fetchOptions: RequestInit = {
    method: req.method,
    headers,
  }

  // Forward body for non-GET requests
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    try {
      const body = await req.text()
      if (body) fetchOptions.body = body
    } catch {
      // No body to forward
    }
  }

  try {
    const response = await fetch(targetUrl.toString(), fetchOptions)
    const data = await response.text()

    return new NextResponse(data, {
      status: response.status,
      headers: {
        'Content-Type': response.headers.get('Content-Type') ?? 'application/json',
      },
    })
  } catch (error) {
    console.error('[proxy] Error forwarding request:', error)
    return NextResponse.json(
      { error: 'API server unavailable' },
      { status: 502 },
    )
  }
}

export async function GET(req: NextRequest, context: { params: { path: string[] } }) {
  return proxyRequest(req, context)
}

export async function POST(req: NextRequest, context: { params: { path: string[] } }) {
  return proxyRequest(req, context)
}

export async function PUT(req: NextRequest, context: { params: { path: string[] } }) {
  return proxyRequest(req, context)
}

export async function PATCH(req: NextRequest, context: { params: { path: string[] } }) {
  return proxyRequest(req, context)
}

export async function DELETE(req: NextRequest, context: { params: { path: string[] } }) {
  return proxyRequest(req, context)
}

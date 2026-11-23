#!/usr/bin/env node
// Servidor local: arquivos estáticos + funções de /api com a mesma assinatura das funções da Vercel
// (req.query, res.status/setHeader/send/json). Arquivo IDÊNTICO em bndes-um e ibge.
//
//   npm run dev            http://localhost:8080 — as funções buscam os dados reais pela internet
//   PORT=8090 npm run dev
import http from 'node:http'
import { readFile, stat } from 'node:fs/promises'
import { extname, join, normalize } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const ROOT = fileURLToPath(new URL('..', import.meta.url))
const PORT = Number(process.env.PORT ?? 8080)
const TIPOS = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png', '.json': 'application/json; charset=utf-8',
  '.txt': 'text/plain; charset=utf-8', '.ico': 'image/x-icon',
}

function shimRes(res) {
  let code = 200
  res.status = (c) => { code = c; return res }
  res.send = (body) => { res.statusCode = code; res.end(typeof body === 'string' || Buffer.isBuffer(body) ? body : JSON.stringify(body)) }
  res.json = (body) => { res.statusCode = code; if (!res.getHeader('Content-Type')) res.setHeader('Content-Type', 'application/json; charset=utf-8'); res.end(JSON.stringify(body)) }
  return res
}

http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://localhost:${PORT}`)
  try {
    if (url.pathname.startsWith('/api/')) {
      const nome = url.pathname.slice(5).replace(/[^a-z0-9_-]/gi, '')
      const mod = await import(pathToFileURL(join(ROOT, 'api', `${nome}.js`)).href + `?t=${Date.now()}`)
      req.query = Object.fromEntries(url.searchParams)
      return await mod.default(req, shimRes(res))
    }
    let caminho = normalize(join(ROOT, decodeURIComponent(url.pathname)))
    if (!caminho.startsWith(ROOT)) { res.statusCode = 403; return res.end('proibido') }
    if ((await stat(caminho).catch(() => null))?.isDirectory()) caminho = join(caminho, 'index.html')
    const corpo = await readFile(caminho)
    res.setHeader('Content-Type', TIPOS[extname(caminho)] ?? 'application/octet-stream')
    res.end(corpo)
  } catch (e) {
    res.statusCode = e.code === 'ENOENT' || e.code === 'ERR_MODULE_NOT_FOUND' ? 404 : 500
    res.end(res.statusCode === 404 ? 'não encontrado' : String(e.stack || e))
  }
}).listen(PORT, () => console.log(`http://localhost:${PORT}`))

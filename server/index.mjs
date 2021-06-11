import fastify from 'fastify'
import middie from 'middie'
import compression from 'fastify-compress'
import fastifyStatic from 'fastify-static'
import { createPageRender } from 'vite-plugin-ssr'
import * as vite from 'vite'

const isProduction = process.env.NODE_ENV === 'production'
const port = process.env.PORT || 3000
const root = process.cwd()

async function main() {
  const app = fastify({
    http2: isProduction,
    logger: false,
  })

  await app.register(compression, { global: true, })

  let viteDevServer

  if (isProduction) {
    await import(`${root}/dist/server/importer.js`)
    await app.register(fastifyStatic, {
      root: `${root}/dist/client/assets`,
      prefix: '/assets'
    })
  } else {
    await app.register(middie)
    viteDevServer = await vite.createServer({
      root,
      server: { middlewareMode: true },
    })
    app.use(viteDevServer.middlewares)
  }

  const renderPage = createPageRender({ viteDevServer, isProduction, root })

  app.all('*', async (request, reply) => {
    const renderContext = {
      url: request.url,
      isProduction,
      pageProps: {
        service: process.env.K_SERVICE,
        revision: process.env.K_REVISION || 'dev',
      }
    }

    const result = await renderPage(renderContext)

    if (result.nothingRendered) {
      reply.code(204).send(null)
    } else {
      reply
        .code(result.statusCode)
        .type('text/html')
        .header('cache-control', 'public, max-age=3600, s-maxage=7200')
        .send(result.renderResult)
    }
  })

  await app.ready()
  const url = await app.listen(port, '0.0.0.0')

  console.log(`Server ready and listening at ${url}`)
}

main()

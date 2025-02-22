import { RouteHandler } from 'fastify'
import fastifyCompress from 'fastify-compress'
import fastifyHelmet from 'fastify-helmet'
import fp from 'fastify-plugin'
import fastifyStatic from 'fastify-static'
import middie from 'middie'
import { Headers, Request, Response } from 'node-fetch'
import { createRenderer } from '@deckchairlabs/vite-plugin-superfly'
import { prependToStream } from './stream'
import createViteDevServer from './vite'

type SuperflyPluginOptions = {
  isProduction: boolean
  root?: string
}

export type SuperflyContext = {
  url: string
  isProduction: boolean
  request: Request
  responseStatusCode: number
  responseHeaders: Headers
}

type RenderResult =
  | { nothingRendered: true; renderResult: undefined; statusCode: undefined }
  | {
      nothingRendered: false
      renderResult: Response
      statusCode: 200 | 404 | 500
    }

declare module 'fastify' {
  interface FastifyInstance {
    createRenderHandler(
      superflyContext?: Partial<SuperflyContext>
    ): RouteHandler
  }
  interface FastifyRequest {
    superflyContext: SuperflyContext
  }
}

const superfly = fp<SuperflyPluginOptions>(async (fastify, options) => {
  const { isProduction, root = process.cwd() } = options

  let viteDevServer

  await fastify.register(fastifyHelmet, {
    contentSecurityPolicy: false
  })

  await fastify.register(fastifyCompress)

  if (isProduction) {
    await fastify.register(fastifyStatic, {
      root: `${root}/dist/client/assets`,
      prefix: '/assets',
      immutable: true,
      cacheControl: true,
      maxAge: '1y'
    })
  } else {
    await fastify.register(middie)
    viteDevServer = await createViteDevServer(root)
    fastify.use(viteDevServer.middlewares)
  }

  const renderPage = createRenderer({ viteDevServer, isProduction, root })

  fastify.addHook('preHandler', (request, _reply, done) => {
    request.superflyContext = {
      url: request.url,
      isProduction,
      responseStatusCode: 200,
      responseHeaders: new Headers(),
      request: new Request(request.url, {
        method: request.method,
        headers: new Headers()
      })
    }
    done()
  })

  fastify.decorate(
    'createRenderHandler',
    (superflyContext?: Partial<SuperflyContext>): RouteHandler => {
      return async function handler(request, reply) {
        const renderResult = (await renderPage({
          ...request.superflyContext,
          ...superflyContext
        })) as RenderResult

        if (renderResult.nothingRendered) {
          reply.status(404).send(null)
        } else if (renderResult.renderResult instanceof Response) {
          const response = renderResult.renderResult
          const contentType = response.headers.get('content-type')

          const docType =
            contentType === 'text/html' ? '<!DOCTYPE html>' : undefined
          const body = prependToStream([docType], response.body)

          reply
            .status(renderResult.statusCode)
            .headers(Object.fromEntries(response.headers))
            .send(body)
        } else {
          reply.status(renderResult.statusCode).send(renderResult.renderResult)
        }
      }
    }
  )
})

export default superfly

import { ParameterizedContext } from 'koa'
import { mock } from 'mockjs'
import { getConfig } from '../common/config'
import { mockParser, scriptParser } from '../common/mockPaser'
import { loadMockCode, removeMockCode, saveMockCode } from '../common/repository'
import { formatCode, transformCode } from '../common/utils'

class MockController {
  async mockCode(ctx: ParameterizedContext) {
    const address = ctx.query.address as string
    const path = ctx.query.path as string
    const method = ctx.query.method as string
    const type = ctx.query.type as string
    const fullPath = getConfig()?.patchPath?.(path, address) || path
    const { swagger } = (await ctx.state.loadSwagger({ path: fullPath, method })) || {}
    if (!swagger) throw ''

    const mockCode = await loadMockCode(fullPath, method, 'mock')
    const template = mockParser(swagger, path, method)
    let saved = false
    let code = ''

    if (type === 'json') {
      const jsonCode = await loadMockCode(fullPath, method, 'json')
      saved = !!jsonCode
      code = jsonCode || JSON.stringify(mock(mockCode ? JSON.parse(mockCode) : template), null, 2)
    } else if (type === 'script') {
      const content = await loadMockCode(fullPath, method, 'script')
      const { raw = '' } = content ? JSON.parse(content) : {}
      saved = !!raw
      code = formatCode(raw || scriptParser(swagger, path, method))
    } else {
      saved = !!mockCode
      code = mockCode || JSON.stringify(template, null, 2)
    }

    ctx.ok({ saved, code })
  }

  async updateMock(ctx: ParameterizedContext) {
    const {
      request: { body },
    } = ctx

    const fullPath = getConfig()?.patchPath?.(body.path, body.address) || body.path

    const { swagger } = (await ctx.state.loadSwagger({ path: fullPath, method: body.method })) || {}

    if (!swagger) throw ''

    const cur = swagger.paths?.[body.path]?.[body.method]

    if (!cur) {
      throw ''
    }

    saveMockCode(
      fullPath,
      body.method,
      body.type,
      body.type === 'script'
        ? JSON.stringify({ raw: body.config, code: await transformCode(body.config) })
        : body.config
    )

    ctx.ok()
  }

  async resetMock(ctx: ParameterizedContext) {
    const {
      request: { body },
    } = ctx

    const fullPath = getConfig()?.patchPath?.(body.path, body.address) || body.path

    const { swagger } = (await ctx.state.loadSwagger({ path: fullPath, method: body.method })) || {}

    if (!swagger) return

    removeMockCode(fullPath, body.method, body.type)

    ctx.ok()
  }
}

export default new MockController()

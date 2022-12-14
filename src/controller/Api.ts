import parser from '@liuyang0826/openapi-parser'
import axios from 'axios'
import execa from 'execa'
import * as fs from 'fs-extra'
import { ParameterizedContext } from 'koa'
import colors from 'picocolors'
import { Language } from 'src'
import { getConfig, resolveCodegen, resolveLanguages } from '../common/config'
import { loadSwagger, findSwager } from '../common/swagger'
import { formatCode } from '../common/utils'

class ApiController {
  async resources(ctx: ParameterizedContext) {
    const address = ctx.query.address as string

    console.log(`${colors.bold('Pull swagger resources')}:  ${colors.green(address)}`)

    ctx.ok((await axios(address)).data)
  }

  async swagger(ctx: ParameterizedContext) {
    const address = ctx.query.address as string
    const suffix = ctx.query.suffix as string

    console.log(`${colors.bold('Pull swagger data')}:  ${colors.green(address + suffix)}`)

    ctx.ok(await loadSwagger({ address, suffix }))
  }

  async apiCode(ctx: ParameterizedContext) {
    const address = ctx.query.address as string
    const path = ctx.query.path as string
    const method = ctx.query.method as string
    const lang = ctx.query.lang as string

    const { patchPath } = (await getConfig()) || {}
    const fullPath = patchPath?.(path, address) || path
    const { swagger } = (await findSwager({ fullPath, method })) || {}
    if (!swagger) return
    const program = parser(swagger, path, method)

    const realPath = (
      program?.pathVar ? `\`${fullPath.replace(/\{(.+?)\}/g, `\${pathVar["$1"]}`)}\`` : `"${fullPath}"`
    ).replace(/\/+/g, '/')

    let code = ''
    const render = program && (await resolveLanguages(lang))?.render
    code = (await render?.({ path: realPath, method, ...program })) || ''

    if (code) {
      try {
        code = formatCode(code)
      } catch (e) {
        console.log(e)
      }
    }

    ctx.ok(code)
  }

  async syncCode(ctx: ParameterizedContext) {
    const {
      request: { body },
      query,
    } = ctx

    const { patchPath, filePath: getFilePath } = (await getConfig()) || {}

    const result = await Promise.all(
      (body as { path: string; method: string; lang: string }[]).map(async ({ path, method, lang }) => {
        const fullPath = patchPath?.(path, query.address as string) || path
        const { swagger } = (await findSwager({ fullPath, method })) || {}
        if (!swagger) return
        const curPath = swagger.paths[path]
        if (!curPath) return
        const program = parser(swagger, path, method)
        if (!program) return

        const realPath = (
          program.pathVar ? `\`${fullPath.replace(/\{(.+?)\}/g, `\${pathVar["$1"]}`)}\`` : `"${fullPath}"`
        ).replace(/\/+/g, '/')

        const language = await resolveLanguages(lang)

        if (!language) return

        const { render, extension } = language
        let result = ''
        result = (await render?.({ path: realPath, method, ...program })) || ''

        if (result) {
          try {
            result = formatCode(result)
          } catch (e) {
            console.log(e)
          }
        }

        const filePath = `${`${(getFilePath ? getFilePath(fullPath) : `${process.cwd()}/src${fullPath}`).replace(
          /\//g,
          '/'
        )}${Object.keys(curPath).length > 1 ? `-${method.toLocaleLowerCase()}` : ''}.${extension}`}`

        // ????????????????????????
        const isExists = await fs.pathExists(filePath)

        if (isExists) {
          const content = await fs.readFile(filePath, 'utf-8')

          if (/\/\*\s*swagger-no-overwrite\s*\*\//.test(content)) {
            return {
              status: 'disabled',
              filePath,
              method,
              path,
            }
          }
        } else {
          await fs.ensureFile(filePath)
        }

        await fs.writeFile(filePath, result, 'utf-8')

        return {
          status: 'ok',
          filePath,
          method,
          path,
        }
      })
    )

    try {
      // ???????????????eslint??????
      await Promise.all(
        result
          .filter((d) => d?.status === 'ok')
          .map((item) => {
            return execa('eslint', ['--fix', item?.filePath || ''], {
              stdio: 'inherit',
              cwd: process.cwd(),
            })
          })
      )
    } catch {
      //
    }

    const disabledResult = result.filter((d) => d?.status === 'disabled')

    ctx.ok(
      disabledResult.length
        ? `${disabledResult.map((d) => `${d?.method.toUpperCase()}: ${d?.path}`).join('???')}????????????????????????`
        : '????????????'
    )
  }

  async config(ctx: ParameterizedContext) {
    const [codegen, languages] = (await Promise.allSettled([resolveCodegen(), resolveLanguages()])).map((d) =>
      d.status === 'fulfilled' ? d.value : null
    )

    ctx.ok({
      codegen,
      address: (await getConfig())?.address || [],
      languages: (languages as Language[])?.map((d) => d.type) || [],
    })
  }

  async codegen(ctx: ParameterizedContext) {
    const codegen = await resolveCodegen(ctx.request.body.key as string)
    let code = (await codegen?.render?.(ctx.request.body.model)) || ''

    if (code) {
      try {
        code = formatCode(code)
      } catch (e) {
        console.log(e)
      }
    }

    ctx.ok(code)
  }
}

export default new ApiController()

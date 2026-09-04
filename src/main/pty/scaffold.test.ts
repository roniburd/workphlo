import { describe, it, expect } from 'vitest'
import { mkdtemp, readFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { scaffoldCliSession, HOOK_COMMAND, steeringSystemPrompt } from './scaffold'

describe('scaffoldCliSession', () => {
  it('writes the html-report skill and a Stop hook settings.json', async () => {
    const cwd = await mkdtemp(join(tmpdir(), 'wf-scaffold-'))
    await scaffoldCliSession(cwd)

    const skill = await readFile(join(cwd, '.claude/skills/workphlo-html-report/SKILL.md'), 'utf8')
    expect(skill).toContain('result.html')
    expect(skill.startsWith('---')).toBe(true) // has frontmatter

    const settings = JSON.parse(await readFile(join(cwd, '.claude/settings.json'), 'utf8'))
    const stopHooks = settings.hooks.Stop
    expect(stopHooks[0].hooks[0].command).toBe(HOOK_COMMAND)
  })

  it('steering prompt references the skill and the artifact path', () => {
    expect(steeringSystemPrompt()).toContain('result.html')
    expect(steeringSystemPrompt()).toContain('workphlo-html-report')
  })
})

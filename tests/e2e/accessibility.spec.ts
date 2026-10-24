import { expect, test } from '@playwright/test'

/**
 * Accessibility contract for the shell.
 *
 * Deliberately not an axe sweep. The shell is small enough that the things worth guarding are
 * specific and nameable: every control reachable and operable from the keyboard, focus visible when
 * it is, charts announced as images with a description rather than as bare SVG, and the reduced
 * motion setting honoured by stopping the particles instead of ignoring it.
 */

test('every slider is operable from the keyboard', async ({ page }) => {
  await page.goto('/')

  const incidence = page.getByRole('slider', { name: 'Incidence' })
  await incidence.focus()
  const before = await incidence.inputValue()
  await page.keyboard.press('ArrowRight')
  await page.keyboard.press('ArrowRight')
  expect(Number(await incidence.inputValue())).toBeGreaterThan(Number(before))

  await page.keyboard.press('Home')
  expect(Number(await incidence.inputValue())).toBe(Number(await incidence.getAttribute('min')))
  await page.keyboard.press('End')
  expect(Number(await incidence.inputValue())).toBe(Number(await incidence.getAttribute('max')))

  // The CST weights live behind a disclosure, which must itself open from the keyboard.
  await page.getByText('CST weights').click()
  const weights = page.getByRole('slider', { name: 'A0' })
  await expect(weights.first()).toBeVisible()
  await weights.first().focus()
  const weightBefore = await weights.first().inputValue()
  await page.keyboard.press('ArrowUp')
  expect(await weights.first().inputValue()).not.toBe(weightBefore)
})

test('focus is visible on the controls', async ({ page }) => {
  await page.goto('/')

  const preset = page.getByRole('button', { name: 'NACA 0012' })
  await preset.focus()

  const outline = await preset.evaluate((element) => {
    const style = getComputedStyle(element)
    return { width: style.outlineWidth, style: style.outlineStyle, color: style.outlineColor }
  })
  expect(outline.style).not.toBe('none')
  expect(Number.parseFloat(outline.width)).toBeGreaterThanOrEqual(2)
})

test('the charts carry a text alternative', async ({ page }) => {
  await page.goto('/')

  await expect(page.getByRole('img', { name: /pressure distribution/i })).toBeVisible()
  await expect(page.getByRole('img', { name: /colour scale/i })).toBeVisible()

  await page.getByRole('button', { name: 'polars' }).click()
  await expect(page.getByRole('img', { name: 'Cl against α' })).toBeVisible()
  await expect(page.getByRole('img', { name: 'Cl against Cd' })).toBeVisible()
})

test.describe('reduced motion', () => {
  test.use({ reducedMotion: 'reduce' })

  test('pauses the particles and says so', async ({ page }) => {
    await page.goto('/')

    const note = page.getByTestId('reduced-motion-note')
    await expect(note).toBeVisible()
    await expect(note).toContainText('paused')

    // The override is there for someone who wants to see it anyway, and it is reversible.
    await note.getByRole('button', { name: 'Animate anyway' }).click()
    await expect(note).toContainText('despite')
    await note.getByRole('button', { name: 'Pause the particles' }).click()
    await expect(note).toContainText('paused')
  })
})

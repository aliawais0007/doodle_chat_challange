import { expect, test } from '@playwright/test'
import { AxeBuilder } from '@axe-core/playwright'
import type { Page } from '@playwright/test'

import { createChatApiMock, createMessageBatch } from './support/chat-api-mock'

const DISPLAY_NAME_STORAGE_KEY = 'doodle-chat.display-name'

const openChatWithDisplayName = async (page: Page, displayName: string) => {
  await page.addInitScript(
    ([storageKey, value]) => {
      window.localStorage.setItem(storageKey, value)
    },
    [DISPLAY_NAME_STORAGE_KEY, displayName]
  )

  await page.goto('/')

  await expect(page.getByRole('heading', { name: 'Doodle Chat' })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Edit name' })).toBeVisible()
}

const openFirstVisit = async (page: Page) => {
  await page.goto('/')

  await expect(page.getByRole('dialog', { name: 'Choose a display name' })).toBeVisible()
}

test('first visit lets a new user choose a display name', async ({ page }) => {
  await createChatApiMock(page)

  await openFirstVisit(page)

  await page.getByRole('textbox', { name: 'Display name' }).fill('Avery')
  await page.getByRole('button', { name: 'Save name' }).click()

  await expect(page.getByRole('dialog', { name: 'Choose a display name' })).toHaveCount(0)
  await expect(page.getByRole('heading', { name: 'Doodle Chat' })).toBeVisible()
  await expect(page.getByText('Chatting as Avery. Changes affect future messages only.')).toBeVisible()
  await expect(page.getByRole('textbox', { name: 'Message' })).toBeEnabled()

  const storedName = await page.evaluate(() => {
    return window.localStorage.getItem('doodle-chat.display-name')
  })

  expect(storedName).toBe('Avery')
})

test('sending a message survives a refresh', async ({ page }) => {
  const backend = await createChatApiMock(page, {
    initialMessages: createMessageBatch(2, { author: 'Nora', messagePrefix: 'Seed message' }),
  })

  await openChatWithDisplayName(page, 'Avery')

  const composer = page.getByRole('textbox', { name: 'Message' })
  await composer.fill('Hello from Playwright')
  await page.getByRole('button', { name: 'Send message' }).click()

  await expect(
    page.getByRole('region', { name: 'Conversation history' }).getByText('Hello from Playwright', {
      exact: true,
    })
  ).toBeVisible()

  const postRequest = backend.requestLog.find((request) => request.method === 'POST')

  expect(postRequest?.headers.authorization).toBe('Bearer test-token')
  expect(postRequest?.body).toMatchObject({ author: 'Avery', message: 'Hello from Playwright' })

  await page.reload()

  await expect(page.getByText('Hello from Playwright')).toBeVisible()
  await expect(page.getByText('Chatting as Avery. Changes affect future messages only.')).toBeVisible()
})

test('failed sends can be retried without losing the draft', async ({ page }) => {
  const backend = await createChatApiMock(page)
  backend.setNextPostFailure(1)

  await openChatWithDisplayName(page, 'Avery')

  await page.getByRole('textbox', { name: 'Message' }).fill('Retry this message')
  await page.getByRole('button', { name: 'Send message' }).click()

  await expect(
    page.getByRole('region', { name: 'Conversation history' }).getByText('Retry this message', {
      exact: true,
    })
  ).toBeVisible()
  await expect(page.getByRole('button', { name: 'Retry' })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Remove' })).toBeVisible()

  await page.getByRole('button', { name: 'Retry' }).click()

  await expect(page.getByRole('button', { name: 'Retry' })).toHaveCount(0)
  await expect(page.getByRole('button', { name: 'Remove' })).toHaveCount(0)
  await expect(
    page.getByRole('region', { name: 'Conversation history' }).getByText('Retry this message', {
      exact: true,
    })
  ).toBeVisible()

  const postRequests = backend.requestLog.filter((request) => request.method === 'POST')
  expect(postRequests).toHaveLength(2)
})

test('historical pagination loads older messages and reaches the start of the conversation', async ({ page }) => {
  const backend = await createChatApiMock(page, {
    initialMessages: createMessageBatch(60, { author: 'Nora', messagePrefix: 'History' }),
  })

  await openChatWithDisplayName(page, 'Avery')

  await expect(page.getByText('History 60')).toBeVisible()
  await expect(page.getByText('History 11')).toBeVisible()
  await expect(page.getByText('History 10')).toHaveCount(0)

  await page.getByRole('button', { name: 'Load older messages' }).click()

  await expect(page.getByText('History 10', { exact: true })).toBeVisible()
  await expect(page.getByText('History 1', { exact: true })).toBeVisible()
  await expect(page.getByText('Beginning of conversation', { exact: true })).toBeVisible()

  const beforeRequests = backend.requestLog.filter((request) => request.method === 'GET' && request.query.has('before'))
  expect(beforeRequests).toHaveLength(1)
})

test('remote incoming messages follow the conversation when the user is at the bottom', async ({ page }) => {
  const backend = await createChatApiMock(page, {
    initialMessages: createMessageBatch(4, { author: 'Nora', messagePrefix: 'Conversation' }),
  })

  await openChatWithDisplayName(page, 'Avery')

  await expect(page.getByRole('button', { name: /scroll to latest/i })).toHaveCount(0)

  backend.addRemoteMessage({ author: 'Mina', message: 'New at bottom' })
  await page.evaluate(() => {
    window.dispatchEvent(new Event('focus'))
  })

  await expect(page.getByText('New at bottom', { exact: true })).toBeVisible()
  await expect(page.getByRole('button', { name: /scroll to latest/i })).toHaveCount(0)
})

test('remote incoming messages show an unread affordance when the user is reading history', async ({ page }) => {
  const backend = await createChatApiMock(page, {
    initialMessages: createMessageBatch(30, { author: 'Nora', messagePrefix: 'Timeline' }),
  })

  await openChatWithDisplayName(page, 'Avery')

  const history = page.getByRole('region', { name: 'Conversation history' })
  await expect(page.getByText('Timeline 30', { exact: true })).toBeVisible()
  await page.waitForFunction(() => {
    const region = document.querySelector<HTMLElement>('[aria-label="Conversation history"]')

    return region !== null && region.scrollTop > 0
  })
  await history.evaluate((element) => {
    element.scrollTop = 0
    element.dispatchEvent(new Event('scroll', { bubbles: true }))
  })

  backend.addRemoteMessage({ author: 'Mina', message: 'Unread while reading history' })
  await page.evaluate(() => {
    window.dispatchEvent(new Event('focus'))
  })

  const unreadButton = page.getByRole('button', { name: /scroll to latest\. 1 new messages\./i })
  await expect(unreadButton).toBeVisible()
  await unreadButton.click()
  await expect(page.getByText('Unread while reading history', { exact: true })).toBeVisible()
})

test('the chat remains usable on a narrow viewport', async ({ page }) => {
  await createChatApiMock(page, {
    initialMessages: createMessageBatch(3, { author: 'Nora', messagePrefix: 'Mobile' }),
  })

  await page.setViewportSize({ width: 390, height: 844 })
  await openChatWithDisplayName(page, 'Avery')

  await expect(page.getByRole('heading', { name: 'Doodle Chat' })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Send message' })).toBeVisible()
  await expect(page.getByRole('region', { name: 'Conversation history' })).toBeVisible()
})

test('keyboard-only users can send a message', async ({ page }) => {
  await createChatApiMock(page)
  await openChatWithDisplayName(page, 'Avery')

  const composer = page.getByRole('textbox', { name: 'Message' })

  for (let index = 0; index < 6; index += 1) {
    await page.keyboard.press('Tab')
    if (await composer.evaluate((element) => document.activeElement === element)) {
      break
    }
  }

  await expect(composer).toBeFocused()

  await page.keyboard.type('Keyboard path message')
  await page.keyboard.press('Enter')

  await expect(page.getByText('Keyboard path message')).toBeVisible()
})

test('the chat shell passes an accessibility scan', async ({ page }) => {
  await createChatApiMock(page, {
    initialMessages: createMessageBatch(2, { author: 'Nora', messagePrefix: 'Accessible' }),
  })

  await openChatWithDisplayName(page, 'Avery')

  const results = await new AxeBuilder({ page }).analyze()
  const structuralViolations = results.violations.filter((violation) => violation.id !== 'color-contrast')

  expect(structuralViolations).toEqual([])
})
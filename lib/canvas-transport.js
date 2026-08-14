/** Own request ids, cancellation, delivery state, and long-poll lifecycle. */
export function createCanvasTransport() {
  let sequence = 0

  function nextId() {
    sequence += 1
    return 'host-' + sequence + '-' + Date.now()
  }
  function takeMessages(binding) {
    const messages = binding.queue.splice(0, binding.queue.length)
    for (const message of messages) {
      if (!message || message.type !== 'request') continue
      const pending = binding.pendingRequests.get(message.id)
      if (pending) pending.delivered = true
    }
    return messages
  }
  function push(binding, message) {
    binding.queue.push(message)
    const waiter = binding.pollWaiters.shift()
    if (waiter) waiter.finish(takeMessages(binding))
  }
  function notify(binding, method, payload) {
    push(binding, { id: nextId(), type: 'notification', method, payload })
  }
  function rejectAll(binding, error) {
    for (const pending of binding.pendingRequests.values()) {
      clearTimeout(pending.timer)
      if (pending.signal && pending.onAbort) pending.signal.removeEventListener('abort', pending.onAbort)
      pending.reject(error)
    }
    binding.pendingRequests.clear()
    for (const waiter of binding.saveWaiters.splice(0)) {
      clearTimeout(waiter.timer)
      waiter.reject(error)
    }
  }
  function close(binding, error) {
    rejectAll(binding, error)
    for (const waiter of binding.pollWaiters.splice(0)) waiter.finish([])
  }
  function request(binding, method, payload, timeoutMs = 120000, signal) {
    if (!binding.initialized || Date.now() - binding.lastSeen > 30000) {
      return Promise.reject(new Error('the conversation canvas is not connected'))
    }
    if (signal && signal.aborted) return Promise.reject(new Error('canvas request cancelled before delivery'))
    return new Promise((resolve, reject) => {
      const id = nextId()
      const cancel = (reason) => {
        const pending = binding.pendingRequests.get(id)
        if (!pending) return
        binding.pendingRequests.delete(id)
        clearTimeout(pending.timer)
        if (pending.signal && pending.onAbort) pending.signal.removeEventListener('abort', pending.onAbort)
        const queued = binding.queue.findIndex((message) => message && message.id === id)
        if (queued !== -1) binding.queue.splice(queued, 1)
        const suffix = pending.delivered || queued === -1
          ? '; the editor may still complete it, so inspect canvas state before retrying'
          : ' before delivery'
        reject(new Error(reason + suffix))
      }
      const timer = setTimeout(() => cancel('canvas request ' + method + ' timed out after ' + timeoutMs + 'ms'), timeoutMs)
      const onAbort = () => cancel('canvas request ' + method + ' was cancelled')
      binding.pendingRequests.set(id, { resolve, reject, timer, method, delivered: false, signal, onAbort })
      if (signal) signal.addEventListener('abort', onAbort, { once: true })
      push(binding, { id, type: 'request', method, payload })
    })
  }
  function acceptResponse(binding, message) {
    const pending = binding.pendingRequests.get(message.id)
    if (!pending) return false
    binding.pendingRequests.delete(message.id)
    clearTimeout(pending.timer)
    if (pending.signal && pending.onAbort) pending.signal.removeEventListener('abort', pending.onAbort)
    if (message.error) pending.reject(new Error(message.error.message || ('canvas ' + pending.method + ' failed')))
    else pending.resolve(message.payload)
    return true
  }
  function poll(binding, req, res) {
    binding.lastSeen = Date.now()
    const send = (messages) => {
      res.writeHead(200, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({ messages }))
    }
    if (binding.queue.length) { send(takeMessages(binding)); return }
    const waiter = { done: false, timer: null, finish: null }
    waiter.finish = (messages) => {
      if (waiter.done) return
      waiter.done = true
      clearTimeout(waiter.timer)
      const index = binding.pollWaiters.indexOf(waiter)
      if (index !== -1) binding.pollWaiters.splice(index, 1)
      try { send(messages) } catch (error) { /* browser disconnected */ }
    }
    waiter.timer = setTimeout(() => waiter.finish([]), 25000)
    res.once('close', () => {
      if (waiter.done) return
      waiter.done = true
      clearTimeout(waiter.timer)
      const index = binding.pollWaiters.indexOf(waiter)
      if (index !== -1) binding.pollWaiters.splice(index, 1)
    })
    binding.pollWaiters.push(waiter)
  }

  return { acceptResponse, close, notify, poll, request }
}

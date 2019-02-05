const { EventEmitter } = require('events')
const { partition } = require('./partition')

const RESOLVED = Promise.resolve()

const promiseOnce = (emitter, event) => new Promise(resolve => emitter.once(event, resolve))

const createLockingQueue = () => {
  const ee = new EventEmitter()
  const onEmpty = () => locks.size ? promiseOnce(ee, 'empty') : RESOLVED

  let queued = []
  let queuedBeforePause = []
  const getQueued = () => queuedBeforePause.concat(queued)

  // PAUSE / RESUME

  let paused
  const isPaused = () => paused

  const resume = () => {
    if (!paused) return

    paused = false
    processQueue(queued)
  }

  const pause = () => {
    if (paused) return RESOLVED

    paused = true
    queuedBeforePause = queued.slice()
    queued = []
    return onEmpty()
  }

  // LOCK / RELEASE

  const running = new Set()
  const getRunning = () => Array.from(running)

  const locks = new Set()

  const attemptLock = task => {
    for (const id of task.locks) {
      if (locks.has(id)) {
        return false
      }
    }

    for (const id of task.locks) {
      locks.add(id)
    }

    return true
  }

  const release = task => {
    running.delete(task)

    for (const id of task.locks) {
      locks.delete(id)
    }

    if (paused) {
      queuedBeforePause = processQueue(queuedBeforePause)
    } else {
      queued = processQueue(queued)
    }
  }

  const processQueue = queue => {
    let runnable
    ([runnable, stillQueued] = partition(queue, attemptLock))

    for (const task of runnable) {
      run(task)
    }

    if (!locks.size) ee.emit('empty')

    return stillQueued
  }

  // QUEUE

  const run = async task => {
    running.add(task)
    try {
      task.resolve(await task.fn())
    } catch (err) {
      task.reject(err)
    } finally {
      release(task)
    }
  }

  const enqueue = task => new Promise((resolve, reject) => {
    // make a defensive copy
    task = { ...task }
    task.resolve = resolve
    task.reject = reject

    if (paused || !attemptLock(task)) {
      queued.push(task)
    } else {
      run(task)
    }
  })

  return {
    enqueue,
    pause,
    resume,
    isPaused,
    onEmpty,
    // for testing
    getRunning,
    getQueued,
    on: ee.on.bind(ee),
    once: ee.once.bind(ee),
  }
}

module.exports = {
  createLockingQueue,
}

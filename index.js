const { EventEmitter } = require('events')
const { partition } = require('./partition')

const RESOLVED = Promise.resolve()
const EVENTS = {
  EMPTY_PREPAUSE: 'empty:prepause',
  EMPTY: 'empty'
}

const promiseOnce = (emitter, event) => new Promise(resolve => emitter.once(event, resolve))
const TESTING = process.env.NODE_ENV === 'test'
const DEFAULT_LOCK = Symbol('default-lock')

class LockingQueue {
  constructor() {
    // internal events
    this.ee = new EventEmitter()
    // many things might want to wait for onEmpty
    this.ee.setMaxListeners(0)

    this._queued = []
    this._queuedBeforePause = []
    this._running = new Set()
    this._attemptLock = this._attemptLock.bind(this)
    this._locks = new Set()
    this._paused = false
  }

  get size() {
    return this._queuedBeforePause.length + this._queued.length
  }

  get concurrency() {
    return this._running.size
  }

  onEmpty() {
    return this._locks.size ? promiseOnce(this.ee, EVENTS.EMPTY) : RESOLVED
  }

  // for testing
  _getQueued() {
    return this._queuedBeforePause.concat(this._queued)
  }

  _getRunning() {
    return Array.from(this._running)
  }

  // PAUSE / RESUME

  isPaused() {
    return this._paused
  }

  resume() {
    if (!this._paused) return

    this._paused = false
    this._processQueue(this._queued)
  }

  pause() {
    if (this._paused) return RESOLVED

    this._paused = true
    this._queuedBeforePause = this._queued.slice()
    this._queued.length = 0
    return promiseOnce(this.ee, EVENTS.EMPTY_PREPAUSE)
  }

  // PAUSE / RESUME

  release(task) {
    this._running.delete(task)

    for (const id of task.locks) {
      this._locks.delete(id)
    }

    if (this._paused) {
      this._queuedBeforePause = this._processQueue(this._queuedBeforePause)
    } else {
      this._queued = this._processQueue(this._queued)
    }
  }

  _attemptLock(task) {
    const { locks } = task

    for (const id of locks) {
      if (this._locks.has(id)) {
        return false
      }
    }

    for (const id of locks) {
      this._locks.add(id)
    }

    return true
  }

  // QUEUE

  enqueue(task) {
    return new Promise((resolve, reject) => {
      if (typeof task === 'function') {
        task = { fn: task, locks: [DEFAULT_LOCK] }
      }

      // make a defensive copy
      task = { ...task, locks: task.locks || [] }
      task.resolve = resolve
      task.reject = reject

      if (this._paused || !this._attemptLock(task)) {
        this._queued.push(task)
      } else {
        this._run(task)
      }
    })
  }

  _processQueue(queue) {
    const [runnable, stillQueued] = partition(queue, this._attemptLock)

    for (const task of runnable) {
      this._run(task)
    }

    if (!this._locks.size) {
      // Note: if the queue is paused, this only means the tasks
      // queued up before pause() have completed. There may be more tasks queued after
      this.ee.emit(this._paused ? EVENTS.EMPTY_PREPAUSE : EVENTS.EMPTY)
    }

    return stillQueued
  }

  async _run(task) {
    this._running.add(task)

    if (TESTING) {
      const running = this._getRunning(this._running)
      this.ee.emit('running', running)
      if (this._running.size > 1) {
        this.ee.emit('concurrent', running)
      }
    }

    try {
      task.resolve(await task.fn())
    } catch (err) {
      task.reject(err)
    } finally {
      this.release(task)
    }
  }
}

const createLockingQueue = opts => new LockingQueue(opts)

module.exports = {
  createLockingQueue
}

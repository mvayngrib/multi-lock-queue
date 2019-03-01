# multi-lock-queue

tl;dr: optimally parallelize tasks that lock on potentially intersecting sets of ids

## Use Case

For when you need to:

- lock on a set of ids, and run a task when the locks are acquired
- parallelize as much as possible
- pause/resume

## Usage

### Basic Promise Queue

```js
const { createLockingQueue } = require('../')
const q = createLockingQueue()
const wait = millis =>
  new Promise(resolve => {
    setTimeout(resolve, millis)
  })

const waitAndPrint = (millis, msg) => wait(millis).then(() => console.log(msg))

q.enqueue(() => waitAndPrint(100, 'a'))
q.enqueue(() => waitAndPrint(50, 'b'))
q.enqueue(() => waitAndPrint(20, 'c'))
// a
// b
// c
```

### Queue With Locks

```js
const { createLockingQueue } = require('multi-lock-queue')
const q = createLockingQueue()

q.enqueue({
  // acquire locks
  locks: ['a', 'b', 'c']
  // and do something
  fn: async () => {
  },
})
.then(() => { /* task done */ })

q.enqueue({
  // acquire locks
  locks: ['b', 'c']
  // and do something else
  fn: async () => {
  },
})
.then(() => { /* task done */ })

q.pause().then(() => {
  // all tasks queued before pause have completed
})

// won't run until queue is resume()'d
q.enqueue({
  // acquire locks
  locks: ['c', 'd']
  // and do something else
  fn: async () => {
  },
})
.then(() => { /* task done */ })

setTimeout(() => {
  q.resume() // continue processing queued tasks
}, 1000)
```
